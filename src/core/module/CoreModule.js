/**
 * @file CoreModule.js
 * @description Base class for all business logic modules in the TSMIS.
 * Provides standardized lifecycle, dependency management, error handling, eventing,
 * health monitoring, and metrics tracking.
 */

import { EventEmitter } from 'events';
import { CoreEventBus } from '../event/CoreEventBus.js'; // Only needed for type hint in createModule default
import { ModuleError, ValidationError } from '../errors/index.js'; // Assuming errors/index.js exports these
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class CoreModule extends EventEmitter {
  static dependencies = ['errorSystem', 'eventBusSystem', 'config']; // [cite: 764]
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new CoreModule instance.
   * @param {object} [deps={}] - Dependencies for the CoreModule.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance.
   * @param {object} [deps.eventBusSystem] - The EventBusSystem instance.
   * @param {object} [deps.config={}] - Module-specific configuration.
   */
  constructor(deps = {}) { // [cite: 765]
    super();
    this.deps = { // Ensure all declared dependencies are at least null or an empty object if not provided
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {}, // Module specific config is under this.config directly
      ...deps // Spread other dependencies like 'database'
    };
    this.config = this.deps.config; // Direct access to module's own config section [cite: 766]

    // Attempt to get eventBus instance early, may be null if eventBusSystem not ready
    // Modules should ideally use this.eventBus only after their own onInitialize.
    try {
        this.eventBus = deps.eventBusSystem?.getEventBus(); // [cite: 766]
    } catch (e) {
        // eventBusSystem might not be initialized when module constructor runs
        // this.eventBus will be re-fetched in initialize()
        this.eventBus = null;
    }


    // this.initialized is driven by this.state.status [cite: 766]
    this.healthCheckInterval = null; // [cite: 769]
    this.healthCheckIntervalMs = this.config?.healthCheckIntervalMs || DEFAULT_CONFIG.DEFAULT_HEALTH_CHECK_INTERVAL;

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [],
      metrics: new Map(),
      healthChecks: new Map(),
      lastHealthCheck: null, // [cite: 767]
    };

    // Validate dependencies immediately upon construction [cite: 768]
    // This might be too early if dependencies are resolved by a container later.
    // Moved to initialize() to ensure dependencies are resolved by a container first.
    // this.validateDependencies();

    this.registerHealthCheck(`${this.constructor.name.toLowerCase()}.state`, this.checkModuleState.bind(this));
  }

  /**
   * Validates that required dependencies are provided and are valid.
   * This should be called by the ModuleSystem or Container after instantiation and DI.
   * Or at the beginning of this.initialize().
   * @private
   */
  _validateDependencies() { //
    const missing = CoreModule.dependencies.filter(dep => !this.deps[dep]); //
    if (missing.length > 0) { // [cite: 770]
      throw new ModuleError( //
        ErrorCodes.MODULE.MISSING_DEPENDENCIES, // [cite: 770]
        `${this.constructor.name}: Missing required dependencies: ${missing.join(', ')}`, //
        { moduleName: this.constructor.name, missingDeps: missing } //
      );
    }
    if (this.deps.eventBusSystem && typeof this.deps.eventBusSystem.getEventBus !== 'function') { // [cite: 771]
      throw new ModuleError( //
        ErrorCodes.MODULE.INVALID_DEPENDENCY, //
        `${this.constructor.name}: EventBusSystem dependency is invalid (missing getEventBus method).`, // [cite: 772]
        { moduleName: this.constructor.name, dependency: 'eventBusSystem' }
      );
    }
    if (this.deps.errorSystem && typeof this.deps.errorSystem.handleError !== 'function') { // [cite: 772]
      throw new ModuleError( //
        ErrorCodes.MODULE.INVALID_DEPENDENCY, //
        `${this.constructor.name}: ErrorSystem dependency is invalid (missing handleError method).`, // [cite: 773]
        { moduleName: this.constructor.name, dependency: 'errorSystem' }
      );
    }
  }

  /**
   * Handles internal operational errors of the CoreModule.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof ModuleError || error instanceof ValidationError)
      ? new ModuleError(ErrorCodes.MODULE.INTERNAL_ERROR || 'INTERNAL_ERROR', error.message, context, { cause: error })
      : error;

    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.config?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric(`${this.constructor.name.toLowerCase()}.errors.internal`, 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: this.constructor.name, ...context });
  }

  /**
   * Validates the module's configuration.
   * Calls the onValidateConfig hook for module-specific validation.
   * @returns {Promise<boolean>} True if configuration is valid.
   * @throws {ModuleError} if validation fails.
   */
  async validateConfig() { //
    try {
      if (this.config === null || typeof this.config !== 'object') { // [cite: 774]
        throw new ValidationError( //
          ErrorCodes.CONFIG.INVALID_CONFIG, //
          `${this.constructor.name}: Configuration must be an object.`,
           { moduleName: this.constructor.name }
        );
      }
      await this.onValidateConfig(); // [cite: 774]
      this.recordMetric(`${this.constructor.name.toLowerCase()}.config.validation.success`, 1);
      return true; //
    } catch (error) {
      this.recordMetric(`${this.constructor.name.toLowerCase()}.config.validation.failure`, 1, { error: error.code });
      // Wrap in ModuleError if not already one from onValidateConfig
      const configError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.CONFIG_VALIDATION_FAILED, // [cite: 775]
        `${this.constructor.name}: Failed to validate configuration.`, //
        { moduleName: this.constructor.name, originalMessage: error.message }, //
        { cause: error } //
      );
      await this._handleInternalError(configError, { phase: 'validateConfig' });
      throw configError; //
    }
  }

  /**
   * Initializes the module. This is the main entry point for module startup.
   * @returns {Promise<CoreModule>} This instance.
   */
  async initialize() { //
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new ModuleError(ErrorCodes.MODULE.ALREADY_INITIALIZED, `${this.constructor.name} is already initialized or initializing.`); // [cite: 777]
      await this._handleInternalError(err);
      return this;
    }

    // Emit module-specific initializing event
    super.emit(`${LIFECYCLE_EVENTS.INITIALIZING}:${this.constructor.name.toLowerCase()}`);
    this.state.status = SYSTEM_STATUS.INITIALIZING; // [cite: 778]
    this.state.startTime = Date.now(); // [cite: 778]

    try {
      this._validateDependencies(); // Validate dependencies now that they should be injected

      // Re-fetch eventBus here, as eventBusSystem should be initialized now
      if (this.deps.eventBusSystem && typeof this.deps.eventBusSystem.getEventBus === 'function') {
          try {
            this.eventBus = this.deps.eventBusSystem.getEventBus();
          } catch (e) {
            // eventBusSystem might throw if it's not running, treat as dependency issue
             throw new ModuleError(
                ErrorCodes.MODULE.DEPENDENCY_NOT_READY,
                `${this.constructor.name}: EventBusSystem is not ready.`,
                { moduleName: this.constructor.name, dependency: 'eventBusSystem' },
                { cause: e }
            );
          }
      } else if (!this.eventBus) { // If still no eventBus and eventBusSystem was expected
          throw new ModuleError(ErrorCodes.MODULE.INVALID_DEPENDENCY, `${this.constructor.name}: EventBus could not be obtained from EventBusSystem.`);
      }


      await this.validateConfig(); // [cite: 778]
      await this.onConfigure(); // [cite: 778]
      await this.setupEventHandlers(); // [cite: 779]
      await this.setupHealthChecks(); // [cite: 779]
      await this.onInitialize(); // [cite: 780]

      this.startHealthChecks(); // [cite: 781]

      this.state.status = SYSTEM_STATUS.RUNNING; // [cite: 782]
      this.recordMetric(`${this.constructor.name.toLowerCase()}.initialized.success`, 1);
      // Emit module-specific initialized event
      await this.emit(`module:initialized`, { // Original event name
        name: this.constructor.name,
        timestamp: new Date().toISOString(),
      });
      // Also emit standardized system event
      super.emit(`${LIFECYCLE_EVENTS.INITIALIZED}:${this.constructor.name.toLowerCase()}`, { timestamp: new Date().toISOString() });
      super.emit(`${LIFECYCLE_EVENTS.RUNNING}:${this.constructor.name.toLowerCase()}`, { timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; // [cite: 783]
      this.recordMetric(`${this.constructor.name.toLowerCase()}.initialized.failure`, 1, { error: error.code }); //
      // Log this initialization failure using internal handler
      await this._handleInternalError(error, { phase: 'initialization' }); // [cite: 785] (adapted)
      // Re-throw to signal failure to the ModuleSystem or Container
      const initFailedError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError(
        ErrorCodes.MODULE.INITIALIZATION_FAILED, // [cite: 785]
        `${this.constructor.name}: Failed to initialize.`, //
        { moduleName: this.constructor.name, originalMessage: error.message }, //
        { cause: error } //
      );
      // Emit specific error event
      await this.emit('module:error', { module: this.constructor.name, error: initFailedError, context: { phase: 'initialization' }});
      throw initFailedError; //
    }
    return this; // [cite: 783]
  }

  /**
   * Sets up default and module-specific health checks.
   */
  async setupHealthChecks() { //
    // Default state health check is already registered in constructor
    await this.onSetupHealthChecks(); // [cite: 787] Hook for subclasses
  }

  registerHealthCheck(name, checkFn) { //
    if (typeof checkFn !== 'function') { //
      const err = new ModuleError(ErrorCodes.MODULE.INVALID_HEALTH_CHECK, `${this.constructor.name}: Health check '${name}' must be a function.`); // [cite: 789]
      this._handleInternalError(err);
      throw err;
    }
    this.state.healthChecks.set(name, checkFn); //
  }

  /**
   * Starts periodic health check monitoring for this module.
   */
  startHealthChecks() { //
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.healthCheckInterval = setInterval(async () => { //
      try {
        const health = await this.checkHealth(); //
        this.state.lastHealthCheck = health; //
        if (health.status !== SYSTEM_STATUS.HEALTHY) { //
          const healthError = new ModuleError( //
            ErrorCodes.MODULE.UNHEALTHY, // Assuming this code exists [cite: 790]
            `${this.constructor.name} health check reported: ${health.status}`, //
            { moduleName: this.constructor.name, healthDetails: health } //
          );
          // Use public handleError for health issues as they are operational, not internal setup errors
          await this.handleError(healthError, { phase: 'periodic-health-check' });
        }
      } catch (error) {
        // Error in the checkHealth logic itself
        await this._handleInternalError(error, { phase: 'execute-periodic-health-check' });
      }
    }, this.healthCheckIntervalMs); // [cite: 791]
  }

  /**
   * Performs all registered health checks for this module.
   * @returns {Promise<object>} Aggregated health check result.
   */
  async checkHealth() { //
    const results = {}; //
    let overallStatus = SYSTEM_STATUS.HEALTHY; //

    for (const [name, checkFn] of this.state.healthChecks) { // [cite: 792]
      try {
        const checkResult = await checkFn(); // Expects { status, detail, errors } from createStandardHealthCheckResult
        results[name] = checkResult; //
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) { // [cite: 793]
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY && checkResult.status === SYSTEM_STATUS.DEGRADED)
            ? SYSTEM_STATUS.DEGRADED
            : SYSTEM_STATUS.UNHEALTHY; // If any is unhealthy, overall is unhealthy [cite: 794]
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]); // [cite: 795]
        overallStatus = SYSTEM_STATUS.UNHEALTHY; // [cite: 795]
      }
    }
    return { //
      name: this.constructor.name, //
      version: this.constructor.version, //
      status: overallStatus, //
      timestamp: new Date().toISOString(), //
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      errorCount: this.state.errors.length, // Internal errors of this module
      checks: results, //
    };
  }

  /**
   * Public method to handle errors occurring within the module's operations.
   * Logs the error, forwards to ErrorSystem, and emits a module:error event.
   * @param {Error} error - The error object.
   * @param {object} [context={}] - Additional context.
   * @returns {Promise<CoreModule>} This instance.
   */
  async handleError(error, context = {}) { //
    // Ensure error is an instance of CoreError or its subclasses
    const errorToHandle = !(error instanceof CoreError)
        ? new ModuleError(ErrorCodes.MODULE.OPERATION_FAILED || 'OPERATION_FAILED', error.message, context, { cause: error })
        : error;

    // Log to internal state errors array
    this.state.errors.push({ error: errorToHandle, timestamp: new Date().toISOString(), context: context || {} }); // [cite: 797]
    if (this.state.errors.length > (this.config?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) { //
      this.state.errors.shift(); // [cite: 798]
    }
    this.recordMetric(`${this.constructor.name.toLowerCase()}.errors.operational`, 1, { errorName: errorToHandle.name, errorCode: errorToHandle.code });

    // Forward to global ErrorSystem
    await safeHandleError(this.deps.errorSystem, errorToHandle, { //
      module: this.constructor.name, //
      ...(context || {}) //
    });

    // Emit module-specific error event
    // Use super.emit to avoid potential loop if this.emit is overridden with complex logic
    // that itself could error and call handleError.
    super.emit('module:error', { //
      module: this.constructor.name, //
      error: errorToHandle, //
      context: context || {} //
    });
    return this; // [cite: 802]
  }

  /**
   * Emits an event locally on this module instance and broadcasts it via the global EventBus.
   * @param {string} eventName - The name of the event.
   * @param {...any} args - Arguments to pass to the event listeners and EventBus.
   * @returns {Promise<boolean>} Result of local emission.
   */
  async emit(eventName, ...args) { //
    // Local emission using EventEmitter's emit
    const localEmitResult = super.emit(eventName, ...args); // [cite: 803]

    // Broadcast through global EventBus if available and the module is running
    if (this.eventBus && typeof this.eventBus.emit === 'function' && this.state.status === SYSTEM_STATUS.RUNNING) { // [cite: 803]
      try {
        // CoreEventBus.emit expects (eventName, data, options)
        // Assume args[0] is data, and args[1] (if present) is options for CoreEventBus
        await this.eventBus.emit(eventName, args[0], args[1] || {}); // [cite: 804]
      } catch (busError) {
        // Handle error from eventBus.emit itself
        await this.handleError(busError, { //
          phase: 'event-bus-emit', //
          event: eventName, //
          argsSummary: args.map(arg => typeof arg).join(', ')
        });
        // Do not rethrow busError here as localEmit might have succeeded.
        // The error is handled and logged.
      }
    }
    return localEmitResult; // [cite: 806]
  }

  /**
   * Shuts down the module, cleaning up resources.
   * @returns {Promise<CoreModule>} This instance.
   */
  async shutdown() { //
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { // [cite: 807]
      return this; //
    }
    super.emit(`${LIFECYCLE_EVENTS.SHUTTING_DOWN}:${this.constructor.name.toLowerCase()}`);
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; // [cite: 807]
    const shutdownStartTime = Date.now();

    if (this.healthCheckInterval) { // [cite: 808]
      clearInterval(this.healthCheckInterval); //
      this.healthCheckInterval = null; // [cite: 808]
    }

    try {
      await this.onShutdown(); // Hook for subclass cleanup [cite: 809]

      this.state.status = SYSTEM_STATUS.SHUTDOWN; // [cite: 809]
      this.state.startTime = null; // [cite: 809]
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric(`${this.constructor.name.toLowerCase()}.shutdown.time`, shutdownTime);
      this.recordMetric(`${this.constructor.name.toLowerCase()}.shutdown.success`, 1);
      // Emit module-specific shutdown event
      await this.emit('module:shutdown', { // Original event name
        name: this.constructor.name,
        timestamp: new Date().toISOString(),
      });
      // Also emit standardized system event
      super.emit(`${LIFECYCLE_EVENTS.SHUTDOWN}:${this.constructor.name.toLowerCase()}`, { timestamp: new Date().toISOString(), durationMs: shutdownTime });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; // [cite: 811]
      this.recordMetric(`${this.constructor.name.toLowerCase()}.shutdown.failure`, 1, { error: error.code }); // [cite: 813] (adapted)
      await this._handleInternalError(error, { phase: 'shutdown' }); // (adapted)
      const shutdownFailedError = error instanceof ModuleError || error instanceof ValidationError ? error : new ModuleError( //
        ErrorCodes.MODULE.SHUTDOWN_FAILED, // [cite: 813]
        `${this.constructor.name}: Failed to shutdown.`, //
        { moduleName: this.constructor.name, originalMessage: error.message }, //
        { cause: error } //
      );
      await this.emit('module:error', { module: this.constructor.name, error: shutdownFailedError, context: { phase: 'shutdown' }});
      throw shutdownFailedError; //
    }
    return this; // [cite: 811]
  }

  // --- Lifecycle Hooks for subclasses to override ---
  async onValidateConfig() { return true; } //
  async onConfigure() { /* Default: no-op */ } //
  async setupEventHandlers() { /* Default: no-op */ } //
  async onSetupHealthChecks() { /* Default: no-op */ } //
  async onInitialize() { /* Default: no-op */ } //
  async onShutdown() { /* Default: no-op */ } //

  // --- Metrics ---
  recordMetric(name, value, tags = {}) { // [cite: 821]
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags }); //
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
        version: CoreModule.version,
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
export function createModule(deps = {}) { //
  const defaultDeps = { //
    errorSystem: { //
      handleError: async (error, context) => { console.error("Default No-Op ErrorSystem:", error, context); }
    },
    eventBusSystem: { //
      getEventBus: () => { //
        // Return a simple EventEmitter or a minimal CoreEventBus mock if no full bus needed for tests
        // For robustness, if createEventBus is available, use it.
        // This default is primarily for isolated testing or if eventBus is truly optional.
        try {
            return new CoreEventBus({ // [cite: 822] (adjusted to use CoreEventBus)
                errorSystem: deps.errorSystem || { handleError: async () => {} },
                config: deps.config || {}
            });
        } catch(e) {
            console.warn("Failed to create default CoreEventBus in createModule, falling back to EventEmitter", e);
            return new EventEmitter();
        }
      }
    },
    config: {} // [cite: 822]
  };
  const mergedDeps = { //
    ...defaultDeps,
    ...deps,
    // Ensure specific config for the module is under the 'config' key passed to constructor
    config: deps.config || defaultDeps.config // This `deps.config` is the module-specific config
  };
  return new CoreModule(mergedDeps); //
}

// Default export was an object in original file. Exporting class and factory separately is more common for ES Modules.
// export default { CoreModule, createModule };