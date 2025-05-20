/**
 * @file CoreModule.js
 * @description Base class for all business logic modules in the TSMIS.
 * Provides standardized lifecycle, dependency management, error handling, eventing,
 * health monitoring, and metrics tracking.
 */

import { EventEmitter } from 'events';
import { CoreEventBus } from '../event/CoreEventBus.js';
import { ModuleError, ValidationError, CoreError } from '../errors/index.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class CoreModule extends EventEmitter {
  /**
   * @property {Array<string|object>} dependencies - Declares dependencies for the module.
   * Entries can be strings (for required dependency names) or objects
   * for more complex declarations like optional dependencies.
   * Example:
   * static dependencies = [
   * ...CoreModule.dependencies, // Inherits base dependencies
   * 'anotherRequiredModule',
   * { name: 'optionalAnalyticsModule', optional: true },
   * 'paymentService' // A non-module service to be injected by ModuleSystem
   * ];
   */
  static dependencies = ['errorSystem', 'eventBusSystem', 'config', 'containerSystem']; // Added containerSystem
  static version = '2.0.0';

  /**
   * Creates a new CoreModule instance.
   * @param {object} [deps={}] - Dependencies injected by ModuleSystem. This will include:
   * - Core systems like `errorSystem`, `eventBusSystem`.
   * - The `containerSystem` instance for dynamic resolution if needed.
   * - The module's specific `config` object.
   * - Other modules and services declared in `static dependencies`, resolved and injected by ModuleSystem.
   * - Missing optional dependencies will be injected as `null` or `undefined`.
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
    this.config = this.deps.config;

    try {
        this.eventBus = this.deps.eventBusSystem?.getEventBus();
    } catch (e) {
        this.eventBus = null;
    }

    this.healthCheckInterval = null;
    this.healthCheckIntervalMs = this.config?.healthCheckIntervalMs || DEFAULT_CONFIG.DEFAULT_HEALTH_CHECK_INTERVAL;
    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [],
      metrics: new Map(),
      healthChecks: new Map(),
      lastHealthCheck: null,
    };

    this.registerHealthCheck(`${this.constructor.name.toLowerCase()}.state`, this.checkModuleState.bind(this));
  }

  /**
   * Validates that required dependencies (as per static dependencies array) are provided and are valid.
   * Optional dependencies are not required to be present in this.deps.
   * @private
   */
  _validateDependencies() {
    const declaredDependencies = this.constructor.dependencies || CoreModule.dependencies;
    const missingRequired = [];

    for (const depDecl of declaredDependencies) {
      const depName = typeof depDecl === 'string' ? depDecl : depDecl.name;
      const isOptional = typeof depDecl === 'object' && depDecl.optional === true;

      if (!this.deps[depName] && !isOptional) {
        missingRequired.push(depName);
      }
    }

    if (missingRequired.length > 0) {
      throw new ModuleError(
        ErrorCodes.MODULE.MISSING_DEPENDENCIES, // Uses unprefixed
        `${this.constructor.name}: Missing required dependencies: ${missingRequired.join(', ')}`,
        { moduleName: this.constructor.name, missingDeps: missingRequired }
      );
    }

    // Validate core dependencies types if they are present (they should be if required)
    if (this.deps.eventBusSystem && typeof this.deps.eventBusSystem.getEventBus !== 'function') {
      throw new ModuleError(
        ErrorCodes.MODULE.INVALID_DEPENDENCY, // Uses unprefixed
        `${this.constructor.name}: EventBusSystem dependency is invalid.`,
        { moduleName: this.constructor.name, dependency: 'eventBusSystem' }
      );
    }
    if (this.deps.errorSystem && typeof this.deps.errorSystem.handleError !== 'function') {
      throw new ModuleError(
        ErrorCodes.MODULE.INVALID_DEPENDENCY, // Uses unprefixed
        `${this.constructor.name}: ErrorSystem dependency is invalid.`,
        { moduleName: this.constructor.name, dependency: 'errorSystem' }
      );
    }
    if (this.deps.containerSystem && typeof this.deps.containerSystem.resolve !== 'function') {
        // If containerSystem becomes a mandatory part of deps for all modules (passed by ModuleSystem)
        throw new ModuleError(
            ErrorCodes.MODULE.INVALID_DEPENDENCY, // Uses unprefixed
            `${this.constructor.name}: ContainerSystem dependency is invalid.`,
            { moduleName: this.constructor.name, dependency: 'containerSystem' }
        );
    }
  }

  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof ModuleError || error instanceof ValidationError || error instanceof CoreError)
      ? new ModuleError(ErrorCodes.MODULE.INTERNAL_ERROR, error.message, context, { cause: error })
      : error;
    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.config?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric(`${this.constructor.name.toLowerCase()}.errors.internal`, 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: this.constructor.name, ...context });
  }

  async validateConfig() {
    try {
      if (this.config === null || typeof this.config !== 'object') {
        throw new ValidationError(
          ErrorCodes.VALIDATION.INVALID_INPUT,
          `${this.constructor.name}: Configuration must be an object.`,
           { moduleName: this.constructor.name, receivedType: typeof this.config }
        );
      }
      await this.onValidateConfig();
      this.recordMetric(`${this.constructor.name.toLowerCase()}.config.validation.success`, 1);
      return true;
    } catch (error) {
      this.recordMetric(`${this.constructor.name.toLowerCase()}.config.validation.failure`, 1, { error: error.code });
      const configError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.CONFIG_VALIDATION_FAILED, // Uses unprefixed
        `${this.constructor.name}: Failed to validate configuration.`,
        { moduleName: this.constructor.name, originalMessage: error.message },
        { cause: error }
      );
      await this._handleInternalError(configError, { phase: 'validateConfig' });
      throw configError;
    }
  }

  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new ModuleError(ErrorCodes.MODULE.ALREADY_INITIALIZED, `${this.constructor.name} is already initialized or initializing.`);
      await this._handleInternalError(err);
      return this;
    }

    super.emit(`${LIFECYCLE_EVENTS.INITIALIZING}:${this.constructor.name.toLowerCase()}`);
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    this.state.startTime = Date.now();

    try {
      this._validateDependencies();

      if (this.deps.eventBusSystem && typeof this.deps.eventBusSystem.getEventBus === 'function') {
          try {
            this.eventBus = this.deps.eventBusSystem.getEventBus();
          } catch (e) {
             throw new ModuleError(
                ErrorCodes.MODULE.DEPENDENCY_NOT_READY, // Uses unprefixed
                `${this.constructor.name}: EventBusSystem is not ready.`,
                { moduleName: this.constructor.name, dependency: 'eventBusSystem' },
                { cause: e }
            );
          }
      } else if (!this.eventBus && (this.constructor.dependencies || CoreModule.dependencies).includes('eventBusSystem')) {
          throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, `${this.constructor.name}: EventBus could not be obtained from EventBusSystem.`);
      }

      await this.validateConfig();
      await this.onConfigure();
      await this.setupEventHandlers();
      await this.setupHealthChecks();
      await this.onInitialize();

      this.startHealthChecks();

      this.state.status = SYSTEM_STATUS.RUNNING;
      this.recordMetric(`${this.constructor.name.toLowerCase()}.initialized.success`, 1);
      await this.emit(`module:initialized`, {
        name: this.constructor.name,
        timestamp: new Date().toISOString(),
      });
      super.emit(`${LIFECYCLE_EVENTS.INITIALIZED}:${this.constructor.name.toLowerCase()}`, { timestamp: new Date().toISOString() });
      super.emit(`${LIFECYCLE_EVENTS.RUNNING}:${this.constructor.name.toLowerCase()}`, { timestamp: new Date().toISOString() });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric(`${this.constructor.name.toLowerCase()}.initialized.failure`, 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'initialization' });
      const initFailedError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.INITIALIZATION_FAILED, // Uses unprefixed
        `${this.constructor.name}: Failed to initialize.`,
        { moduleName: this.constructor.name, originalMessage: error.message },
        { cause: error }
      );
      await this.emit('module:error', { module: this.constructor.name, error: initFailedError, context: { phase: 'initialization' }});
      throw initFailedError;
    }
    return this;
  }

  async setupHealthChecks() {
    await this.onSetupHealthChecks();
  }

  registerHealthCheck(name, checkFn) {
    if (typeof checkFn !== 'function') {
      const err = new ModuleError(ErrorCodes.MODULE.INVALID_HEALTH_CHECK, `${this.constructor.name}: Health check '${name}' must be a function.`);
      this._handleInternalError(err);
      throw err;
    }
    this.state.healthChecks.set(name, checkFn);
  }

  startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (Object.keys(this.state.healthChecks).length === 0 && !this.state.healthChecks.size === 0) { // Don't start if no checks registered
        return;
    }
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkHealth();
        this.state.lastHealthCheck = health;
        if (health.status !== SYSTEM_STATUS.HEALTHY) {
          const healthError = new ModuleError(
            ErrorCodes.MODULE.UNHEALTHY, // Uses unprefixed
            `${this.constructor.name} health check reported: ${health.status}`,
            { moduleName: this.constructor.name, healthDetails: health }
          );
          await this.handleError(healthError, { phase: 'periodic-health-check' });
        }
      } catch (error) {
        await this._handleInternalError(error, { phase: 'execute-periodic-health-check' });
      }
    }, this.healthCheckIntervalMs);
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
      version: this.constructor.version,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      errorCount: this.state.errors.length,
      checks: results,
    };
  }

  async handleError(error, context = {}) {
    const errorToHandle = !(error instanceof CoreError)
        ? new ModuleError(ErrorCodes.MODULE.OPERATION_FAILED, error.message, context, { cause: error })
        : error;
    this.state.errors.push({ error: errorToHandle, timestamp: new Date().toISOString(), context: context || {} });
    if (this.state.errors.length > (this.config?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric(`${this.constructor.name.toLowerCase()}.errors.operational`, 1, { errorName: errorToHandle.name, errorCode: errorToHandle.code });
    await safeHandleError(this.deps.errorSystem, errorToHandle, {
      module: this.constructor.name,
      ...(context || {})
    });
    super.emit('module:error', {
      module: this.constructor.name,
      error: errorToHandle,
      context: context || {}
    });
    return this;
  }

  async emit(eventName, ...args) {
    const localEmitResult = super.emit(eventName, ...args);

    if (this.eventBus && typeof this.eventBus.emit === 'function' && this.state.status === SYSTEM_STATUS.RUNNING) {
      try {
        await this.eventBus.emit(eventName, args[0], args[1] || {});
      } catch (busError) {
        await this.handleError(busError, {
          phase: 'event-bus-emit',
          event: eventName,
          argsSummary: args.map(arg => typeof arg).join(', ')
        });
      }
    }
    return localEmitResult;
  }

  async shutdown() {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
      return this;
    }
    super.emit(`${LIFECYCLE_EVENTS.SHUTTING_DOWN}:${this.constructor.name.toLowerCase()}`);
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN;
    const shutdownStartTime = Date.now();
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    try {
      await this.onShutdown();

      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric(`${this.constructor.name.toLowerCase()}.shutdown.time`, shutdownTime);
      this.recordMetric(`${this.constructor.name.toLowerCase()}.shutdown.success`, 1);
      await this.emit('module:shutdown', {
        name: this.constructor.name,
        timestamp: new Date().toISOString(),
      });
      super.emit(`${LIFECYCLE_EVENTS.SHUTDOWN}:${this.constructor.name.toLowerCase()}`, { timestamp: new Date().toISOString(), durationMs: shutdownTime });
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric(`${this.constructor.name.toLowerCase()}.shutdown.failure`, 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'shutdown' });
      const shutdownFailedError = error instanceof ModuleError || error instanceof ValidationError ?
      error : new ModuleError(
        ErrorCodes.MODULE.SHUTDOWN_FAILED, // Uses unprefixed
        `${this.constructor.name}: Failed to shutdown.`,
        { moduleName: this.constructor.name, originalMessage: error.message },
        { cause: error }
      );
      await this.emit('module:error', { module: this.constructor.name, error: shutdownFailedError, context: { phase: 'shutdown' }});
      throw shutdownFailedError;
    }
    return this;
  }

  // --- Lifecycle Hooks for subclasses to override ---
  async onValidateConfig() { return true; }
  async onConfigure() { /* Default: no-op */ }
  async setupEventHandlers() { /* Default: no-op */ }
  async onSetupHealthChecks() { /* Default: no-op */ }
  async onInitialize() { /* Default: no-op */ }
  async onShutdown() { /* Default: no-op */ }

  // --- Metrics ---
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

  // --- Health Check State & Status ---
  async checkModuleState() {
    return createStandardHealthCheckResult(
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY,
      {
        currentStatus: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        internalErrorCount: this.state.errors.length,
        lastHealthCheckStatus: this.state.lastHealthCheck?.status || 'N/A'
      }
    );
  }

  getSystemStatus() {
    return {
        name: this.constructor.name,
        version: this.constructor.version || CoreModule.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString(),
        lastHealthCheck: this.state.lastHealthCheck ? {
            status: this.state.lastHealthCheck.status,
            timestamp: this.state.lastHealthCheck.timestamp
        } : null
    };
  }
}

