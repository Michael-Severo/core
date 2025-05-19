/**
 * @file ErrorSystem.js
 * @description Manages error types, framework integrations, and centralized error handling.
 */

import { EventEmitter } from 'events';
import { CoreError } from './CoreError.js';
import * as ErrorTypes from './types/index.js'; // Assuming types/index.js exports all named error types
import { ErrorCodes } from './ErrorCodes.js'; // Assuming ErrorCodes are in their own file
import { FastifyErrorHandler } from './integrations/fastify/FastifyErrorHandler.js'; // Adjusted import
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class ErrorSystem extends EventEmitter {
  static dependencies = ['logger', 'config']; // config might be used for maxErrorHistory etc.
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new ErrorSystem instance.
   * @param {object} [deps={}] - Dependencies for the ErrorSystem.
   * @param {object} [deps.logger=console] - Logger instance.
   * @param {object} [deps.config={}] - Configuration object.
   */
  constructor(deps = {}) {
    super();
    this.deps = {
      logger: deps.logger || console,
      config: deps.config || {},
      // ErrorSystem does not depend on itself for safeHandleError
    };

    this.errorTypes = new Map(Object.entries(ErrorTypes));
    this.customHandlers = new Map(); // Renamed from 'handlers' to be more specific
    this.integrations = new Map();
    this.initialized = false; // Will be driven by state.status

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of ErrorSystem
      metrics: new Map(),
      healthChecks: new Map(),
    };

    // Ensure a default handler is always present for unhandled CoreErrors
    this.registerHandler(CoreError.name, this.defaultCoreErrorHandler.bind(this)); // More specific default
    this.registerHealthCheck('errorsystem.state', this.checkSystemState.bind(this));
    this.registerHealthCheck('errorsystem.handlers', this.checkHandlerStatus.bind(this));
    this.registerHealthCheck('errorsystem.integrations', this.checkIntegrationStatus.bind(this));
  }

  /**
   * Initializes the ErrorSystem.
   * Validates error types and sets up the system.
   * @returns {Promise<ErrorSystem>}
   */
  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      // Use internal handler for this operational error
      const err = new CoreError(
        ErrorCodes.CORE.ALREADY_INITIALIZED, // Assuming such a code exists or is added
        'ErrorSystem is already initialized or initializing.'
      );
      await this._handleInternalError(err, { currentStatus: this.state.status });
      return this; // Or throw err if preferred
    }

    this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'ErrorSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    this.state.startTime = Date.now();

    try {
      // Validate registered error types
      for (const [name, ErrorTypeClass] of this.errorTypes) {
        if (!(ErrorTypeClass.prototype instanceof CoreError)) {
          throw new CoreError(
            ErrorCodes.CORE.INVALID_TYPE, // Assuming a general invalid type code
            `Registered error type '${name}' must extend CoreError.`
          );
        }
      }

      // Potentially initialize default integrations if specified in config
      // Example: if (this.deps.config.errorSystem?.defaultIntegration === 'fastify') { ... }

      this.initialized = true; // Redundant with state.status but kept for current compatibility
      this.state.status = SYSTEM_STATUS.RUNNING;
      this.recordMetric('errorsystem.initialized.success', 1, { timestamp: Date.now() });
      this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'ErrorSystem', timestamp: new Date().toISOString() });
      this.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'ErrorSystem', timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('errorsystem.initialized.failure', 1, { error: error.code, timestamp: Date.now() });
      await this._handleInternalError(error, { phase: 'initialization' });
      // Re-throw to signal catastrophic failure of ErrorSystem initialization
      throw error instanceof CoreError ? error : new CoreError(
        ErrorCodes.CORE.INITIALIZATION_FAILED,
        'ErrorSystem failed to initialize.',
        { originalMessage: error.message },
        { cause: error }
      );
    }
    return this;
  }

  /**
   * Registers a specific error handler for a given error type name.
   * @param {string} errorTypeName - The name of the error class (e.g., 'ValidationError', 'CoreError').
   * @param {Function} handler - The async function to handle the error: async (error, context) => {}.
   */
  registerHandler(errorTypeName, handler) {
    if (typeof handler !== 'function') {
      const err = new CoreError(ErrorCodes.CORE.INVALID_HANDLER, 'Error handler must be a function.', { errorTypeName }); //
      this._handleInternalError(err); // Log internal error
      throw err; // Throw for immediate feedback
    }
    if (typeof errorTypeName !== 'string' || !errorTypeName.trim()) {
        const err = new CoreError(ErrorCodes.CORE.INVALID_TYPE, 'Error type name must be a non-empty string.', { handlerName: handler.name });
        this._handleInternalError(err);
        throw err;
    }
    this.customHandlers.set(errorTypeName, handler);
    this.recordMetric('errorsystem.handlers.registered', 1, { errorTypeName });
  }

  /**
   * Registers and initializes a framework integration.
   * @param {string} integrationName - A name for the integration (e.g., 'fastify').
   * @param {IFrameworkIntegration} IntegrationClass - The class for the framework integration (e.g., FastifyErrorHandler).
   * @param {object} frameworkInstance - The instance of the web framework (e.g., Fastify app).
   * @param {object} [options={}] - Options to pass to the integration's initialize method.
   * @returns {Promise<object>} The initialized integration instance.
   */
  async registerIntegration(integrationName, IntegrationClass, frameworkInstance, options = {}) {
    if (!integrationName || typeof integrationName !== 'string') {
        const err = new CoreError(ErrorCodes.CORE.INVALID_ARGUMENT, 'Integration name must be a non-empty string.');
        await this._handleInternalError(err);
        throw err;
    }
    if (!IntegrationClass || typeof IntegrationClass !== 'function' || !IntegrationClass.prototype || typeof IntegrationClass.prototype.initialize !== 'function') {
        const err = new CoreError(ErrorCodes.CORE.INVALID_ARGUMENT, `IntegrationClass for '${integrationName}' is invalid or does not have an initialize method.`);
        await this._handleInternalError(err);
        throw err;
    }
     if (!frameworkInstance) {
        const err = new CoreError(ErrorCodes.CORE.INVALID_ARGUMENT, `Framework instance for '${integrationName}' is required.`);
        await this._handleInternalError(err);
        throw err;
    }

    try {
      const integration = new IntegrationClass(this); // Pass ErrorSystem instance if needed by integration
      await integration.initialize(frameworkInstance, options); // Ensure initialize is async if it does async work
      this.integrations.set(integrationName, integration);
      this.recordMetric('errorsystem.integrations.registered', 1, { integrationName });
      return integration;
    } catch (error) {
      const err = new CoreError(
          ErrorCodes.CORE.INTEGRATION_FAILED, // Assuming such code exists
          `Failed to register or initialize integration '${integrationName}'.`,
          { integrationName, originalMessage: error.message },
          { cause: error }
      );
      await this._handleInternalError(err);
      throw err;
    }
  }


  /**
   * Handles an error by finding the appropriate registered handler or using the default.
   * @param {Error} error - The error object. Must be an instance of CoreError or its subclass.
   * @param {object} [context={}] - Additional context about where/how the error occurred.
   */
  async handleError(error, context = {}) {
    this.recordMetric('errorsystem.errors.received', 1, { errorName: error.name, errorCode: error.code });

    // Ensure the error is a CoreError or subclass, or wrap it.
    let processedError = error;
    if (!(error instanceof CoreError)) {
      this.deps.logger.warn('[ErrorSystem] Received non-CoreError. Wrapping it:', { originalError: error, context });
      processedError = new CoreError(
        ErrorCodes.CORE.UNKNOWN, //
        error.message || 'An unknown error occurred.',
        { originalErrorName: error.name, context },
        { cause: error }
      );
    }

    // Find the most specific handler
    let handler = this.customHandlers.get(processedError.constructor.name) ||
                  this.customHandlers.get(CoreError.name); // Fallback to default CoreError handler

    if (!handler) {
        // This should ideally not happen if CoreError.name handler is always registered
        this.deps.logger.error('[ErrorSystem] No default CoreError handler found. Logging directly.', {
            error: processedError.toJSON(), // Use toJSON for structured logging
            context
        });
        this.emit('error:unhandled', { error: processedError, context }); //
        return;
    }

    try {
      await handler(processedError, context);
      this.emit('error:handled', { error: processedError, context, handler: handler.name }); //
    } catch (handlerError) {
      this.deps.logger.error('[ErrorSystem] Error handler itself failed:', {
        handlerName: handler.name,
        originalError: processedError.toJSON(),
        handlerError: (handlerError instanceof CoreError) ? handlerError.toJSON() : { message: handlerError.message, name: handlerError.name },
        context
      });
      this.emit('error:handler_failed', { error: handlerError, originalError: processedError, context }); //
      // Decide if handlerError should be re-thrown or if ErrorSystem absorbs it
    }
  }

  /**
   * Default handler for CoreError instances if no more specific handler is found.
   * @private
   */
  defaultCoreErrorHandler(error, context = {}) {
    this.deps.logger.error(`[ErrorSystem DefaultHandler] Unhandled CoreError:`, {
      error: error.toJSON(), // Use toJSON for structured logging
      context,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Creates an instance of a registered error type.
   * @param {string} typeName - The name of the error type (e.g., 'ValidationError').
   * @param {string} code - The specific error code.
   * @param {string} message - The error message.
   * @param {object} [details={}] - Additional error details.
   * @param {object} [options={}] - Error options, including 'cause'.
   * @returns {CoreError} An instance of the specified error type, or CoreError if type not found.
   */
  createError(typeName, code, message, details = {}, options = {}) {
    const ErrorTypeClass = this.errorTypes.get(typeName) || CoreError;
    // If ErrorTypeClass is CoreError itself and typeName was different, it means the specific type wasn't found.
    // The 'code' for specific errors usually doesn't include the prefix (e.g., just 'INVALID_INPUT' for ValidationError).
    // The prefix is added by the subclass constructor.
    if (ErrorTypeClass === CoreError && typeName !== CoreError.name) {
        this.deps.logger.warn(`[ErrorSystem] createError: Type '${typeName}' not found, defaulting to CoreError. Code: ${code}`);
    }
    return new ErrorTypeClass(code, message, details, options);
  }

  /**
   * Gracefully shuts down the ErrorSystem.
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
      return;
    }
    this.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'ErrorSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN;

    try {
      // Perform any cleanup for integrations if they have a shutdown method
      for (const [name, integration] of this.integrations) {
        if (typeof integration.shutdown === 'function') {
          await integration.shutdown();
        }
      }
      this.integrations.clear();
      this.customHandlers.clear();
      // this.errorTypes.clear(); // Usually, error type definitions are static and don't need clearing

      this.removeAllListeners(); // Clear all event listeners for this ErrorSystem instance

      this.initialized = false;
      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.recordMetric('errorsystem.shutdown.success', 1, { timestamp: Date.now() });
      // Cannot emit shutdown if all listeners are removed, log instead or emit before removeAllListeners
      this.deps.logger.info('[ErrorSystem] Shutdown complete.');
      // If you want to emit a shutdown event, do it before removeAllListeners()
      // this.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'ErrorSystem', timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('errorsystem.shutdown.failure', 1, { error: error.code, timestamp: Date.now() });
      // Use console.error directly as _handleInternalError might try to use parts of a shutdown system
      console.error('[ErrorSystem] Shutdown failed:', error);
      // Do not re-throw during shutdown of ErrorSystem itself unless absolutely necessary
    }
  }

  // --- State, Health, Metrics ---
  /**
   * Handles internal operational errors of the ErrorSystem.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const internalError = !(error instanceof CoreError) ? new CoreError(ErrorCodes.CORE.INTERNAL, error.message, context, { cause: error }) : error;

    this.state.errors.push({ error: internalError, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    // Log directly to prevent loops if ErrorSystem.handleError is itself broken
    this.deps.logger.error('[ErrorSystem Internal]', internalError.toJSON());
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
        const err = new CoreError(ErrorCodes.CORE.INVALID_HANDLER, `Health check '${name}' must be a function.`);
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
        const checkResult = await checkFn(); // Expects { status, detail, errors }
        results[name] = checkResult;
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) {
          // If any check is unhealthy, the system might be degraded or unhealthy
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY) ? SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY;
          if (checkResult.status === SYSTEM_STATUS.UNHEALTHY) overallStatus = SYSTEM_STATUS.UNHEALTHY;
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]);
        overallStatus = SYSTEM_STATUS.UNHEALTHY;
      }
    }

    return {
      name: this.constructor.name,
      version: ErrorSystem.version,
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
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        internalErrorCount: this.state.errors.length
      }
    );
  }

  async checkHandlerStatus() {
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      customHandlerCount: this.customHandlers.size,
      registeredHandlerKeys: Array.from(this.customHandlers.keys())
    });
  }

  async checkIntegrationStatus() {
    const integrationDetails = {};
    let allIntegrationsHealthy = true;
    for (const [name, integration] of this.integrations) {
        if (typeof integration.checkHealth === 'function') {
            try {
                const iHealth = await integration.checkHealth();
                integrationDetails[name] = iHealth;
                if (iHealth.status !== SYSTEM_STATUS.HEALTHY) allIntegrationsHealthy = false;
            } catch (e) {
                integrationDetails[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Integration health check failed' }, [e]);
                allIntegrationsHealthy = false;
            }
        } else {
            integrationDetails[name] = createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, { status: 'No health check available' });
        }
    }
    return createStandardHealthCheckResult(
      allIntegrationsHealthy ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.DEGRADED,
      {
        integrationCount: this.integrations.size,
        registeredIntegrationKeys: Array.from(this.integrations.keys()),
        details: integrationDetails
      }
    );
  }

  getSystemStatus() { // For consistency with other systems if they have this
    return {
        name: this.constructor.name,
        version: ErrorSystem.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString()
    };
  }
}

/**
 * Factory function for creating an ErrorSystem instance.
 * @param {object} [deps={}] - Dependencies for the ErrorSystem.
 * @returns {ErrorSystem}
 */
export function createErrorSystem(deps = {}) {
  return new ErrorSystem(deps);
}