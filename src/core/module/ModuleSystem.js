/**
 * @file ModuleSystem.js
 * @description Manages the lifecycle, registration, and dependencies of CoreModules.
 */

import { EventEmitter } from 'events';
import { CoreModule } from './CoreModule.js';
import { ModuleError, ValidationError, CoreError } from '../errors/index.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class ModuleSystem extends EventEmitter {
  static dependencies = ['errorSystem', 'eventBusSystem', 'config', 'containerSystem']; // Added containerSystem
  static version = '2.0.0';

  /**
   * Creates a new ModuleSystem instance.
   * @param {object} [deps={}] - Dependencies for the ModuleSystem.
   * @param {object} deps.errorSystem - The ErrorSystem instance.
   * @param {object} deps.eventBusSystem - The EventBusSystem instance.
   * @param {object} [deps.config={}] - Global configuration.
   * @param {object} deps.containerSystem - The main ContainerSystem instance.
   */
  constructor(deps = {}) {
    super();
    this.deps = {
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {},
      containerSystem: deps.containerSystem, // Store containerSystem
      ...deps
    };

    this.modules = new Map();
    this.eventBus = null;

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [],
      metrics: new Map(),
      moduleHealth: new Map(),
      healthCheckIntervals: new Map(),
      healthChecks: new Map(),
    };

    this._validateDependencies();
    this.setupDefaultHealthChecks();
  }

  /**
   * Validates that required dependencies are provided and are valid.
   * @private
   */
  _validateDependencies() {
    const missing = ModuleSystem.dependencies.filter(dep => !this.deps[dep]);
    if (missing.length > 0) {
      throw new ModuleError(
        ErrorCodes.MODULE.MISSING_DEPENDENCIES, // Uses unprefixed
        `ModuleSystem: Missing required dependencies: ${missing.join(', ')}`,
        { missingDeps: missing }
      );
    }
    if (!this.deps.eventBusSystem || typeof this.deps.eventBusSystem.getEventBus !== 'function') {
      throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, 'ModuleSystem: EventBusSystem is invalid.'); // Uses unprefixed
    }
    if (!this.deps.errorSystem || typeof this.deps.errorSystem.handleError !== 'function') {
      throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, 'ModuleSystem: ErrorSystem is invalid.'); // Uses unprefixed
    }
    if (!this.deps.containerSystem || typeof this.deps.containerSystem.resolve !== 'function') {
      throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, 'ModuleSystem: ContainerSystem is invalid or missing.'); // Uses unprefixed
    }
  }

  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof ModuleError || error instanceof ValidationError || error instanceof CoreError)
      ? new ModuleError(ErrorCodes.MODULE.SYSTEM_ERROR, error.message, context, { cause: error })
      : error;
    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.moduleSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('modulesystem.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'ModuleSystem', ...context });
  }

  async handleModuleError(moduleName, error, moduleContext = {}) {
    this.state.errors.push({
      error,
      timestamp: new Date().toISOString(),
      context: { moduleName, ...moduleContext, type: 'moduleReported' }
    });
    if (this.state.errors.length > (this.deps.config?.moduleSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('modulesystem.errors.module_reported', 1, { moduleName, errorName: error.name, errorCode: error.code });
    await safeHandleError(this.deps.errorSystem, error, {
      source: 'ModuleSystemRelay',
      module: moduleName,
      originalContext: moduleContext,
      timestamp: new Date().toISOString()
    });
    super.emit('module:error', {
      module: moduleName,
      error,
      context: moduleContext,
      timestamp: new Date().toISOString()
    });
  }

  async emit(eventName, ...args) {
    const localEmitResult = super.emit(eventName, ...args);
    if (this.eventBus && typeof this.eventBus.emit === 'function' && this.state.status === SYSTEM_STATUS.RUNNING) {
      try {
        await this.eventBus.emit(eventName, args[0], args[1] || {});
      } catch (busError) {
        await this._handleInternalError(busError, {
          phase: 'event-bus-emit', eventName,
          argsSummary: args.map(arg => typeof arg).join(', ')
        });
      }
    }
    return localEmitResult;
  }

  /**
   * Registers a module with the system, resolving and injecting its dependencies.
   * @param {string} name - The unique name for the module.
   * @param {typeof CoreModule} ModuleClass - The class of the module to register.
   * @param {object} [moduleUserConfig={}] - Module-specific configuration provided at registration.
   * @returns {Promise<CoreModule>} The registered and configured module instance.
   */
  async register(name, ModuleClass, moduleUserConfig = {}) {
    if (!(ModuleClass && ModuleClass.prototype instanceof CoreModule)) {
      throw new ModuleError(
        ErrorCodes.MODULE.INVALID_MODULE, // Uses unprefixed
        `${name}: ModuleClass must extend CoreModule.`
      );
    }
    if (this.modules.has(name)) {
      throw new ModuleError(
        ErrorCodes.MODULE.DUPLICATE_MODULE, // Uses unprefixed
        `${name}: Module is already registered.`
      );
    }

    try {
      const moduleSpecificGlobalConfig = this.deps.config?.[name] || {};
      const finalModuleConfig = { ...moduleSpecificGlobalConfig, ...moduleUserConfig };

      const depsForModuleConstructor = {
        errorSystem: this.deps.errorSystem,
        eventBusSystem: this.deps.eventBusSystem,
        config: finalModuleConfig,
        containerSystem: this.deps.containerSystem, // Provide containerSystem
      };

      const declaredDependencies = ModuleClass.dependencies || [];
      for (const depDecl of declaredDependencies) {
        const depName = typeof depDecl === 'string' ? depDecl : depDecl.name;
        const isOptional = typeof depDecl === 'object' && depDecl.optional === true;

        // Skip if already a core dependency provided by ModuleSystem directly or 'containerSystem'
        if (['errorSystem', 'eventBusSystem', 'config', 'containerSystem'].includes(depName)) {
          continue;
        }

        if (this.modules.has(depName)) { // It's another module managed by this ModuleSystem
          depsForModuleConstructor[depName] = this.modules.get(depName);
        } else if (!ModuleSystem.dependencies.includes(depName) && !CoreModule.dependencies.includes(depName)) {
          // Not a core system dep of ModuleSystem/CoreModule, not another ModuleSystem module
          // Assume it's a non-module service to be resolved from ContainerSystem
          try {
            // Check if it's already resolved (e.g. if containerSystem passed it to ModuleSystem's deps)
            if (this.deps[depName]) {
                 depsForModuleConstructor[depName] = this.deps[depName];
            } else {
                 depsForModuleConstructor[depName] = await this.deps.containerSystem.resolve(depName);
            }
          } catch (e) {
            // Check if the error from containerSystem.resolve is because the component is not registered
            // The exact error code for "not found" from ContainerSystem might be SERVICE_UNKNOWN_COMPONENT
            // ErrorSystem wraps it as SERVICE_UNKNOWN_COMPONENT
            // CoreError subclasses prefix their codes. ServiceError uses SERVICE_ + specific code.
            const expectedNotFoundCode = `SERVICE_${ErrorCodes.SERVICE.UNKNOWN_COMPONENT}`;
            if (isOptional && e.code === expectedNotFoundCode) {
              this.deps.logger.warn(`[ModuleSystem] Optional non-module service dependency '${depName}' for module '${name}' not found in ContainerSystem. Injecting null.`);
              depsForModuleConstructor[depName] = null;
            } else if (!isOptional) {
              // Required service not found, or other resolution error
              const depError = new ModuleError(
                ErrorCodes.MODULE.DEPENDENCY_RESOLUTION_FAILED, // Uses unprefixed
                `Module '${name}': Failed to resolve required non-module service dependency '${depName}' from ContainerSystem.`,
                { moduleName: name, depName, originalError: e.message },
                { cause: e }
              );
              await this._handleInternalError(depError, { phase: 'register-dependency-resolution', failingModule: name, failingDependency: depName });
              throw depError; // Halt registration for this module
            } else { // Optional but resolution failed for another reason
                 this.deps.logger.warn(`[ModuleSystem] Error resolving optional non-module service dependency '${depName}' for module '${name}': ${e.message}. Injecting null.`);
                 depsForModuleConstructor[depName] = null;
            }
          }
        }
        // If it's an optional inter-module dependency that's not registered, it will be undefined here,
        // and the module constructor should handle deps[depName] being undefined or null.
        // Let's ensure optional missing modules are explicitly null.
        else if (isOptional && !this.modules.has(depName) && !ModuleSystem.dependencies.includes(depName) && !CoreModule.dependencies.includes(depName)) {
            this.deps.logger.info(`[ModuleSystem] Optional inter-module dependency '${depName}' for module '${name}' not found. Injecting null.`);
            depsForModuleConstructor[depName] = null;
        }
      }

      const moduleInstance = new ModuleClass(depsForModuleConstructor);
      this.modules.set(name, moduleInstance);

      moduleInstance.on('module:error', async ({ error, context }) => {
        await this.handleModuleError(name, error, context);
      });
      this.recordMetric('modulesystem.modules.registered', 1, { moduleName: name });
      await this.emit('module:registered', { name, timestamp: new Date().toISOString() });
      return moduleInstance;
    } catch (error) {
      // Catch errors from instantiation or dependency resolution step
      const regError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.REGISTRATION_FAILED, // Uses unprefixed
        `Failed to register module ${name}.`,
        { moduleName: name, originalMessage: error.message },
        { cause: error }
      );
      // Avoid double logging if error originated from _handleInternalError path during dep resolution
      if (!(error.context && error.context.phase === 'register-dependency-resolution' && error.context.failingModule === name) ) {
         await this._handleInternalError(regError, { phase: 'register-module-main-catch', failingModule: name });
      }
      throw regError;
    }
  }

  async unregister(name) {
    const moduleInstance = this.modules.get(name);
    if (!moduleInstance) return false;
    try {
      if (moduleInstance.state.status === SYSTEM_STATUS.RUNNING || moduleInstance.state.status === SYSTEM_STATUS.INITIALIZING) {
        await moduleInstance.shutdown();
      }
      this.stopModuleHealthMonitoring(name);
      this.modules.delete(name);
      this.state.moduleHealth.delete(name);
      this.recordMetric('modulesystem.modules.unregistered', 1, { moduleName: name });
      await this.emit('module:unregistered', { name, timestamp: new Date().toISOString() });
      return true;
    } catch (error) {
      const unregError = new ModuleError(
        ErrorCodes.MODULE.UNREGISTER_FAILED, // Uses unprefixed
        `Failed to unregister module ${name}.`,
        { moduleName: name, originalMessage: error.message },
        { cause: error }
      );
      await this._handleInternalError(unregError);
      throw unregError;
    }
  }

  async resolve(name) {
    const moduleInstance = this.modules.get(name);
    if (!moduleInstance) {
      throw new ModuleError(ErrorCodes.MODULE.NOT_FOUND, `Module ${name} is not registered.`); // Uses unprefixed
    }
    return moduleInstance;
  }

  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new ModuleError(ErrorCodes.MODULE.ALREADY_INITIALIZED, 'ModuleSystem is already initialized or initializing.');
      await this._handleInternalError(err);
      return;
    }

    super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'ModuleSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    this.state.startTime = Date.now();

     if (this.deps.eventBusSystem && typeof this.deps.eventBusSystem.getEventBus === 'function') {
          try {
            this.eventBus = this.deps.eventBusSystem.getEventBus();
          } catch (e) {
             throw new ModuleError(
                ErrorCodes.MODULE.DEPENDENCY_NOT_READY, // Uses unprefixed
                `ModuleSystem: EventBusSystem is not ready during initialization.`,
                { dependency: 'eventBusSystem' },
                { cause: e }
            );
          }
      } else if (!this.eventBus) {
          throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, `ModuleSystem: EventBus could not be obtained.`);
      }

    try {
      const initOrder = this.resolveDependencyOrder();
      for (const name of initOrder) {
        const moduleInstance = this.modules.get(name);
        if(moduleInstance) { // Module might be optional and not present if initOrder doesn't filter them
            await moduleInstance.initialize();
            await this.startModuleHealthMonitoring(name);
        }
      }

      this.state.status = SYSTEM_STATUS.RUNNING;
      this.recordMetric('modulesystem.initialized.success', 1);
      await this.emit('system:initialized', {
        timestamp: new Date().toISOString(),
        modules: Array.from(this.modules.keys()),
      });
      super.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'ModuleSystem', timestamp: new Date().toISOString() });
      super.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'ModuleSystem', timestamp: new Date().toISOString() });
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('modulesystem.initialized.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'initialization' });
      const initError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.INITIALIZATION_FAILED, // Uses unprefixed
        'ModuleSystem failed to initialize.',
        { originalMessage: error.message },
        { cause: error }
      );
      super.emit('system:error', { system: 'ModuleSystem', error: initError, context: {phase: 'initialization'}});
      throw initError;
    }
  }

  resolveDependencyOrder() {
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const visit = (name) => {
      if (!this.modules.has(name)) { // If an optional module was declared but not registered, don't try to visit
          const isOptionalModule = Array.from(this.modules.values()).some(modInst => 
              (modInst.constructor.dependencies || []).some(dep => typeof dep === 'object' && dep.name === name && dep.optional)
          );
          if (isOptionalModule) {
              this.deps.logger.info(`[ModuleSystem] Optional module '${name}' not registered, skipping in dependency order.`);
              return;
          }
          // If it's not an optional module and not registered, this is an issue that should ideally be caught earlier
          // or indicates an internal inconsistency.
          throw new ModuleError(ErrorCodes.MODULE.NOT_FOUND, `Module '${name}' referenced in dependency graph but not registered.`);
      }
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new ModuleError(
          ErrorCodes.MODULE.CIRCULAR_DEPENDENCY, // Uses unprefixed
          `Circular dependency detected for module: ${name}. Path: ${Array.from(visiting).join(' -> ')} -> ${name}`
        );
      }
      visiting.add(name);

      const moduleInstance = this.modules.get(name); // Should exist due to check above
      
      const depsDeclarations = moduleInstance.constructor.dependencies || [];
      for (const depDecl of depsDeclarations) {
        const depName = typeof depDecl === 'string' ? depDecl : depDecl.name;
        const isOptional = typeof depDecl === 'object' && depDecl.optional === true;

        // Only try to visit if 'depName' refers to another module *registered in this ModuleSystem*
        if (this.modules.has(depName)) {
          visit(depName);
        } else if (!ModuleSystem.dependencies.includes(depName) && !CoreModule.dependencies.includes(depName) && 
                   !this.deps.containerSystem.components?.has(depName) && // Check if it's a known service in container
                   !isOptional) {
          // If it's not a known core/system dep, not a registered ModuleSystem module, not known by container, AND it's required
          throw new ModuleError(
            ErrorCodes.MODULE.MISSING_DEPENDENCY, // Uses unprefixed
            `Module '${name}' requires missing dependency: '${depName}', which is not a registered module or known service.`,
            { requiringModule: name, missingModule: depName }
          );
        } else if (isOptional && !this.modules.has(depName) && 
                   !ModuleSystem.dependencies.includes(depName) && 
                   !CoreModule.dependencies.includes(depName) &&
                   !this.deps.containerSystem.components?.has(depName)
                   ) {
            // It's an optional dependency (module or service) and it's not found anywhere. Log and continue.
            this.deps.logger.warn(`[ModuleSystem] Optional dependency '${depName}' for module '${name}' not found. It will be injected as null/undefined.`);
        }
        // If it's a service to be resolved by ContainerSystem, ModuleSystem doesn't order it, ContainerSystem does.
      }
      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    // Ensure all modules are visited, even if not depended upon by others (for their own service deps)
    for (const name of this.modules.keys()) {
      if (!visited.has(name)) {
          visit(name);
      }
    }
    return order;
  }

  async startModuleHealthMonitoring(name) {
    const moduleInstance = this.modules.get(name);
    if (!moduleInstance || typeof moduleInstance.checkHealth !== 'function') return;

    this.stopModuleHealthMonitoring(name);

    const intervalMs = moduleInstance.config?.healthCheckIntervalMs ||
                       this.deps.config?.moduleSystem?.defaultHealthCheckIntervalMs ||
                       DEFAULT_CONFIG.DEFAULT_HEALTH_CHECK_INTERVAL;
    if (moduleInstance.state.healthChecks.size === 0) { // Don't monitor if module has no health checks
        this.deps.logger.info(`[ModuleSystem] Module '${name}' has no health checks registered. Skipping periodic monitoring.`);
        return;
    }
    const intervalId = setInterval(async () => {
      try {
        const health = await moduleInstance.checkHealth();
        this.state.moduleHealth.set(name, health);
        this.recordMetric(`modulesystem.module.${name}.health.status`, health.status === SYSTEM_STATUS.HEALTHY ? 1 : 0, { status: health.status });

        if (health.status !== SYSTEM_STATUS.HEALTHY) {
          super.emit('module:unhealthy', { moduleName: name, healthStatus: health.status, healthDetails: health });
        }
      } catch (error) {
        const healthCheckError = new ModuleError(
            ErrorCodes.MODULE.HEALTH_CHECK_FAILED, // Uses unprefixed
            `Error executing health check for module ${name}.`,
            { moduleName: name, originalMessage: error.message },
            { cause: error }
        );
        this.state.moduleHealth.set(name, createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'checkHealth execution failed' }, [healthCheckError]));
        await this.handleModuleError(name, healthCheckError, { phase: 'health-monitoring' });
      }
    }, intervalMs);
    this.state.healthCheckIntervals.set(name, intervalId);
  }

  stopModuleHealthMonitoring(name) {
    if (this.state.healthCheckIntervals.has(name)) {
      clearInterval(this.state.healthCheckIntervals.get(name));
      this.state.healthCheckIntervals.delete(name);
    }
  }

  async shutdown() {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
      return;
    }
    super.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'ModuleSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN;
    const shutdownStartTime = Date.now();
    for (const intervalId of this.state.healthCheckIntervals.values()) {
      clearInterval(intervalId);
    }
    this.state.healthCheckIntervals.clear();

    try {
      // Resolve order can still fail if modules were dynamically added/removed without proper checks,
      // but typically this should be stable if register/unregister are the only modifiers.
      let shutdownOrder = [];
      try {
        shutdownOrder = this.resolveDependencyOrder().reverse();
      } catch (e) {
          this.deps.logger.error(`[ModuleSystem] Could not resolve dependency order for shutdown, shutting down in registration order: ${e.message}`);
          // Fallback: shutdown in reverse registration order or just iterate this.modules
          shutdownOrder = Array.from(this.modules.keys()).reverse();
      }

      for (const name of shutdownOrder) {
        const moduleInstance = this.modules.get(name);
        if (moduleInstance) {
            try {
                await moduleInstance.shutdown();
            } catch(moduleShutdownError) {
                // Log error for this specific module, but continue shutting down others
                await this.handleModuleError(name, moduleShutdownError, { phase: 'module-shutdown' });
            }
        }
      }

      this.modules.clear();
      this.state.moduleHealth.clear();
      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('modulesystem.shutdown.time', shutdownTime);
      this.recordMetric('modulesystem.shutdown.success', 1);
      await this.emit('system:shutdown', { timestamp: new Date().toISOString() });
      super.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'ModuleSystem', durationMs: shutdownTime, timestamp: new Date().toISOString() });
    } catch (error) { // Catch errors from resolveDependencyOrder if it wasn't caught above, or other logic here
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('modulesystem.shutdown.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'shutdown' });
      const shutdownError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.SHUTDOWN_FAILED, // Uses unprefixed
        'ModuleSystem failed to shutdown.',
        { originalMessage: error.message },
        { cause: error }
      );
      super.emit('system:error', { system: 'ModuleSystem', error: shutdownError, context: { phase: 'shutdown' }});
      throw shutdownError;
    }
  }

  setupDefaultHealthChecks() {
    this.registerHealthCheck('modulesystem.state', this.checkSystemState.bind(this));
    this.registerHealthCheck('modulesystem.module_overview', this.checkModuleOverviewStatus.bind(this));
    this.registerHealthCheck('modulesystem.all_modules_health', this.getSystemModulesHealth.bind(this));
  }

  recordMetric(name, value, tags = {}) {
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags });
  }

  getMetrics() {
    const metrics = {};
    for (const [name, data] of this.state.metrics) {
      metrics[name] = data;
    }
    return metrics;
  }

  registerHealthCheck(name, checkFn) {
    if (typeof checkFn !== 'function') {
        const err = new ModuleError(ErrorCodes.MODULE.INVALID_HEALTH_CHECK, `ModuleSystem Health check '${name}' must be a function.`);
        this._handleInternalError(err);
        throw err;
    }
    this.state.healthChecks.set(name, checkFn);
  }

  async checkHealth() {
    const results = {};
    let overallStatus = SYSTEM_STATUS.HEALTHY;

    for (const [name, checkFn] of this.state.healthChecks) {
      try {
        const checkResult = await checkFn();
        results[name] = checkResult;
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) {
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY && checkResult.status === SYSTEM_STATUS.DEGRADED)
            ? SYSTEM_STATUS.DEGRADED
            : SYSTEM_STATUS.UNHEALTHY;
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]);
        overallStatus = SYSTEM_STATUS.UNHEALTHY;
      }
    }
    return {
      name: this.constructor.name,
      version: ModuleSystem.version,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      errorCount: this.state.errors.length,
      checks: results,
    };
  }

  async checkSystemState() {
    return createStandardHealthCheckResult(
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY,
      {
        currentStatus: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        internalErrorCount: this.state.errors.length
      }
    );
  }

  async checkModuleOverviewStatus() {
    const moduleStatuses = {};
    let degradedCount = 0;
    let unhealthyCount = 0;
    for(const [name, health] of this.state.moduleHealth) {
        if (health && health.status) {
            moduleStatuses[name] = health.status;
            if(health.status === SYSTEM_STATUS.DEGRADED) degradedCount++;
            if(health.status === SYSTEM_STATUS.UNHEALTHY) unhealthyCount++;
        } else {
            moduleStatuses[name] = SYSTEM_STATUS.UNAVAILABLE || 'unavailable';
        }
    }
    const status = unhealthyCount > 0 ? SYSTEM_STATUS.UNHEALTHY : (degradedCount > 0 ? SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.HEALTHY);
    return createStandardHealthCheckResult(status, {
        registeredModuleCount: this.modules.size,
        monitoredModuleCount: this.state.moduleHealth.size,
        unhealthyModuleCount: unhealthyCount,
        degradedModuleCount: degradedCount,
        moduleStatuses
    });
  }

  async getSystemModulesHealth() {
    const moduleHealthDetails = {};
    let overallSystemStatus = SYSTEM_STATUS.HEALTHY;

    for (const [name, moduleInstance] of this.modules) {
      try {
        const health = await moduleInstance.checkHealth();
        moduleHealthDetails[name] = health;
        if (health.status !== SYSTEM_STATUS.HEALTHY) {
          overallSystemStatus = (overallSystemStatus === SYSTEM_STATUS.HEALTHY && health.status === SYSTEM_STATUS.DEGRADED)
            ? SYSTEM_STATUS.DEGRADED
            : SYSTEM_STATUS.UNHEALTHY;
        }
      } catch (error) {
        const moduleCheckError = error instanceof CoreError ? error : new ModuleError(ErrorCodes.MODULE.HEALTH_CHECK_FAILED, `Failed to check health for module ${name}`, {moduleName: name}, {cause: error});
        moduleHealthDetails[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, {error: `Failed to check health for module ${name}`}, [moduleCheckError]);
        overallSystemStatus = SYSTEM_STATUS.UNHEALTHY;
      }
    }
    return createStandardHealthCheckResult(overallSystemStatus, {
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        modules: moduleHealthDetails,
        moduleErrorCount: this.state.errors.filter(e => e.context?.type === 'moduleReported').length
    });
  }

  getSystemStatus() {
    return {
        name: this.constructor.name,
        version: ModuleSystem.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        registeredModules: this.modules.size,
        timestamp: new Date().toISOString()
    };
  }
}

/**
 * Factory function for creating a ModuleSystem instance.
 * @param {object} [deps={}] - Dependencies for the ModuleSystem.
 * @returns {ModuleSystem}
 */
export function createModuleSystem(deps = {}) {
 return new ModuleSystem(deps);
}
createModuleSystem.dependencies = ModuleSystem.dependencies;