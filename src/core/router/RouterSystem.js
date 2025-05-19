/**
 * @file RouterSystem.js
 * @description System for centralized route management, managing CoreRouter and its integrations.
 */

import { EventEmitter } from "events";
import { CoreRouter } from "./CoreRouter.js";
import { RouterError } from "../errors/index.js"; // Assuming errors/index.js exports RouterError
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class RouterSystem extends EventEmitter {
  static dependencies = ["errorSystem", "eventBusSystem", "config"]; // [cite: 1200]
  static version = "2.0.0"; // Example version bump [cite: 1200]

  /**
   * Creates a new RouterSystem instance.
   * @param {object} [deps={}] - Dependencies for the RouterSystem.
   */
  constructor(deps = {}) { // Changed from constructor(deps) [cite: 1201]
    super();
    this.deps = { //
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {},
    };

    this.router = null; // Will be an instance of CoreRouter [cite: 1201]
    // this.initialized is driven by this.state.status

    this.state = { // (aligning with standard)
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of RouterSystem
      metrics: new Map(),
      healthChecks: new Map(),
    };

    this._validateDependencies(); // [cite: 1202] (called early)
    this.setupDefaultHealthChecks(); //
  }

  /** @private */
  _validateDependencies() { //
    const missing = RouterSystem.dependencies.filter(dep => !this.deps[dep]); // [cite: 1204]
    if (missing.length > 0) {
      throw new RouterError(ErrorCodes.ROUTER.MISSING_DEPENDENCIES, `RouterSystem: Missing required dependencies: ${missing.join(", ")}`, { missingDeps: missing }); //
    }
    if (!this.deps.eventBusSystem || typeof this.deps.eventBusSystem.getEventBus !== "function") { //
      throw new RouterError(ErrorCodes.ROUTER.INVALID_DEPENDENCY, "RouterSystem: EventBusSystem is invalid.", { dependency: "eventBusSystem" });
    }
    if (!this.deps.errorSystem || typeof this.deps.errorSystem.handleError !== "function") { //
      throw new RouterError(ErrorCodes.ROUTER.INVALID_DEPENDENCY, "RouterSystem: ErrorSystem is invalid.", { dependency: "errorSystem" });
    }
  }

  /** @private */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof RouterError)
      ? new RouterError(ErrorCodes.ROUTER.SYSTEM_INTERNAL_ERROR || 'SYSTEM_INTERNAL_ERROR', error.message, context, { cause: error })
      : error;

    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.routerSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('routersystem.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'RouterSystem', ...context });
  }

  /**
   * Initializes the RouterSystem and the underlying CoreRouter.
   * @returns {Promise<RouterSystem>} This instance.
   */
  async initialize() { //
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new RouterError(ErrorCodes.ROUTER.ALREADY_INITIALIZED, "RouterSystem is already initialized or initializing.", { state: this.state.status }); //
      await this._handleInternalError(err);
      return this;
    }

    super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'RouterSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING; //
    this.state.startTime = Date.now(); // [cite: 1217]

    try {
      this.router = new CoreRouter(this.deps); //
      this._setupEventForwarding(); // (renamed from setupEventForwarding)
      await this.router.initialize(); // [cite: 1219]

      this.state.status = SYSTEM_STATUS.RUNNING; //
      this.recordMetric('routersystem.initialized.success', 1); //
      super.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'RouterSystem', timestamp: new Date().toISOString() }); // (using super.emit)
      super.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'RouterSystem', timestamp: new Date().toISOString() });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('routersystem.initialized.failure', 1, { error: error.code }); //
      await this._handleInternalError(error, { phase: 'initialization' }); // [cite: 1225] (adapted)
      throw error instanceof RouterError ? error : new RouterError( //
        ErrorCodes.ROUTER.INITIALIZATION_FAILED, //
        "RouterSystem failed to initialize.", //
        { originalMessage: error.message }, //
        { cause: error } //
      );
    }
    return this;
  }

  /** @private */
  _setupEventForwarding() { // (was setupEventForwarding)
    if (!this.router) return; //

    const forward = (eventName, systemEventName) => {
      this.router.on(eventName, (eventData) => { //
        // Use RouterSystem's own emit for these system-level event aggregations/translations
        this.emit(systemEventName, eventData); //
        // Original also re-emitted with original name, which might be desirable for some listeners
        this.emit(eventName, eventData); //
      });
    };

    forward('route:registered', 'system:route:registered'); //
    forward('route:unregistered', 'system:route:unregistered'); //
    forward('routes:applied', 'system:routes:applied'); //
    forward('routes:cleared', 'system:routes:cleared'); //
    forward('adapter:registered', 'system:adapter:registered'); //
    forward('middleware:registered', 'system:middleware:registered'); //

    this.router.on('router:error', (eventData) => { //
      // For errors from CoreRouter, RouterSystem should handle them via its own error system
      // and then emit a system-level error.
      const { error: crError, context: crContext } = eventData;
      this._handleInternalError(crError, { ...crContext, sourceDetail: 'CoreRouterEvent' }); // Log it as an internal error RouterSystem is aware of
      this.emit('system:error', eventData); // Forward the original event structure
      // this.emit('router:error', eventData); // Also re-emit original
    });
  }

  /**
   * Public method to handle errors, typically forwarded from CoreRouter or other operations.
   * This method is distinct from _handleInternalError which is for RouterSystem's own direct errors.
   * This aligns with the public handleError in the original RouterSystem.
   */
  async handleError(error, context = {}) { // (keeping public handleError)
    // This function is primarily for errors that RouterSystem itself catches from its operations
    // (like calls to this.router.X), not for _every_ error that CoreRouter might emit.
    // CoreRouter's errors are caught by _setupEventForwarding if emitted as 'router:error'.
    this.state.errors.push({ error, timestamp: new Date().toISOString(), context: context || {} }); //
    if (this.state.errors.length > (this.deps.config?.routerSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) { //
      this.state.errors.shift();
    }
    this.recordMetric('routersystem.errors.operational', 1, { errorName: error.name, errorCode: error.code }); //

    await safeHandleError(this.deps.errorSystem, error, { source: 'RouterSystem', ...context }); //

    super.emit('system:error', { error, context, timestamp: new Date().toISOString() }); // (use super.emit)
  }


  getRouter() { //
    if (this.state.status !== SYSTEM_STATUS.RUNNING) {
      throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "RouterSystem is not running, cannot get router.", { state: this.state.status }); //
    }
    return this.router;
  }

  // --- Delegated CoreRouter Methods ---
  // These methods delegate to CoreRouter, adding RouterSystem-level metrics and error handling.

  async registerRoute(moduleId, method, path, handler, options = {}) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      this.router.registerRoute(moduleId, method, path, handler, options); //
      this.recordMetric('routersystem.routes.registered', 1, { moduleId, method: method.toUpperCase() }); //
      return this; //
    } catch (error) {
      await this.handleError(error, { phase: 'registerRoute', moduleId, method, path }); // (use public handleError)
      throw error; // Re-throw the original RouterError
    }
  }

  async registerVersionedRoute(moduleId, version, method, path, handler, options = {}) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      this.router.registerVersionedRoute(moduleId, version, method, path, handler, options); //
      this.recordMetric('routersystem.routes.versioned.registered', 1, { moduleId, version, method: method.toUpperCase() }); //
      return this; //
    } catch (error) {
      await this.handleError(error, { phase: 'registerVersionedRoute', moduleId, version, method, path }); //
      throw error;
    }
  }

  registerAdapter(name, adapter) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      this.router.registerAdapter(name, adapter); //
      this.recordMetric('routersystem.adapters.registered', 1, { adapterName: name }); //
      return this; //
    } catch (error) {
      this.handleError(error, { phase: 'registerAdapter', adapterName: name }); // (error is RouterError from CoreRouter)
      throw error;
    }
  }

  registerMiddleware(name, handler, options = {}) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      this.router.registerMiddleware(name, handler, options); //
      this.recordMetric('routersystem.middleware.registered', 1, { middlewareName: name }); //
      return this; //
    } catch (error) {
      this.handleError(error, { phase: 'registerMiddleware', middlewareName: name }); //
      throw error;
    }
  }

  async applyRoutes(framework, adapterName) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      const result = await this.router.applyRoutes(framework, adapterName); //
      this.recordMetric('routersystem.routes.applied', 1, { adapterName, count: this.router.getRoutes().length }); //
      return result; //
    } catch (error) {
      await this.handleError(error, { phase: 'applyRoutes', adapterName }); //
      throw error; // Error is already a RouterError from CoreRouter
    }
  }

  getRoutes() { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try { return this.router.getRoutes(); } //
    catch (error) { this.handleError(error, { phase: 'getRoutes' }); throw error; } //
  }
  getRoute(method, path) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try { return this.router.getRoute(method, path); } //
    catch (error) { this.handleError(error, { phase: 'getRoute', method, path }); throw error; } //
  }
  getModuleRoutes(moduleId) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try { return this.router.getModuleRoutes(moduleId); } //
    catch (error) { this.handleError(error, { phase: 'getModuleRoutes', moduleId }); throw error; } //
  }
  unregisterRoute(method, path) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      const result = this.router.unregisterRoute(method, path); //
      if (result) this.recordMetric('routersystem.routes.unregistered', 1, { method: method.toUpperCase(), path }); //
      return result;
    } catch (error) { this.handleError(error, { phase: 'unregisterRoute', method, path }); throw error; } //
  }
  unregisterModuleRoutes(moduleId) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      const count = this.router.unregisterModuleRoutes(moduleId); //
      if (count > 0) this.recordMetric('routersystem.module.routes.unregistered', count, { moduleId }); //
      return count;
    } catch (error) { this.handleError(error, { phase: 'unregisterModuleRoutes', moduleId }); throw error; } //
  }
  clearRoutes() { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try {
      const count = this.router.getRoutes().length; //
      this.router.clearRoutes(); //
      if (count > 0) this.recordMetric('routersystem.routes.cleared', count); //
      return this;
    } catch (error) { this.handleError(error, { phase: 'clearRoutes' }); throw error; } //
  }
  generateOpenApiDoc(info = {}) { //
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem."); //
    try { return this.router.generateOpenApiDoc(info); } //
    catch (error) { this.handleError(error, { phase: 'generateOpenApiDoc' }); throw error; } //
  }


  async shutdown() { //
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { //
      return;
    }
    super.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'RouterSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; //
    const shutdownStartTime = Date.now();

    try {
      if (this.router) { //
        await this.router.shutdown(); //
      }
      super.removeAllListeners(); // Clear RouterSystem's own listeners

      this.router = null; //
      this.state.status = SYSTEM_STATUS.SHUTDOWN; //
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('routersystem.shutdown.time', shutdownTime);
      this.recordMetric('routersystem.shutdown.success', 1); // [cite: 1297] (metric call)
      // Log directly as listeners removed
      this.deps.logger?.info('[RouterSystem] Shutdown complete.'); // [cite: 1299] (adapted from emit)

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('routersystem.shutdown.failure', 1, { error: error.code }); //
      // Use _handleInternalError for RouterSystem's own shutdown failure
      await this._handleInternalError(error, { phase: 'shutdown' }); // [cite: 1302] (adapted)
      // Original code re-threw a new RouterError.
      // For system component shutdown, it's often better to log and not prevent other shutdowns.
      // However, if ModuleSystem or Container needs to know, re-throwing might be desired.
      // Let's stick to re-throwing a standardized error for now.
      throw error instanceof RouterError ? error : new RouterError(
        ErrorCodes.ROUTER.SHUTDOWN_FAILED,
        "RouterSystem failed to shutdown.",
        { originalMessage: error.message },
        { cause: error }
      );
    }
  }

  // --- State, Health, Metrics ---
  setupDefaultHealthChecks() { //
    this.registerHealthCheck('routersystem.state', this.checkSystemState.bind(this)); //
    this.registerHealthCheck('routersystem.corerouter', this.checkCoreRouterHealth.bind(this)); // (name changed)
  }

  recordMetric(name, value, tags = {}) { //
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags });
  }

  getMetrics() { //
    const metrics = {};
    for (const [name, data] of this.state.metrics) {
      metrics[name] = data;
    }
    return metrics;
  }

  registerHealthCheck(name, checkFn) { //
    if (typeof checkFn !== 'function') {
        const err = new RouterError(ErrorCodes.ROUTER.INVALID_HEALTH_CHECK || 'INVALID_HEALTH_CHECK', `RouterSystem Health check '${name}' must be a function.`); //
        this._handleInternalError(err); // Log, rethrow
        throw err;
    }
    this.state.healthChecks.set(name, checkFn);
  }

  async checkHealth() { //
    // This is for RouterSystem's own health, including its managed CoreRouter.
    const results = {};
    let overallStatus = SYSTEM_STATUS.HEALTHY;

    for (const [name, checkFn] of this.state.healthChecks) { //
      try {
        const checkResult = await checkFn(); // Expects standard health object
        results[name] = checkResult; //
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) { //
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY && checkResult.status === SYSTEM_STATUS.DEGRADED)
            ? SYSTEM_STATUS.DEGRADED
            : SYSTEM_STATUS.UNHEALTHY; //
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]); // (adapted)
        overallStatus = SYSTEM_STATUS.UNHEALTHY; //
      }
    }
    return { //
      name: this.constructor.name,
      version: RouterSystem.version,
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

  async checkCoreRouterHealth() { // (was check for 'router')
    if (!this.router || typeof this.router.checkHealth !== 'function') { //
      return createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { reason: 'CoreRouter not available or does not support health checks.' }); //
    }
    try {
      return await this.router.checkHealth(); // // CoreRouter.checkHealth already returns standard object
    } catch (error) {
      return createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'CoreRouter health check failed.' }, [error]); //
    }
  }

  getSystemStatus() { //
    return {
        name: this.constructor.name,
        version: RouterSystem.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString(),
        coreRouterStatus: this.router ? this.router.getSystemStatus().status : SYSTEM_STATUS.UNAVAILABLE || 'unavailable'
    };
  }
}

/**
 * Factory function for creating a RouterSystem instance.
 * @param {object} [deps={}] - Dependencies for the RouterSystem.
 * @returns {RouterSystem}
 */
export function createRouterSystem(deps = {}) { //
  try {
    // Constructor now handles its own dependency validation.
    // Default deps logic from original factory is useful if deps might be sparse.
    const defaultDeps = { //
      errorSystem: deps.errorSystem || { handleError: async () => { console.error("Default No-Op ErrorSystem used in RouterSystem factory"); } },
      eventBusSystem: deps.eventBusSystem || { getEventBus: () => new EventEmitter() },
      config: deps.config || {},
    };
    return new RouterSystem({ ...defaultDeps, ...deps }); //
  } catch (error) { //
    // This top-level catch in factory is good for creation-time issues
    console.error("[RouterSystem Factory] Failed to create RouterSystem:", error); //
    throw error instanceof RouterError ? error : new RouterError( //
      ErrorCodes.ROUTER.CREATION_FAILED || 'CREATION_FAILED',
      "Failed to create RouterSystem instance.",
      { originalMessage: error.message },
      { cause: error }
    );
  }
}

// Default export was an object containing class and factory.
// export default { RouterSystem, createRouterSystem };