/**
 * Factory function for creating a CoreModule instance.
 * Provides default no-op dependencies if not supplied, useful for testing or basic modules.
 * @param {object} [deps={}] - Dependencies for the CoreModule.
 * @returns {CoreModule}
 */
export function createModule(deps = {}) {
  const defaultDeps = {
    errorSystem: {
      handleError: async (error, context) => { console.error("Default No-Op ErrorSystem:", error, context); }
    },
    eventBusSystem: {
      getEventBus: () => {
        // CHANGED: Return a simple EventEmitter for default/testing scenarios
        // This avoids instantiating a full CoreEventBus with its own dependencies.
        // console.warn("[CoreModule Factory] Using default simple EventEmitter for eventBusSystem.getEventBus().");
        return new EventEmitter();
      }
    },
    config: {},
    containerSystem: {
        resolve: async (name) => {
            const errMsg = `[CoreModule Factory] Default No-Op ContainerSystem: Attempted to resolve '${name}' but no services are registered in this mock.`;
            console.warn(errMsg);
            // To better simulate ContainerSystem's behavior of throwing if a service is not found (unless optional handling is added there)
            const error = new Error(`Service ${name} not found in default container.`);
            // Mimic a ServiceError structure if possible for consistency in tests that might check error.code
            // Assuming SERVICE_UNKNOWN_COMPONENT is 'UNKNOWN_COMPONENT' in ErrorCodes.SERVICE
            error.code = `SERVICE_${ErrorCodes.SERVICE.UNKNOWN_COMPONENT}`; 
            throw error;
        }
    }
  };
  const mergedDeps = {
    ...defaultDeps,
    ...deps,
    // Ensure specific config for the module is under the 'config' key passed to constructor
    config: deps.config || defaultDeps.config,
    // If errorSystem or eventBusSystem or containerSystem are provided in deps, they will override defaults
    errorSystem: deps.errorSystem || defaultDeps.errorSystem,
    eventBusSystem: deps.eventBusSystem || defaultDeps.eventBusSystem,
    containerSystem: deps.containerSystem || defaultDeps.containerSystem,
  };
  return new CoreModule(mergedDeps);
}