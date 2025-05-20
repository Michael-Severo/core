/**
 * @file EventBusSystem.js
 * @description Manages the CoreEventBus and provides system-level eventing capabilities.
 */

import { EventEmitter } from 'events';
import { CoreEventBus } from './CoreEventBus.js';
import { EventError } from '../errors/index.js'; // Assuming errors/index.js exports EventError
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class EventBusSystem extends EventEmitter {
  static dependencies = ['errorSystem', 'config']; //
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new EventBusSystem instance.
   * @param {object} [deps={}] - Dependencies for the EventBusSystem.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance.
   * @param {object} [deps.config={}] - Configuration object.
   */
  constructor(deps = {}) { //
    super();
    this.deps = {
      errorSystem: deps.errorSystem, // Will be validated in validateDependencies
      config: deps.config || {}, //
    };

    this.eventBus = null; // Will be an instance of CoreEventBus
    // this.initialized is now driven by this.state.status
    this._forwardingInitialized = false; // Instance flag for event forwarding setup

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of EventBusSystem itself
      metrics: new Map(),
      healthChecks: new Map(),
    }; //

    this.validateDependencies(); // Validate early
    this.setupDefaultHealthChecks(); //
  }

  /**
   * Validates that required dependencies are provided and are valid.
   * @private
   */
  validateDependencies() { //
    const missing = EventBusSystem.dependencies.filter(dep => !this.deps[dep]); //
    if (missing.length > 0) { //
      throw new EventError( // Use EventError for its own domain
        ErrorCodes.EVENT.MISSING_DEPENDENCIES, // Uses unprefixed
        `EventBusSystem: Missing required dependencies: ${missing.join(', ')}`, //
        { missingDeps: missing } //
      );
    }
    if (this.deps.errorSystem && typeof this.deps.errorSystem.handleError !== 'function') { //
      throw new EventError( //
        ErrorCodes.EVENT.INVALID_DEPENDENCY, // Uses unprefixed
        'EventBusSystem: ErrorSystem dependency is invalid (missing handleError method).', //
        { dependency: 'errorSystem' } //
      );
    }
  }

  /**
   * Handles internal operational errors of the EventBusSystem.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof EventError)
      ? new EventError(ErrorCodes.EVENT.INTERNAL_ERROR, error.message, context, { cause: error }) // Uses unprefixed
      : error;
    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.eventBusSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift(); //
    }
    this.recordMetric('eventbussystem.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'EventBusSystem', ...context }); //
  }

  /**
   * Initializes the EventBusSystem and the underlying CoreEventBus.
   * @returns {Promise<EventBusSystem>}
   */
  async initialize() { //
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new EventError(ErrorCodes.EVENT.ALREADY_INITIALIZED, 'EventBusSystem is already initialized or initializing.'); // Uses unprefixed
      await this._handleInternalError(err, { currentStatus: this.state.status }); //
      return this; //
    }

    this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'EventBusSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING; //
    this.state.startTime = Date.now(); //

    try {
      // Create and initialize the CoreEventBus instance
      // Pass system dependencies to CoreEventBus
      this.eventBus = new CoreEventBus({
        errorSystem: this.deps.errorSystem,
        config: this.deps.config, // Pass the whole config, CoreEventBus can pick what it needs
      }); //
      await this.eventBus.initialize(); //

      this.setupEventForwarding(); //

      this.state.status = SYSTEM_STATUS.RUNNING; //
      this.recordMetric('eventbussystem.initialized.success', 1, { timestamp: Date.now() }); //
      this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'EventBusSystem', timestamp: new Date().toISOString() }); //
      this.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'EventBusSystem', timestamp: new Date().toISOString() }); //
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('eventbussystem.initialized.failure', 1, { error: error.code, timestamp: Date.now() }); //
      await this._handleInternalError(error, { phase: 'initialization' }); //
      throw error instanceof EventError ?
      error : new EventError( //
        ErrorCodes.EVENT.INITIALIZATION_FAILED, // Uses unprefixed //
        'EventBusSystem failed to initialize.', //
        { originalMessage: error.message }, //
        { cause: error } //
      );
    }
    return this;
  }

  /**
   * Sets up event forwarding from the CoreEventBus to this EventBusSystem.
   * This allows listeners on EventBusSystem to receive events emitted on CoreEventBus.
   * @private
   */
  setupEventForwarding() { //
    if (!this.eventBus || this._forwardingInitialized) { //
      return; //
    }

    this.eventBus.on('*', (event) => { // `event` here is the full event object
      if (event && typeof event.name === 'string') { //
        if (event.name && !event.name.startsWith('system:')) {
             super.emit(event.name, event); //
        }

        if (event.name === LIFECYCLE_EVENTS.INITIALIZED && event.system === 'CoreEventBus') {
            super.emit('coreEventBus:initialized', event); //
        }
        if (event.name === LIFECYCLE_EVENTS.SHUTDOWN && event.system === 'CoreEventBus') {
            super.emit('coreEventBus:shutdown', event); //
        }

      } else if (event) {
        this._handleInternalError(new EventError(ErrorCodes.EVENT.LEGACY_WILDCARD_FORWARD, "Legacy wildcard format received by EventBusSystem forwarder."), { eventArg: event }); // Uses unprefixed
      }
    });
    this._forwardingInitialized = true; //
  }

  /**
   * Emits an event.
   * Primarily, this system manages CoreEventBus. Direct emission from EventBusSystem
   * should be for its own lifecycle or specific system-level events.
   * Application events should be emitted via the CoreEventBus instance.
   * @param {string} eventName - Event name.
   * @param {...any} args - Event arguments.
   * @returns {Promise<boolean>}
   */
  async emit(eventName, ...args) { //
    const localEmitResult = super.emit(eventName, ...args); //

    if (this.eventBus && typeof this.eventBus.emit === 'function' &&
        !eventName.startsWith('system:') && !eventName.startsWith('coreEventBus:')) { //
      try {
        await this.eventBus.emit(eventName, ...args); //
      } catch (error) {
        await this._handleInternalError(error, { phase: 'emit-forward', eventName }); //
      }
    }
    return localEmitResult; //
  }


  getEventBus() { //
    if (this.state.status !== SYSTEM_STATUS.RUNNING) { //
      throw new EventError( //
        ErrorCodes.EVENT.NOT_INITIALIZED, // Uses unprefixed
        'EventBusSystem (or its CoreEventBus) is not initialized or not running.', //
        { currentStatus: this.state.status } //
      );
    }
    return this.eventBus; //
  }

  async shutdown() { //
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { //
      return this; //
    }
    this.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'EventBusSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; //

    try {
      if (this.eventBus) { //
        await this.eventBus.shutdown(); //
      }
      super.removeAllListeners(); // Clear EventBusSystem's own listeners

      this.eventBus = null; //
      this.state.status = SYSTEM_STATUS.SHUTDOWN; //
      this.state.startTime = null; //
      this.recordMetric('eventbussystem.shutdown.success', 1, { timestamp: Date.now() }); //
      this.deps.logger?.info('[EventBusSystem] Shutdown complete.'); //
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('eventbussystem.shutdown.failure', 1, { error: error.code, timestamp: Date.now() }); //
      await this._handleInternalError(error, { phase: 'shutdown' }); //
      throw error instanceof EventError ?
      error : new EventError( //
        ErrorCodes.EVENT.SHUTDOWN_FAILED, // Uses unprefixed //
        'EventBusSystem failed to shutdown.', //
        { originalMessage: error.message }, //
        { cause: error } //
      );
    }
    return this; //
  }

  // --- State, Health, Metrics ---
  setupDefaultHealthChecks() { //
    this.registerHealthCheck('eventbussystem.state', this.checkSystemState.bind(this)); //
    this.registerHealthCheck('eventbussystem.corebus', this.checkCoreBusHealth.bind(this)); //
  }

  recordMetric(name, value, tags = {}) { //
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags }); //
  }

  getMetrics() { //
    const metrics = {}; //
    for (const [name, data] of this.state.metrics) { //
      metrics[name] = data; //
    }
    return metrics; //
  }

  registerHealthCheck(name, checkFn) { //
    if (typeof checkFn !== 'function') {
      const err = new EventError(ErrorCodes.EVENT.INVALID_HANDLER, `Health check '${name}' must be a function.`); // Uses unprefixed
      this._handleInternalError(err); // Log, but rethrow //
      throw err; //
    }
    this.state.healthChecks.set(name, checkFn); //
  }

  async checkHealth() { //
    const results = {}; //
    let overallStatus = SYSTEM_STATUS.HEALTHY; //

    for (const [name, checkFn] of this.state.healthChecks) { //
      try {
        const checkResult = await checkFn(); //
        results[name] = checkResult; //
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) { //
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY) ?
          SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY; //
          if (checkResult.status === SYSTEM_STATUS.UNHEALTHY) overallStatus = SYSTEM_STATUS.UNHEALTHY; //
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]); //
        overallStatus = SYSTEM_STATUS.UNHEALTHY; //
      }
    }
    return { //
      name: this.constructor.name, //
      version: EventBusSystem.version, //
      status: overallStatus, //
      timestamp: new Date().toISOString(), //
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, //
      errorCount: this.state.errors.length,
      checks: results, //
    };
  }

  async checkSystemState() { //
    return createStandardHealthCheckResult( //
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY, //
      { //
        status: this.state.status, //
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, //
        internalErrorCount: this.state.errors.length //
      }
    );
  }

  async checkCoreBusHealth() { //
    if (!this.eventBus || typeof this.eventBus.checkHealth !== 'function') { //
      return createStandardHealthCheckResult( //
        SYSTEM_STATUS.UNHEALTHY, //
        { reason: 'CoreEventBus not available or does not support health checks.' } //
      );
    }
    try {
      return await this.eventBus.checkHealth(); //
    } catch (error) {
      return createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'CoreEventBus health check failed.' }, [error]); //
    }
  }

  getSystemStatus() { //
    return { //
        name: this.constructor.name, //
        version: EventBusSystem.version, //
        status: this.state.status, //
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, //
        initialized: this.state.status === SYSTEM_STATUS.RUNNING, //
        errorCount: this.state.errors.length, //
        timestamp: new Date().toISOString(), //
        coreEventBusStatus: this.eventBus ? this.eventBus.getSystemStatus().status : (SYSTEM_STATUS.UNAVAILABLE || 'unavailable') //
    };
  }
}

/**
 * Factory function for creating an EventBusSystem instance.
 * @param {object} [deps={}] - Dependencies for the EventBusSystem.
 * @returns {EventBusSystem}
 */
export function createEventBusSystem(deps = {}) { //
  return new EventBusSystem(deps); //
}