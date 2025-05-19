/**
 * @file ModuleSystem.js
 * @description Manages the lifecycle, registration, and dependencies of CoreModules.
 */

import { EventEmitter } from 'events';
import { CoreModule } from './CoreModule.js'; //
import { ModuleError, ValidationError } from '../errors/index.js'; //
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class ModuleSystem extends EventEmitter {
  static dependencies = ['errorSystem', 'eventBusSystem', 'config']; // [cite: 825]
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new ModuleSystem instance.
   * @param {object} [deps={}] - Dependencies for the ModuleSystem.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance.
   * @param {object} [deps.eventBusSystem] - The EventBusSystem instance.
   * @param {object} [deps.config={}] - Global configuration.
   */
  constructor(deps = {}) { // Constructor now uses deps = {}
    super();
    this.deps = { // Ensure all declared dependencies are at least null or an empty object
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {},
      ...deps
    };

    this.modules = new Map(); // [cite: 826]
    // this.initialized is driven by this.state.status

    // Attempt to get eventBus instance early
    try {
        this.eventBus = this.deps.eventBusSystem?.getEventBus(); // [cite: 827]
    } catch(e) {
        this.eventBus = null; // Will be re-fetched in initialize
    }


    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of ModuleSystem itself
      metrics: new Map(),
      moduleHealth: new Map(), // Stores last known health of each module [cite: 828]
      healthCheckIntervals: new Map(), // Tracks intervals for health monitoring [cite: 828]
      healthChecks: new Map(), // Health checks for ModuleSystem itself
    };

    this._validateDependencies(); // Validate early in constructor [cite: 829]
    this.setupDefaultHealthChecks();
  }

  /**
   * Validates that required dependencies are provided and are valid.
   * @private
   */
  _validateDependencies() { //
    const missing = ModuleSystem.dependencies.filter(dep => !this.deps[dep]); //
    if (missing.length > 0) { //
      throw new ModuleError( //
        ErrorCodes.MODULE.MISSING_DEPENDENCIES, //
        `ModuleSystem: Missing required dependencies: ${missing.join(', ')}`, //
        { missingDeps: missing } //
      );
    }
    if (!this.deps.eventBusSystem || typeof this.deps.eventBusSystem.getEventBus !== 'function') { //
      throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, 'ModuleSystem: EventBusSystem is invalid.'); //
    }
    if (!this.deps.errorSystem || typeof this.deps.errorSystem.handleError !== 'function') { //
      throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, 'ModuleSystem: ErrorSystem is invalid.'); //
    }
  }

  /**
   * Handles internal operational errors of the ModuleSystem.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof ModuleError || error instanceof ValidationError)
      ? new ModuleError(ErrorCodes.MODULE.SYSTEM_ERROR || 'SYSTEM_ERROR', error.message, context, { cause: error })
      : error;

    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.moduleSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('modulesystem.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'ModuleSystem', ...context });
  }

  /**
   * Handles errors reported by individual modules (e.g., via 'module:error' event or health checks).
   * @param {string} moduleName - The name of the module reporting the error.
   * @param {Error} error - The error object from the module.
   * @param {object} [moduleContext={}] - Context provided by the module.
   */
  async handleModuleError(moduleName, error, moduleContext = {}) { //
    // Log this as an operational error received by ModuleSystem
    this.state.errors.push({
      error, // Store the original error from the module
      timestamp: new Date().toISOString(),
      context: { moduleName, ...moduleContext, type: 'moduleReported' }
    });
    if (this.state.errors.length > (this.deps.config?.moduleSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('modulesystem.errors.module_reported', 1, { moduleName, errorName: error.name, errorCode: error.code });

    // Forward the error to the global ErrorSystem.
    // The module itself should have already used its own handleError,
    // so this is ModuleSystem ensuring it's also seen at a higher level if needed.
    // However, the original handleModuleError was directly calling errorSystem.handleError
    // This implies that 'module:error' events are directly handled by ModuleSystem's errorSystem binding.
    // Let's keep that direct forwarding behavior.
    await safeHandleError(this.deps.errorSystem, error, {
      source: 'ModuleSystemRelay', // Indicate it's relayed by ModuleSystem
      module: moduleName,
      originalContext: moduleContext,
      timestamp: new Date().toISOString()
    });

    // Emit a system-level event about the module error
    // Use super.emit to avoid potential loop with ModuleSystem's own emit override
    super.emit('module:error', { //
      module: moduleName,
      error, // The original error from the module
      context: moduleContext, // Context from the module
      timestamp: new Date().toISOString()
    });
  }


  /**
   * Emits an event locally on this ModuleSystem instance and broadcasts it via the global EventBus.
   * @param {string} eventName - The name of the event.
   * @param {...any} args - Arguments to pass to the event listeners and EventBus.
   */
  async emit(eventName, ...args) { //
    const localEmitResult = super.emit(eventName, ...args); //

    if (this.eventBus && typeof this.eventBus.emit === 'function' && this.state.status === SYSTEM_STATUS.RUNNING) { //
      try {
        // Assume args[0] is data, args[1] is options for CoreEventBus
        await this.eventBus.emit(eventName, args[0], args[1] || {}); //
      } catch (busError) {
        await this._handleInternalError(busError, { // (adapted)
          phase: 'event-bus-emit', eventName,
          argsSummary: args.map(arg => typeof arg).join(', ')
        });
      }
    }
    return localEmitResult; //
  }

  /**
   * Registers a module with the system.
   * @param {string} name - The unique name for the module.
   * @param {typeof CoreModule} ModuleClass - The class of the module to register (must extend CoreModule).
   * @param {object} [config={}] - Module-specific configuration.
   * @returns {Promise<CoreModule>} The registered module instance.
   */
  async register(name, ModuleClass, config = {}) { //
    if (!(ModuleClass && ModuleClass.prototype instanceof CoreModule)) { //
      throw new ValidationError( //
        ErrorCodes.VALIDATION.INVALID_MODULE, //
        `${name}: ModuleClass must extend CoreModule.` //
      );
    }
    if (this.modules.has(name)) { //
      throw new ModuleError( //
        ErrorCodes.MODULE.DUPLICATE_MODULE, //
        `${name}: Module is already registered.` //
      );
    }

    try {
      // Merge global config for the module with instance-specific config
      const moduleSpecificGlobalConfig = this.deps.config?.[name] || {};
      const finalConfig = { ...moduleSpecificGlobalConfig, ...config };

      const moduleInstance = new ModuleClass({ //
        ...this.deps, // Pass all ModuleSystem dependencies
        config: finalConfig, // Pass merged config specific to this module instance
      });
      this.modules.set(name, moduleInstance); // [cite: 840]

      // Listen for 'module:error' events directly from this module instance
      // to use ModuleSystem's centralized handling.
      moduleInstance.on('module:error', async ({ module: modNameIgnored, error, context }) => {
        // modNameIgnored should be `name`
        await this.handleModuleError(name, error, context);
      });

      this.recordMetric('modulesystem.modules.registered', 1, { moduleName: name });
      await this.emit('module:registered', { name, timestamp: new Date().toISOString() }); //
      return moduleInstance; //
    } catch (error) {
      const regError = new ModuleError( //
        ErrorCodes.MODULE.REGISTRATION_FAILED, //
        `Failed to register module ${name}.`, //
        { moduleName: name, originalMessage: error.message },
        { cause: error } //
      );
      await this._handleInternalError(regError);
      throw regError; //
    }
  }

  async unregister(name) { //
    const moduleInstance = this.modules.get(name); //
    if (!moduleInstance) return false; //

    try {
      if (moduleInstance.state.status === SYSTEM_STATUS.RUNNING || moduleInstance.state.status === SYSTEM_STATUS.INITIALIZING) { //
        await moduleInstance.shutdown(); //
      }
      // Stop health monitoring for this module
      this.stopModuleHealthMonitoring(name);

      this.modules.delete(name); // [cite: 846]
      this.state.moduleHealth.delete(name); // Clean up health state
      this.recordMetric('modulesystem.modules.unregistered', 1, { moduleName: name });
      await this.emit('module:unregistered', { name, timestamp: new Date().toISOString() }); //
      return true;
    } catch (error) {
      const unregError = new ModuleError( //
        ErrorCodes.MODULE.UNREGISTER_FAILED, //
        `Failed to unregister module ${name}.`, //
        { moduleName: name, originalMessage: error.message },
        { cause: error } //
      );
      await this._handleInternalError(unregError);
      throw unregError; //
    }
  }

  async resolve(name) { //
    const moduleInstance = this.modules.get(name); //
    if (!moduleInstance) { //
      throw new ModuleError(ErrorCodes.MODULE.NOT_FOUND, `Module ${name} is not registered.`); //
    }
    return moduleInstance; //
  }

  /**
   * Initializes all registered modules in their correct dependency order.
   * @returns {Promise<void>}
   */
  async initialize() { //
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new ModuleError(ErrorCodes.MODULE.ALREADY_INITIALIZED, 'ModuleSystem is already initialized or initializing.'); //
      await this._handleInternalError(err);
      return;
    }

    super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'ModuleSystem' }); // Use super.emit for own lifecycle
    this.state.status = SYSTEM_STATUS.INITIALIZING; //
    this.state.startTime = Date.now(); //

    // Re-fetch eventBus here
     if (this.deps.eventBusSystem && typeof this.deps.eventBusSystem.getEventBus === 'function') {
          try {
            this.eventBus = this.deps.eventBusSystem.getEventBus();
          } catch (e) {
             throw new ModuleError(
                ErrorCodes.MODULE.DEPENDENCY_NOT_READY,
                `ModuleSystem: EventBusSystem is not ready during initialization.`,
                { dependency: 'eventBusSystem' },
                { cause: e }
            );
          }
      } else if (!this.eventBus) {
          throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, `ModuleSystem: EventBus could not be obtained.`);
      }


    try {
      const initOrder = this.resolveDependencyOrder(); //
      for (const name of initOrder) { //
        const moduleInstance = this.modules.get(name); //
        if(moduleInstance) { // Ensure module exists
            await moduleInstance.initialize(); //
            await this.startModuleHealthMonitoring(name); //
        } else {
            // Should ideally not happen if resolveDependencyOrder is correct
            throw new ModuleError(ErrorCodes.MODULE.INTERNAL_ERROR, `Module ${name} found in initOrder but not in registered modules.`);
        }
      }

      this.state.status = SYSTEM_STATUS.RUNNING; //
      this.recordMetric('modulesystem.initialized.success', 1);
      await this.emit('system:initialized', { //
        timestamp: new Date().toISOString(), //
        modules: Array.from(this.modules.keys()), //
      });
      super.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'ModuleSystem', timestamp: new Date().toISOString() }); //
      super.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'ModuleSystem', timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('modulesystem.initialized.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'initialization' }); //
      const initError = error instanceof ModuleError ? error : new ModuleError( //
        ErrorCodes.MODULE.INITIALIZATION_FAILED, //
        'ModuleSystem failed to initialize.', //
        { originalMessage: error.message },
        { cause: error } //
      );
      super.emit('system:error', { system: 'ModuleSystem', error: initError, context: {phase: 'initialization'}});
      throw initError; //
    }
  }

  resolveDependencyOrder() { //
    const visited = new Set(); //
    const visiting = new Set(); //
    const order = []; //

    const visit = (name) => { //
      if (visited.has(name)) return; //
      if (visiting.has(name)) { //
        throw new ModuleError( //
          ErrorCodes.MODULE.CIRCULAR_DEPENDENCY, //
          `Circular dependency detected for module: ${name}. Path: ${Array.from(visiting).join(' -> ')} -> ${name}` //
        );
      }
      visiting.add(name); //

      const moduleInstance = this.modules.get(name); //
      if (!moduleInstance) {
          visiting.delete(name);
          // This case should ideally be caught by dependency checks within modules if a listed dep isn't registered at all.
          // Or if ModuleSystem tries to init a non-existent module.
          throw new ModuleError(ErrorCodes.MODULE.NOT_FOUND, `Module ${name} not found during dependency resolution.`);
      }
      // Use static dependencies from the ModuleClass constructor
      const deps = moduleInstance.constructor.dependencies || []; //

      for (const depName of deps) { //
        // CoreSystem dependencies (like 'errorSystem') are not modules managed by ModuleSystem
        // So, only try to visit if 'depName' refers to another module *registered in this ModuleSystem*
        if (this.modules.has(depName)) { //
          visit(depName); //
        } else if (!ModuleSystem.dependencies.includes(depName) && !CoreModule.dependencies.includes(depName)) {
          // If it's not a known core/system dep and not a registered module, it's a missing module dependency
          throw new ModuleError( //
            ErrorCodes.MODULE.MISSING_DEPENDENCY, //
            `Module '${name}' requires missing module: '${depName}', which is not a registered module or a known core system dependency.`, //
            { requiringModule: name, missingModule: depName }
          );
        }
      }
      visiting.delete(name); //
      visited.add(name); //
      order.push(name); //
    };

    for (const name of this.modules.keys()) { //
      visit(name); //
    }
    return order; //
  }

  async startModuleHealthMonitoring(name) { //
    const moduleInstance = this.modules.get(name); //
    if (!moduleInstance || typeof moduleInstance.checkHealth !== 'function') return; //

    this.stopModuleHealthMonitoring(name); // Clear existing interval for this module

    const intervalMs = moduleInstance.config?.healthCheckIntervalMs ||
                       this.deps.config?.moduleSystem?.defaultHealthCheckIntervalMs ||
                       DEFAULT_CONFIG.DEFAULT_HEALTH_CHECK_INTERVAL;

    const intervalId = setInterval(async () => { //
      try {
        const health = await moduleInstance.checkHealth(); //
        this.state.moduleHealth.set(name, health); // Store the full health object
        this.recordMetric(`modulesystem.module.${name}.health.status`, health.status === SYSTEM_STATUS.HEALTHY ? 1 : 0, { status: health.status });

        if (health.status !== SYSTEM_STATUS.HEALTHY) { //
          // Module's own health check interval might also report this.
          // ModuleSystem logging it provides a central view.
          // The error created by moduleInstance.startHealthChecks already uses moduleInstance.handleError
          // So, this might be redundant unless we want MS to explicitly log it.
          // For now, let module's own health check error reporting (via its handleError) be primary.
          // ModuleSystem's role here is to *collect* the health status.
          // It can emit a generic event if a module becomes unhealthy.
          super.emit('module:unhealthy', { moduleName: name, healthStatus: health.status, healthDetails: health });
        }
      } catch (error) {
        // This error is if moduleInstance.checkHealth() itself throws, not if it returns unhealthy
        const healthCheckError = new ModuleError(
            ErrorCodes.MODULE.HEALTH_CHECK_FAILED,
            `Error executing health check for module ${name}.`,
            { moduleName: name, originalMessage: error.message },
            { cause: error }
        );
        this.state.moduleHealth.set(name, createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'checkHealth execution failed' }, [healthCheckError]));
        await this.handleModuleError(name, healthCheckError, { phase: 'health-monitoring' }); // Use ModuleSystem's handler
      }
    }, intervalMs); //
    this.state.healthCheckIntervals.set(name, intervalId); //
  }

  stopModuleHealthMonitoring(name) {
    if (this.state.healthCheckIntervals.has(name)) {
      clearInterval(this.state.healthCheckIntervals.get(name)); //
      this.state.healthCheckIntervals.delete(name);
    }
  }

  /**
   * Shuts down all registered modules in reverse dependency order.
   * @returns {Promise<void>}
   */
  async shutdown() { //
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { //
      return;
    }
    super.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'ModuleSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; //
    const shutdownStartTime = Date.now();

    // Clear all health check intervals
    for (const intervalId of this.state.healthCheckIntervals.values()) { //
      clearInterval(intervalId); //
    }
    this.state.healthCheckIntervals.clear(); //

    try {
      const shutdownOrder = this.resolveDependencyOrder().reverse(); //
      for (const name of shutdownOrder) { //
        const moduleInstance = this.modules.get(name); //
        if (moduleInstance) { //
            await moduleInstance.shutdown(); //
        }
      }

      this.modules.clear(); //
      this.state.moduleHealth.clear();
      this.state.status = SYSTEM_STATUS.SHUTDOWN; // [cite: 894]
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('modulesystem.shutdown.time', shutdownTime);
      this.recordMetric('modulesystem.shutdown.success', 1);
      await this.emit('system:shutdown', { timestamp: new Date().toISOString() }); //
      super.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'ModuleSystem', durationMs: shutdownTime, timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('modulesystem.shutdown.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'shutdown' }); //
      const shutdownError = error instanceof ModuleError ? error : new ModuleError( //
        ErrorCodes.MODULE.SHUTDOWN_FAILED, //
        'ModuleSystem failed to shutdown.', //
        { originalMessage: error.message },
        { cause: error } //
      );
      super.emit('system:error', { system: 'ModuleSystem', error: shutdownError, context: { phase: 'shutdown' } });
      throw shutdownError; //
    }
  }

  // --- State, Health, Metrics for ModuleSystem itself ---
  setupDefaultHealthChecks() {
    this.registerHealthCheck('modulesystem.state', this.checkSystemState.bind(this));
    this.registerHealthCheck('modulesystem.module_overview', this.checkModuleOverviewStatus.bind(this));
    this.registerHealthCheck('modulesystem.all_modules_health', this.getSystemHealth.bind(this)); // Renamed from original file for clarity
  }

  recordMetric(name, value, tags = {}) {
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags });
  }

  getMetrics() {
    const metrics = {};
    for (const [name, data] of this.state.metrics) {
      metrics[name] = data;
    }
    // Optionally aggregate metrics from all managed modules
    // for(const [moduleName, moduleInstance] of this.modules) {
    //    if(typeof moduleInstance.getMetrics === 'function') {
    //        metrics[`module.${moduleName}`] = moduleInstance.getMetrics();
    //    }
    // }
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

  async checkHealth() { // Health of ModuleSystem itself
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
        moduleStatuses[name] = health.status;
        if(health.status === SYSTEM_STATUS.DEGRADED) degradedCount++;
        if(health.status === SYSTEM_STATUS.UNHEALTHY) unhealthyCount++;
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

  /**
   * Gets the aggregated health of all managed modules.
   * This was previously named getSystemHealth.
   * @returns {Promise<object>}
   */
  async getSystemModulesHealth() { // (renamed for clarity from getSystemHealth)
    const moduleHealthDetails = {}; //
    let overallSystemStatus = SYSTEM_STATUS.HEALTHY; //

    for (const [name, moduleInstance] of this.modules) { //
      try {
        const health = await moduleInstance.checkHealth(); //
        moduleHealthDetails[name] = health; //
        if (health.status !== SYSTEM_STATUS.HEALTHY) { //
          overallSystemStatus = (overallSystemStatus === SYSTEM_STATUS.HEALTHY && health.status === SYSTEM_STATUS.DEGRADED)
            ? SYSTEM_STATUS.DEGRADED
            : SYSTEM_STATUS.UNHEALTHY; //
        }
      } catch (error) {
        moduleHealthDetails[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, {error: `Failed to check health for module ${name}`}, [error]); //
        overallSystemStatus = SYSTEM_STATUS.UNHEALTHY; //
      }
    }

    return { // This is the health detail for one of ModuleSystem's own checks
      status: overallSystemStatus,
      timestamp: new Date().toISOString(),
      detail: {
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, // Uptime of ModuleSystem
        modules: moduleHealthDetails, //
        moduleErrorCount: this.state.errors.filter(e => e.context?.type === 'moduleReported').length
      }
    };
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
export function createModuleSystem(deps = {}) { //
  // Constructor now handles its own dependency validation and defaults for errorSystem/eventBusSystem.
  return new ModuleSystem(deps); //
}

// Default export was an object in original file.
// export default { ModuleSystem, createModuleSystem };