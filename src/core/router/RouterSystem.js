/**
 * @file RouterSystem.js
 * @description System for centralized route management, managing CoreRouter and its integrations.
 */

import { EventEmitter } from "events";
import { CoreRouter } from "./CoreRouter.js";
import { RouterError } from "../errors/index.js";
import { ErrorCodes } from "../errors/ErrorCodes.js";
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class RouterSystem extends EventEmitter {
  static dependencies = ["errorSystem", "eventBusSystem", "config"];
  static version = "2.0.0";

  /**
   * Creates a new RouterSystem instance.
   * @param {object} [deps={}] - Dependencies for the RouterSystem.
   * @param {object} deps.errorSystem - The ErrorSystem instance.
   * @param {object} deps.eventBusSystem - The EventBusSystem instance.
   * @param {object} [deps.config={}] - Global application configuration.
   */
  constructor(deps = {}) {
    super();
    this.deps = {
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {},
    };

    this.router = null; // Will be an instance of CoreRouter
    this._activeAdapterName = null; // Stores the name of the adapter used in the last applyRoutes call
    this._activeFrameworkInstance = null; // Stores the framework instance from the last applyRoutes call

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [],
      metrics: new Map(),
      healthChecks: new Map(),
    };

    this._validateDependencies();
    this.setupDefaultHealthChecks();
  }

  /** @private */
  _validateDependencies() {
    const missing = RouterSystem.dependencies.filter(dep => !this.deps[dep]);
    if (missing.length > 0) {
      throw new RouterError(ErrorCodes.ROUTER.MISSING_DEPENDENCIES, `RouterSystem: Missing required dependencies: ${missing.join(", ")}`, { missingDeps: missing });
    }
    if (!this.deps.eventBusSystem || typeof this.deps.eventBusSystem.getEventBus !== "function") {
      throw new RouterError(ErrorCodes.ROUTER.INVALID_DEPENDENCY, "RouterSystem: EventBusSystem is invalid.", { dependency: "eventBusSystem" });
    }
    if (!this.deps.errorSystem || typeof this.deps.errorSystem.handleError !== "function") {
      throw new RouterError(ErrorCodes.ROUTER.INVALID_DEPENDENCY, "RouterSystem: ErrorSystem is invalid.", { dependency: "errorSystem" });
    }
  }

  /** @private */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof RouterError)
      ? new RouterError(ErrorCodes.ROUTER.SYSTEM_INTERNAL_ERROR, error.message, context, { cause: error })
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
  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new RouterError(ErrorCodes.ROUTER.ALREADY_INITIALIZED, "RouterSystem is already initialized or initializing.", { state: this.state.status });
      await this._handleInternalError(err);
      return this;
    }

    super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'RouterSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    this.state.startTime = Date.now();

    try {
      this.router = new CoreRouter(this.deps);
      this._setupEventForwardingAndDynamicRefresh(); // UPDATED method name
      await this.router.initialize();

      this.state.status = SYSTEM_STATUS.RUNNING;
      this.recordMetric('routersystem.initialized.success', 1);
      super.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'RouterSystem', timestamp: new Date().toISOString() });
      super.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'RouterSystem', timestamp: new Date().toISOString() });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('routersystem.initialized.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'initialization' });
      throw error instanceof RouterError ?
      error : new RouterError(
        ErrorCodes.ROUTER.INITIALIZATION_FAILED,
        "RouterSystem failed to initialize.",
        { originalMessage: error.message },
        { cause: error }
      );
    }
    return this;
  }

  /** * Sets up event forwarding from CoreRouter to RouterSystem and
   * listens for route changes to trigger dynamic refresh.
   * @private 
   */
  _setupEventForwardingAndDynamicRefresh() {
    if (!this.router) return;

    const forward = (eventName, systemEventName) => {
      this.router.on(eventName, (eventData) => {
        this.emit(systemEventName, eventData);
        this.emit(eventName, eventData);
      });
    };

    forward('route:registered', 'system:route:registered');
    forward('route:unregistered', 'system:route:unregistered');
    forward('routes:applied', 'system:routes:applied');
    forward('routes:cleared', 'system:routes:cleared');
    forward('adapter:registered', 'system:adapter:registered');
    forward('middleware:registered', 'system:middleware:registered');

    this.router.on('router:error', (eventData) => {
      const { error: crError, context: crContext } = eventData;
      this._handleInternalError(crError, { ...crContext, sourceDetail: 'CoreRouterEvent' });
      this.emit('system:error', eventData);
    });

    // Listen for route changes from CoreRouter to trigger dynamic refresh
    this.router.on('router:routes:changed', this._handleCoreRoutesChanged.bind(this));
  }

  /**
   * Handles the 'router:routes:changed' event from CoreRouter.
   * Instructs the active adapter to refresh its routes.
   * @private
   * @param {object} eventData - Data from the 'router:routes:changed' event.
   */
  async _handleCoreRoutesChanged(eventData) {
    this.deps.logger.info(`[RouterSystem] Detected route changes, attempting to refresh adapter. Details: ${JSON.stringify(eventData)}`);
    if (this.state.status !== SYSTEM_STATUS.RUNNING || !this.router || !this.router._routesAppliedOnce) {
      this.deps.logger.info('[RouterSystem] Router not running or routes not initially applied. Skipping dynamic refresh.');
      return;
    }

    if (!this._activeAdapterName) {
      this.deps.logger.warn('[RouterSystem] No active adapter set from applyRoutes. Cannot perform dynamic refresh.');
      return;
    }

    const adapter = this.router.adapters.get(this._activeAdapterName);
    if (!adapter) {
      await this.handleError(new RouterError(
        ErrorCodes.ROUTER.ADAPTER_NOT_FOUND,
        `Active adapter '${this._activeAdapterName}' not found in CoreRouter during dynamic refresh.`
      ), { phase: 'dynamic-route-refresh' });
      return;
    }

    if (typeof adapter.refreshRoutes !== 'function') {
      await this.handleError(new RouterError(
        ErrorCodes.ROUTER.INVALID_ADAPTER, // Or a more specific code like 'REFRESH_NOT_SUPPORTED'
        `Active adapter '${this._activeAdapterName}' does not support refreshRoutes.`
      ), { phase: 'dynamic-route-refresh' });
      return;
    }

    try {
      this.deps.logger.info(`[RouterSystem] Refreshing routes for adapter '${this._activeAdapterName}'.`);
      // The adapter's refreshRoutes method should use the framework instance it was initialized with or has access to.
      // It receives the full new list of routes.
      await adapter.refreshRoutes(this.router.getRoutes());
      this.recordMetric('routersystem.routes.refreshed', 1, { adapter: this._activeAdapterName, changeDetails: eventData?.action });
      this.emit('system:routes:refreshed', { adapter: this._activeAdapterName, timestamp: new Date().toISOString() });
    } catch (error) {
      await this.handleError(error, { // Error is likely already RouterError from adapter or CoreRouter
        phase: 'dynamic-route-refresh-execution',
        adapter: this._activeAdapterName,
        originalMessage: error.message
      });
      // Depending on severity, we might want to set RouterSystem state to ERROR or DEGRADED.
    }
  }

  async handleError(error, context = {}) {
    this.state.errors.push({ error, timestamp: new Date().toISOString(), context: context || {} });
    if (this.state.errors.length > (this.deps.config?.routerSystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('routersystem.errors.operational', 1, { errorName: error.name, errorCode: error.code });
    await safeHandleError(this.deps.errorSystem, error, { source: 'RouterSystem', ...context });
    super.emit('system:error', { error, context, timestamp: new Date().toISOString() });
  }

  getRouter() {
    if (this.state.status !== SYSTEM_STATUS.RUNNING) {
      throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "RouterSystem is not running, cannot get router.", { state: this.state.status });
    }
    return this.router;
  }

  // --- Delegated CoreRouter Methods ---
  async registerRoute(moduleId, method, path, handler, options = {}) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      this.router.registerRoute(moduleId, method, path, handler, options);
      this.recordMetric('routersystem.routes.registered', 1, { moduleId, method: method.toUpperCase() });
      return this;
    } catch (error) {
      await this.handleError(error, { phase: 'registerRoute', moduleId, method, path });
      throw error;
    }
  }

  async registerVersionedRoute(moduleId, version, method, path, handler, options = {}) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      this.router.registerVersionedRoute(moduleId, version, method, path, handler, options);
      this.recordMetric('routersystem.routes.versioned.registered', 1, { moduleId, version, method: method.toUpperCase() });
      return this;
    } catch (error) {
      await this.handleError(error, { phase: 'registerVersionedRoute', moduleId, version, method, path });
      throw error;
    }
  }

  registerAdapter(name, adapter) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      this.router.registerAdapter(name, adapter);
      this.recordMetric('routersystem.adapters.registered', 1, { adapterName: name });
      return this;
    } catch (error) {
      this.handleError(error, { phase: 'registerAdapter', adapterName: name });
      throw error;
    }
  }

  registerMiddleware(name, handler, options = {}) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      this.router.registerMiddleware(name, handler, options);
      this.recordMetric('routersystem.middleware.registered', 1, { middlewareName: name });
      return this;
    } catch (error) {
      this.handleError(error, { phase: 'registerMiddleware', middlewareName: name });
      throw error;
    }
  }

  async applyRoutes(framework, adapterName) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      const result = await this.router.applyRoutes(framework, adapterName);
      this._activeAdapterName = adapterName; // Store active adapter
      this._activeFrameworkInstance = framework; // Store active framework
      this.recordMetric('routersystem.routes.applied', 1, { adapterName, count: this.router.getRoutes().length });
      return result;
    } catch (error) {
      await this.handleError(error, { phase: 'applyRoutes', adapterName });
      throw error;
    }
  }

  getRoutes() {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try { return this.router.getRoutes(); }
    catch (error) { this.handleError(error, { phase: 'getRoutes' }); throw error; }
  }
  getRoute(method, path) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try { return this.router.getRoute(method, path); }
    catch (error) { this.handleError(error, { phase: 'getRoute', method, path }); throw error; }
  }
  getModuleRoutes(moduleId) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try { return this.router.getModuleRoutes(moduleId); }
    catch (error) { this.handleError(error, { phase: 'getModuleRoutes', moduleId }); throw error; }
  }
  unregisterRoute(method, path) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      const result = this.router.unregisterRoute(method, path);
      if (result) this.recordMetric('routersystem.routes.unregistered', 1, { method: method.toUpperCase(), path });
      return result;
    } catch (error) { this.handleError(error, { phase: 'unregisterRoute', method, path }); throw error; }
  }
  unregisterModuleRoutes(moduleId) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      const count = this.router.unregisterModuleRoutes(moduleId);
      if (count > 0) this.recordMetric('routersystem.module.routes.unregistered', count, { moduleId });
      return count;
    } catch (error) { this.handleError(error, { phase: 'unregisterModuleRoutes', moduleId }); throw error; }
  }
  clearRoutes() {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try {
      const count = this.router.getRoutes().length;
      this.router.clearRoutes();
      if (count > 0) this.recordMetric('routersystem.routes.cleared', count);
      return this;
    } catch (error) { this.handleError(error, { phase: 'clearRoutes' }); throw error; }
  }
  generateOpenApiDoc(info = {}) {
    if (!this.router) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, "Router not available in RouterSystem.");
    try { return this.router.generateOpenApiDoc(info); }
    catch (error) { this.handleError(error, { phase: 'generateOpenApiDoc' }); throw error; }
  }

  async shutdown() {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
      return;
    }
    super.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'RouterSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN;
    const shutdownStartTime = Date.now();
    this._activeAdapterName = null; // Reset active adapter info
    this._activeFrameworkInstance = null;

    try {
      if (this.router) {
        this.router.removeAllListeners('router:routes:changed'); // Clean up specific listener
        await this.router.shutdown();
      }
      super.removeAllListeners();

      this.router = null;
      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('routersystem.shutdown.time', shutdownTime);
      this.recordMetric('routersystem.shutdown.success', 1);
      this.deps.logger?.info('[RouterSystem] Shutdown complete.');

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('routersystem.shutdown.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'shutdown' });
      throw error instanceof RouterError ?
      error : new RouterError(
        ErrorCodes.ROUTER.SHUTDOWN_FAILED,
        "RouterSystem failed to shutdown.",
        { originalMessage: error.message },
        { cause: error }
      );
    }
  }

  // --- State, Health, Metrics ---
  // ... (Health Checks & Metrics methods remain the same as previously verified) ...
  setupDefaultHealthChecks() {
    this.registerHealthCheck('routersystem.state', this.checkSystemState.bind(this));
    this.registerHealthCheck('routersystem.corerouter', this.checkCoreRouterHealth.bind(this));
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
        const err = new RouterError(ErrorCodes.ROUTER.INVALID_HEALTH_CHECK, `RouterSystem Health check '${name}' must be a function.`);
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

  async checkCoreRouterHealth() {
    if (!this.router || typeof this.router.checkHealth !== 'function') {
      return createStandardHealthCheckResult(
        SYSTEM_STATUS.UNHEALTHY,
        { reason: 'CoreRouter not available or does not support health checks.' }
      );
    }
    try {
      return await this.router.checkHealth();
    } catch (error) {
      return createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'CoreRouter health check failed.' }, [error]);
    }
  }

  getSystemStatus() {
    return {
        name: this.constructor.name,
        version: RouterSystem.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString(),
        coreRouterStatus: this.router ? this.router.getSystemStatus().status : (SYSTEM_STATUS.UNAVAILABLE || 'unavailable')
    };
  }
}

/**
 * Factory function for creating a RouterSystem instance.
 * @param {object} [deps={}] - Dependencies for the RouterSystem.
 * @returns {RouterSystem}
 */
export function createRouterSystem(deps = {}) {
  try {
    const defaultDeps = {
      errorSystem: deps.errorSystem || { handleError: async () => { console.error("Default No-Op ErrorSystem used in RouterSystem factory"); } },
      eventBusSystem: deps.eventBusSystem || { getEventBus: () => new EventEmitter() },
      config: deps.config || {},
    };
    return new RouterSystem({ ...defaultDeps, ...deps });
  } catch (error) {
    console.error("[RouterSystem Factory] Failed to create RouterSystem:", error);
    throw error instanceof RouterError ? error : new RouterError(
      ErrorCodes.ROUTER.CREATION_FAILED,
      "Failed to create RouterSystem instance.",
      { originalMessage: error.message },
      { cause: error }
    );
  }
}
