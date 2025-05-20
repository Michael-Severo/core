/**
 * @file CoreRouter.js
 * @description Core router for managing HTTP routes, adapters, and middleware.
 * It listens for route registration events and applies them via framework-specific adapters.
 */

import { EventEmitter } from 'events';
import { RouterError } from '../errors/index.js';
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class CoreRouter extends EventEmitter {
  static dependencies = ['errorSystem', 'eventBusSystem', 'config'];
  static version = '2.0.0';

  /**
   * Creates a new CoreRouter instance.
   * @param {object} [deps={}] - Dependencies for the CoreRouter.
   * @param {object} deps.errorSystem - The ErrorSystem instance.
   * @param {object} deps.eventBusSystem - The EventBusSystem instance for subscribing to route events.
   * @param {object} [deps.config={}] - Configuration object.
   */
  constructor(deps = {}) {
    super();
    this.deps = {
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {},
    };

    this.routes = new Map();
    this.adapters = new Map();
    this.middleware = new Map();
    this.subscriptions = [];
    this._routesAppliedOnce = false; // Flag to track if routes have been applied to a framework

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [],
      metrics: new Map(),
      healthChecks: new Map(),
    };
    this.setupDefaultHealthChecks();
  }

  /**
   * Emits a 'router:routes:changed' event if the router is running and routes have been applied once.
   * @private
   * @param {object} [details={}] - Optional details about the change (e.g., action: 'added', routeKey).
   */
  _signalRoutesChanged(details = {}) {
    if (this.state.status === SYSTEM_STATUS.RUNNING && this._routesAppliedOnce) {
      super.emit('router:routes:changed', { timestamp: new Date().toISOString(), ...details });
      this.recordMetric('corerouter.routes.changed.emitted', 1, details);
    }
  }

  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof RouterError)
      ? new RouterError(ErrorCodes.ROUTER.INTERNAL_SYSTEM_ERROR, error.message, context, { cause: error })
      : error;
    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.router?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('corerouter.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'CoreRouter', ...context });
  }

  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new RouterError(ErrorCodes.ROUTER.ALREADY_INITIALIZED, 'CoreRouter is already initialized or initializing.');
      await this._handleInternalError(err, { currentStatus: this.state.status });
      return this;
    }

    super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'CoreRouter' });
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    this.state.startTime = Date.now();

    try {
      if (!this.deps.eventBusSystem || !this.deps.eventBusSystem.getEventBus) {
        throw new RouterError(ErrorCodes.ROUTER.INVALID_DEPENDENCY, 'CoreRouter: EventBusSystem is not available or invalid for event subscriptions.');
      }
      const eventBus = this.deps.eventBusSystem.getEventBus();
      if (!eventBus || typeof eventBus.subscribe !== 'function') {
          throw new RouterError(ErrorCodes.ROUTER.INVALID_DEPENDENCY, 'CoreRouter: CoreEventBus instance is not available for event subscriptions.');
      }

      this.subscriptions.push(
        eventBus.subscribe('router.route.register', this.handleRouteRegistration.bind(this)),
        eventBus.subscribe('router.route.unregister', this.handleRouteUnregistration.bind(this)),
        eventBus.subscribe('router.routes.clear', this.handleRoutesClear.bind(this)),
        eventBus.subscribe('router.module.unregister', this.handleModuleUnregister.bind(this))
      );
      this.state.status = SYSTEM_STATUS.RUNNING;
      this.recordMetric('corerouter.initialized.success', 1, { timestamp: Date.now() });
      super.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'CoreRouter', timestamp: new Date().toISOString() });
      super.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'CoreRouter', timestamp: new Date().toISOString() });
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('corerouter.initialized.failure', 1, { error: error.code, timestamp: Date.now() });
      await this._handleInternalError(error, { phase: 'initialization' });
      throw error instanceof RouterError ?
      error : new RouterError(
        ErrorCodes.ROUTER.INITIALIZATION_FAILED,
        'CoreRouter failed to initialize.',
        { originalMessage: error.message },
        { cause: error }
      );
    }
    return this;
  }

  registerRoute(moduleId, method, path, handler, options = {}) {
    // Not checking status === RUNNING here, as routes can be defined before router is fully live & applied.
    // The event handlers (handleRouteRegistration) will call this.
    // If called directly after init, it's okay. applyRoutes checks RUNNING state.
    if (!moduleId || typeof moduleId !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_MODULE_ID, 'Module ID is required for route registration.');
    if (!method || typeof method !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_METHOD, 'HTTP method must be a non-empty string.');
    if (!path || typeof path !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_PATH, 'Route path must be a non-empty string.');
    if (typeof handler !== 'function') throw new RouterError(ErrorCodes.ROUTER.INVALID_HANDLER, 'Route handler must be a function.');

    const upperMethod = method.toUpperCase();
    const routeKey = `${upperMethod}:${path}`;
    if (this.routes.has(routeKey)) {
      const existing = this.routes.get(routeKey);
      // For dynamic updates, we might want to allow overwriting or provide an updateRoute method
      // For now, maintaining conflict error for simple registerRoute
      // If allowing overwrite for dynamic updates, this should be handled differently,
      // perhaps by emitting a specific 'route:updated' event.
      // Let's assume for now registerRoute during dynamic updates should ideally be for new routes,
      // or unregister then register.
      // To enable HMR-like behavior where a route definition changes, we might need an `updateRoute`
      // or make `registerRoute` overwrite if an `allowOverwrite` option is passed or if `_routesAppliedOnce` is true.
      // For now, we'll emit 'changed' and the adapter has to deal with the full new list.
      this.deps.logger.warn(`[CoreRouter] Route conflict: ${routeKey} already registered by module '${existing.moduleId}'. Overwriting with registration from '${moduleId}'.`);
      // To allow updates, we remove the conflict throw if routes have been applied.
      // Or, better, require an unregister first or an explicit update.
      // Let's assume for now, if _routesAppliedOnce, we allow re-registration to mean update.
      // The adapter's refreshRoutes will get the full new list.
    }

    this.routes.set(routeKey, { moduleId, method: upperMethod, path, handler, options: options || {} });
    this.recordMetric('corerouter.routes.registered', 1, { moduleId, method: upperMethod });
    super.emit('route:registered', { moduleId, method: upperMethod, path, timestamp: new Date().toISOString() });
    this._signalRoutesChanged({ action: 'registered', routeKey });
    return this;
  }

  registerAdapter(name, adapter) {
    if (!name || typeof name !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_ADAPTER_NAME, 'Adapter name must be a non-empty string.');
    if (!adapter || typeof adapter.applyRoutes !== 'function' || typeof adapter.refreshRoutes !== 'function') { // Added check for refreshRoutes
        throw new RouterError(ErrorCodes.ROUTER.INVALID_ADAPTER, `Adapter '${name}' must implement applyRoutes and refreshRoutes methods.`);
    }
    this.adapters.set(name, adapter);
    this.recordMetric('corerouter.adapters.registered', 1, { adapterName: name });
    super.emit('adapter:registered', { name, timestamp: new Date().toISOString() });
    return this;
  }

  registerMiddleware(name, handler, options = {}) {
    if (!name || typeof name !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_MIDDLEWARE_NAME, 'Middleware name must be a non-empty string.');
    if (typeof handler !== 'function') throw new RouterError(ErrorCodes.ROUTER.INVALID_MIDDLEWARE, `Middleware handler for '${name}' must be a function.`);
    this.middleware.set(name, { handler, options: options || {}, order: options?.order || 100 });
    this.recordMetric('corerouter.middleware.registered', 1, { middlewareName: name });
    super.emit('middleware:registered', { name, timestamp: new Date().toISOString() });
    // Note: Changes to middleware might also require routes to be refreshed if middleware is resolved at apply/refresh time.
    // For simplicity, we assume middleware changes also trigger a manual refresh request or occur before applyRoutes.
    // Or, _signalRoutesChanged could be called here too if dynamic middleware updates are desired.
    return this;
  }

  getMiddlewareForRoute(route) {
    const routeSpecificMiddlewareNames = route.options?.middleware || [];
    const applicableMiddleware = [];
    for (const [name, midDef] of this.middleware) {
      if (this._shouldApplyMiddleware(name, midDef, route)) {
        applicableMiddleware.push({ name, handler: midDef.handler, order: midDef.order });
      }
    }
    for (const name of routeSpecificMiddlewareNames) {
      if (this.middleware.has(name)) {
        const midDef = this.middleware.get(name);
        if (!applicableMiddleware.some(m => m.name === name)) {
            applicableMiddleware.push({ name, handler: midDef.handler, order: midDef.order });
        }
      } else {
        this.deps.logger?.warn(`[CoreRouter] Middleware '${name}' requested by route ${route.method} ${route.path} not found.`);
      }
    }
    return applicableMiddleware.sort((a, b) => a.order - b.order);
  }

  _shouldApplyMiddleware(middlewareName, middlewareDef, route) {
    const { paths, methods } = middlewareDef.options || {};
    if (!paths && !methods) return true;
    let matchesPath = !paths;
    if (paths) {
      matchesPath = paths.some(pattern => this._pathMatchesPattern(route.path, pattern));
    }
    if (!matchesPath) return false;
    let matchesMethod = !methods;
    if (methods) {
      matchesMethod = methods.map(m => m.toUpperCase()).includes(route.method.toUpperCase());
    }
    return matchesMethod;
  }

  _pathMatchesPattern(path, pattern) {
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return path.startsWith(prefix);
    }
    return path === pattern;
  }

  async applyRoutes(framework, adapterName) {
    if (this.state.status !== SYSTEM_STATUS.RUNNING) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, 'CoreRouter is not running.');
    if (!framework) throw new RouterError(ErrorCodes.ROUTER.INVALID_FRAMEWORK, 'Framework instance is required to apply routes.');
    if (!adapterName || !this.adapters.has(adapterName)) throw new RouterError(ErrorCodes.ROUTER.ADAPTER_NOT_FOUND, `Adapter '${adapterName}' not found.`);

    try {
      const adapter = this.adapters.get(adapterName);
      const routesWithMiddleware = Array.from(this.routes.values()).map(route => ({
          ...route,
          resolvedMiddleware: this.getMiddlewareForRoute(route).map(m => m.handler)
      }));
      const result = await adapter.applyRoutes(framework, routesWithMiddleware);
      this._routesAppliedOnce = true; // Set flag after successful first application
      this.recordMetric('corerouter.routes.applied', routesWithMiddleware.length, { adapter: adapterName });
      super.emit('routes:applied', { adapter: adapterName, count: routesWithMiddleware.length, timestamp: new Date().toISOString() });
      return result;
    } catch (error) {
      const applyError = new RouterError(
        ErrorCodes.ROUTER.ROUTES_APPLICATION_FAILED,
        `Failed to apply routes using adapter '${adapterName}'.`,
        { adapter: adapterName, originalMessage: error.message },
        { cause: error }
      );
      await this._handleInternalError(applyError, { phase: 'applyRoutes', adapterName });
      throw applyError;
    }
  }

  getRoutes() { return Array.from(this.routes.values()); }
  getRoute(method, path) { return this.routes.get(`${method.toUpperCase()}:${path}`) || null; }
  getModuleRoutes(moduleId) { return Array.from(this.routes.values()).filter(r => r.moduleId === moduleId); }

  unregisterRoute(method, path) {
    const routeKey = `${method.toUpperCase()}:${path}`;
    const route = this.routes.get(routeKey);
    if (!route) return false;

    const unregistered = this.routes.delete(routeKey);
    if (unregistered) {
      this.recordMetric('corerouter.routes.unregistered', 1, { moduleId: route.moduleId, method: route.method });
      super.emit('route:unregistered', { moduleId: route.moduleId, method: route.method, path, timestamp: new Date().toISOString() });
      this._signalRoutesChanged({ action: 'unregistered', routeKey });
    }
    return unregistered;
  }

  unregisterModuleRoutes(moduleId) {
    const moduleRoutes = this.getModuleRoutes(moduleId);
    if (moduleRoutes.length === 0) return 0;

    let count = 0;
    for (const route of moduleRoutes) {
      if (this.unregisterRoute(route.method, route.path)) { // unregisterRoute will signal change for each
        count++;
      }
    }
    if (count > 0) {
        this.recordMetric('corerouter.module.routes.unregistered', count, { moduleId });
        // _signalRoutesChanged is called by individual unregisterRoute calls
    }
    return count;
  }

  clearRoutes() {
    const count = this.routes.size;
    if (count === 0) return this;

    this.routes.clear();
    this.recordMetric('corerouter.routes.cleared', count);
    super.emit('routes:cleared', { count, timestamp: new Date().toISOString() });
    this._signalRoutesChanged({ action: 'cleared_all' });
    return this;
  }

  registerVersionedRoute(moduleId, version, method, path, handler, options = {}) {
    const basePath = path.startsWith('/') ? path : `/${path}`;
    const versionedPath = `/api/v${version}${basePath}`;
    return this.registerRoute(moduleId, method, versionedPath, handler, { ...options, apiVersion: version });
  }

  generateOpenApiDoc(info = {}) {
    // ... (generateOpenApiDoc implementation remains the same) ...
    const paths = {};
    const tags = new Set();
    for (const route of this.getRoutes()) {
      const { method, path: routePath, options } = route;
      if (options.tags && Array.isArray(options.tags)) options.tags.forEach(tag => tags.add(tag));
      const pathParams = [];
      const openApiPath = routePath.replace(/:([^/]+)/g, (_, paramName) => {
        pathParams.push({ name: paramName, in: 'path', required: true, schema: { type: 'string' } });
        return `{${paramName}}`;
      });
      if (!paths[openApiPath]) paths[openApiPath] = {};
      paths[openApiPath][method.toLowerCase()] = {
        tags: options.tags || [],
        summary: options.summary || '',
        description: options.description || '',
        parameters: [
          ...pathParams,
          ...(options.schema?.parameters || []),
        ],
        requestBody: options.schema?.body ? { content: { 'application/json': { schema: options.schema.body } } } : undefined,
        responses: options.schema?.responses || { '200': { description: 'Success' } },
        security: options.auth ? [{ bearerAuth: [] }] : [],
      };
    }
    return {
      openapi: '3.0.0',
      info: {
        title: info.title || 'API Documentation',
        version: info.version || CoreRouter.version,
        description: info.description || '',
      },
      tags: Array.from(tags).map(tag => ({ name: tag, description: '' })),
      paths,
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
        schemas: info.components?.schemas || {}
      },
    };
  }


  // --- Event Handlers ---
  async handleRouteRegistration(event) {
    const routeData = event.data || event;
    try {
      const { moduleId, method, path, handler, options } = routeData;
      // registerRoute will call _signalRoutesChanged if applicable
      this.registerRoute(moduleId, method, path, handler, options || {});
    } catch (error) {
      // error from registerRoute is already a RouterError and logged by _handleInternalError if it's an internal issue
      // If registerRoute throws due to conflict before _routesAppliedOnce, it's a setup error
      // If it's after, and we change registerRoute to allow overwrite, this path might change.
      // For now, _handleInternalError in registerRoute handles its own direct errors.
      // This handler is for errors *during the event processing itself*, not from registerRoute's logic.
      await this._handleInternalError(error, { eventName: event.name, receivedData: routeData, comment: "Error during handleRouteRegistration's call to registerRoute" });
    }
  }

  async handleRouteUnregistration(event) {
    const routeData = event.data || event;
    try {
        const { method, path } = routeData;
        // unregisterRoute will call _signalRoutesChanged
        this.unregisterRoute(method, path);
    } catch (error) {
        await this._handleInternalError(error, { eventName: event.name, receivedData: routeData });
    }
  }

  async handleRoutesClear(event) {
    try {
      // clearRoutes will call _signalRoutesChanged
      this.clearRoutes();
    } catch (error) {
      await this._handleInternalError(error, { eventName: event.name });
    }
  }

  async handleModuleUnregister(event) {
    const eventData = event.data || event;
    try {
      const { moduleId } = eventData;
      if (moduleId) {
        // unregisterModuleRoutes calls unregisterRoute, which calls _signalRoutesChanged
        this.unregisterModuleRoutes(moduleId);
      } else {
          throw new RouterError(ErrorCodes.ROUTER.INVALID_PAYLOAD, "moduleId missing in router.module.unregister event payload.");
      }
    } catch (error) {
      await this._handleInternalError(error, { eventName: event.name, receivedData: eventData });
    }
  }

  async shutdown() {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
      return;
    }
    super.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'CoreRouter' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN;
    const shutdownStartTime = Date.now();
    this._routesAppliedOnce = false; // Reset this flag
    try {
      if (this.deps.eventBusSystem && this.deps.eventBusSystem.getEventBus) {
        const eventBus = this.deps.eventBusSystem.getEventBus();
        if (eventBus && typeof eventBus.unsubscribe === 'function') {
          for (const subId of this.subscriptions) {
            eventBus.unsubscribe(subId);
          }
        }
      }
      this.subscriptions = [];
      this.routes.clear();
      this.adapters.clear();
      this.middleware.clear();

      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('corerouter.shutdown.time', shutdownTime);
      this.recordMetric('corerouter.shutdown.success', 1, { timestamp: Date.now() });
      super.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'CoreRouter', durationMs: shutdownTime, timestamp: new Date().toISOString() });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('corerouter.shutdown.failure', 1, { error: error.code, timestamp: Date.now() });
      await this._handleInternalError(error, { phase: 'shutdown' });
    }
  }

  // ... (Health Checks & Metrics methods remain the same as previously verified) ...
  setupDefaultHealthChecks() {
    this.registerHealthCheck('corerouter.state', this.checkSystemState.bind(this));
    this.registerHealthCheck('corerouter.routes', this.checkRouteStatus.bind(this));
    this.registerHealthCheck('corerouter.adapters', this.checkAdapterStatus.bind(this));
    this.registerHealthCheck('corerouter.middleware', this.checkMiddlewareStatus.bind(this));
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
        const err = new RouterError(ErrorCodes.ROUTER.INVALID_HANDLER, `CoreRouter Health check '${name}' must be a function.`);
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
      version: CoreRouter.version,
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

  async checkRouteStatus() {
    const routes = Array.from(this.routes.values());
    const routesByMethod = {};
    for (const route of routes) {
      routesByMethod[route.method] = (routesByMethod[route.method] || 0) + 1;
    }
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      count: routes.length,
      byMethod: routesByMethod,
    });
  }

  async checkAdapterStatus() {
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      count: this.adapters.size,
      adapterNames: Array.from(this.adapters.keys()),
    });
  }

  async checkMiddlewareStatus() {
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      count: this.middleware.size,
      middlewareNames: Array.from(this.middleware.keys()),
    });
  }

  getSystemStatus() {
    return {
        name: this.constructor.name,
        version: CoreRouter.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        routeCount: this.routes.size,
        adapterCount: this.adapters.size,
        middlewareCount: this.middleware.size,
        timestamp: new Date().toISOString()
    };
  }
}
