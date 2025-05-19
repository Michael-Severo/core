/**
 * @file CoreRouter.js
 * @description Core router for managing HTTP routes, adapters, and middleware.
 * It listens for route registration events and applies them via framework-specific adapters.
 */

import { EventEmitter } from 'events';
import { RouterError } from '../errors/index.js'; // Assuming errors/index.js exports RouterError
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

export class CoreRouter extends EventEmitter {
  static dependencies = ['errorSystem', 'eventBusSystem', 'config']; // [cite: 1081]
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new CoreRouter instance.
   * @param {object} [deps={}] - Dependencies for the CoreRouter.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance.
   * @param {object} [deps.eventBusSystem] - The EventBusSystem instance for subscribing to route events.
   * @param {object} [deps.config={}] - Configuration object.
   */
  constructor(deps = {}) { // Changed from constructor(deps) [cite: 1082]
    super();
    this.deps = {
      errorSystem: deps.errorSystem,
      eventBusSystem: deps.eventBusSystem,
      config: deps.config || {},
    };

    this.routes = new Map(); // [cite: 1082]
    this.adapters = new Map(); // [cite: 1082]
    this.middleware = new Map(); // [cite: 1082]
    this.subscriptions = []; // To keep track of event bus subscriptions for cleanup

    this.state = { // (aligning with standard)
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of CoreRouter
      metrics: new Map(),
      healthChecks: new Map(),
    };

    this.setupDefaultHealthChecks(); // [cite: 1085]
  }

  /**
   * Handles internal operational errors of the CoreRouter.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof RouterError)
      ? new RouterError(ErrorCodes.ROUTER.INTERNAL_SYSTEM_ERROR || 'INTERNAL_SYSTEM_ERROR', error.message, context, { cause: error })
      : error;

    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.router?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('corerouter.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'CoreRouter', ...context });
  }

  /**
   * Initializes the CoreRouter.
   * Subscribes to route registration and management events from the EventBus.
   * @returns {Promise<CoreRouter>} This instance.
   */
  async initialize() { //
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new RouterError(ErrorCodes.ROUTER.ALREADY_INITIALIZED, 'CoreRouter is already initialized or initializing.'); // [cite: 1097]
      await this._handleInternalError(err, { currentStatus: this.state.status });
      return this;
    }

    super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'CoreRouter' }); // Use super.emit for own lifecycle
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

      // Subscribe to route management events
      this.subscriptions.push(
        eventBus.subscribe('router.route.register', this.handleRouteRegistration.bind(this)),
        eventBus.subscribe('router.route.unregister', this.handleRouteUnregistration.bind(this)), // New subscription
        eventBus.subscribe('router.routes.clear', this.handleRoutesClear.bind(this)),
        eventBus.subscribe('router.module.unregister', this.handleModuleUnregister.bind(this))
      );

      this.state.status = SYSTEM_STATUS.RUNNING;
      this.recordMetric('corerouter.initialized.success', 1, { timestamp: Date.now() });
      super.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'CoreRouter', timestamp: new Date().toISOString() }); //
      super.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'CoreRouter', timestamp: new Date().toISOString() });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('corerouter.initialized.failure', 1, { error: error.code, timestamp: Date.now() }); //
      await this._handleInternalError(error, { phase: 'initialization' }); // [cite: 1105]
      // Re-throw standardized error
      throw error instanceof RouterError ? error : new RouterError(
        ErrorCodes.ROUTER.INITIALIZATION_FAILED,
        'CoreRouter failed to initialize.',
        { originalMessage: error.message },
        { cause: error }
      );
    }
    return this;
  }

  /**
   * Registers a route definition internally.
   * @param {string} moduleId - The ID of the module defining the route.
   * @param {string} method - HTTP method (e.g., 'GET', 'POST').
   * @param {string} path - Route path.
   * @param {Function} handler - The route handler function.
   * @param {object} [options={}] - Route-specific options.
   * @returns {CoreRouter} This instance.
   * @throws {RouterError} if route conflicts or parameters are invalid.
   */
  registerRoute(moduleId, method, path, handler, options = {}) { //
    if (this.state.status !== SYSTEM_STATUS.RUNNING) {
      const err = new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, 'CoreRouter is not running, cannot register route.'); //
      this._handleInternalError(err, { method, path }); // Log, but throw as it's likely a programming error
      throw err;
    }
    // Parameter validations
    if (!moduleId || typeof moduleId !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_MODULE_ID, 'Module ID is required for route registration.'); //
    if (!method || typeof method !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_METHOD, 'HTTP method must be a non-empty string.'); //
    if (!path || typeof path !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_PATH, 'Route path must be a non-empty string.'); //
    if (typeof handler !== 'function') throw new RouterError(ErrorCodes.ROUTER.INVALID_HANDLER, 'Route handler must be a function.'); //

    const upperMethod = method.toUpperCase();
    const routeKey = `${upperMethod}:${path}`;

    if (this.routes.has(routeKey)) { //
      const existing = this.routes.get(routeKey);
      throw new RouterError(
        ErrorCodes.ROUTER.ROUTE_CONFLICT, //
        `Route conflict: ${routeKey} already registered by module '${existing.moduleId}'. New registration attempt by '${moduleId}'.`,
        { existingRoute: existing, newRoute: { moduleId, method: upperMethod, path } }
      );
    }

    this.routes.set(routeKey, { moduleId, method: upperMethod, path, handler, options: options || {} }); //
    this.recordMetric('corerouter.routes.registered', 1, { moduleId, method: upperMethod }); //
    super.emit('route:registered', { moduleId, method: upperMethod, path, timestamp: new Date().toISOString() }); //
    return this;
  }

  /**
   * Registers a framework adapter.
   * @param {string} name - A unique name for the adapter.
   * @param {IRouterAdapter} adapter - An instance of a class implementing IRouterAdapter.
   * @returns {CoreRouter} This instance.
   */
  registerAdapter(name, adapter) { //
    if (!name || typeof name !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_ADAPTER_NAME, 'Adapter name must be a non-empty string.'); // [cite: 1117]
    if (!adapter || typeof adapter.applyRoutes !== 'function') throw new RouterError(ErrorCodes.ROUTER.INVALID_ADAPTER, `Adapter '${name}' must implement an async applyRoutes method.`); //

    this.adapters.set(name, adapter); //
    this.recordMetric('corerouter.adapters.registered', 1, { adapterName: name }); // [cite: 1119]
    super.emit('adapter:registered', { name, timestamp: new Date().toISOString() }); //
    return this;
  }

  /**
   * Registers a named middleware.
   * @param {string} name - A unique name for the middleware.
   * @param {Function} handler - The middleware handler function.
   * @param {object} [options={}] - Middleware options (e.g., order, paths, methods).
   * @returns {CoreRouter} This instance.
   */
  registerMiddleware(name, handler, options = {}) { //
    if (!name || typeof name !== 'string') throw new RouterError(ErrorCodes.ROUTER.INVALID_MIDDLEWARE_NAME, 'Middleware name must be a non-empty string.'); // [cite: 1121]
    if (typeof handler !== 'function') throw new RouterError(ErrorCodes.ROUTER.INVALID_MIDDLEWARE, `Middleware handler for '${name}' must be a function.`); //

    this.middleware.set(name, { handler, options: options || {}, order: options?.order || 100 }); //
    this.recordMetric('corerouter.middleware.registered', 1, { middlewareName: name }); //
    super.emit('middleware:registered', { name, timestamp: new Date().toISOString() }); //
    return this;
  }

  /**
   * Retrieves and sorts applicable middleware for a given route.
   * @param {object} route - The route object { method, path, options }.
   * @returns {Array<object>} Sorted array of middleware { name, handler, order }.
   */
  getMiddlewareForRoute(route) { //
    const routeSpecificMiddlewareNames = route.options?.middleware || []; // [cite: 1126]
    const applicableMiddleware = [];

    // Global middleware (applied based on options.paths/methods)
    for (const [name, midDef] of this.middleware) { //
      // Avoid re-adding if it's also route-specific and already processed, or ensure unique add
      if (this._shouldApplyMiddleware(name, midDef, route)) { // [cite: 1127]
        applicableMiddleware.push({ name, handler: midDef.handler, order: midDef.order });
      }
    }

    // Route-specific middleware by name
    for (const name of routeSpecificMiddlewareNames) { //
      if (this.middleware.has(name)) {
        const midDef = this.middleware.get(name);
        // Avoid duplicates if already added as global
        if (!applicableMiddleware.some(m => m.name === name)) {
            applicableMiddleware.push({ name, handler: midDef.handler, order: midDef.order }); //
        }
      } else {
        this.deps.logger?.warn(`[CoreRouter] Middleware '${name}' requested by route ${route.method} ${route.path} not found.`);
      }
    }
    return applicableMiddleware.sort((a, b) => a.order - b.order); // [cite: 1130]
  }

  /** @private */
  _shouldApplyMiddleware(middlewareName, middlewareDef, route) { //
    const { paths, methods } = middlewareDef.options || {};
    if (!paths && !methods) return true; // [cite: 1131]

    let matchesPath = !paths; // If no path patterns, it's a path match by default
    if (paths) {
      matchesPath = paths.some(pattern => this._pathMatchesPattern(route.path, pattern)); //
    }
    if (!matchesPath) return false; //

    let matchesMethod = !methods; // If no method patterns, it's a method match
    if (methods) {
      matchesMethod = methods.map(m => m.toUpperCase()).includes(route.method.toUpperCase()); //
    }
    return matchesMethod; //
  }

  /** @private */
  _pathMatchesPattern(path, pattern) { //
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1); //
      return path.startsWith(prefix); // [cite: 1137]
    }
    return path === pattern; // [cite: 1138]
  }

  /**
   * Applies all registered routes to a given HTTP framework instance using a specified adapter.
   * @param {object} framework - The HTTP framework instance (e.g., Fastify app, Express app).
   * @param {string} adapterName - The name of the registered adapter to use.
   * @returns {Promise<object>} The framework instance with routes applied.
   */
  async applyRoutes(framework, adapterName) { //
    if (this.state.status !== SYSTEM_STATUS.RUNNING) throw new RouterError(ErrorCodes.ROUTER.NOT_INITIALIZED, 'CoreRouter is not running.'); // [cite: 1139]
    if (!framework) throw new RouterError(ErrorCodes.ROUTER.INVALID_FRAMEWORK, 'Framework instance is required to apply routes.'); //
    if (!adapterName || !this.adapters.has(adapterName)) throw new RouterError(ErrorCodes.ROUTER.ADAPTER_NOT_FOUND, `Adapter '${adapterName}' not found.`); //

    try {
      const adapter = this.adapters.get(adapterName); //
      // Prepare routes with their applicable middleware
      const routesWithMiddleware = Array.from(this.routes.values()).map(route => ({
          ...route,
          // Resolve middleware just before applying, allowing dynamic middleware registration
          resolvedMiddleware: this.getMiddlewareForRoute(route).map(m => m.handler)
      }));

      const result = await adapter.applyRoutes(framework, routesWithMiddleware); // (Pass routesWithMiddleware)
      this.recordMetric('corerouter.routes.applied', routesWithMiddleware.length, { adapter: adapterName }); //
      super.emit('routes:applied', { adapter: adapterName, count: routesWithMiddleware.length, timestamp: new Date().toISOString() }); //
      return result; //
    } catch (error) {
      const applyError = new RouterError( //
        ErrorCodes.ROUTER.ROUTES_APPLICATION_FAILED, //
        `Failed to apply routes using adapter '${adapterName}'.`, //
        { adapter: adapterName, originalMessage: error.message }, //
        { cause: error } //
      );
      await this._handleInternalError(applyError, { phase: 'applyRoutes', adapterName }); // (adapted)
      throw applyError; //
    }
  }

  getRoutes() { return Array.from(this.routes.values()); } //
  getRoute(method, path) { return this.routes.get(`${method.toUpperCase()}:${path}`) || null; } //
  getModuleRoutes(moduleId) { return Array.from(this.routes.values()).filter(r => r.moduleId === moduleId); } //

  unregisterRoute(method, path) { //
    const routeKey = `${method.toUpperCase()}:${path}`; // [cite: 1151]
    const route = this.routes.get(routeKey);
    if (!route) return false; //

    const unregistered = this.routes.delete(routeKey); //
    if (unregistered) {
      this.recordMetric('corerouter.routes.unregistered', 1, { moduleId: route.moduleId, method: route.method }); //
      super.emit('route:unregistered', { moduleId: route.moduleId, method: route.method, path, timestamp: new Date().toISOString() }); //
    }
    return unregistered;
  }

  unregisterModuleRoutes(moduleId) { //
    const moduleRoutes = this.getModuleRoutes(moduleId); // [cite: 1155]
    let count = 0;
    for (const route of moduleRoutes) { // [cite: 1155]
      if (this.unregisterRoute(route.method, route.path)) { //
        count++;
      }
    }
    if (count > 0) {
        this.recordMetric('corerouter.module.routes.unregistered', count, { moduleId });
    }
    return count; // [cite: 1157]
  }

  clearRoutes() { //
    const count = this.routes.size; // [cite: 1158]
    this.routes.clear(); // [cite: 1158]
    if (count > 0) {
        this.recordMetric('corerouter.routes.cleared', count); //
        super.emit('routes:cleared', { count, timestamp: new Date().toISOString() }); // [cite: 1159]
    }
    return this;
  }

  /**
   * Utility to register a versioned route.
   * This is primarily for convenience if RouterSystem exposes it. CoreRouter itself just registers what it's given.
   * @param {string} moduleId
   * @param {string|number} version
   * @param {string} method
   * @param {string} path
   * @param {Function} handler
   * @param {object} [options={}]
   * @returns {CoreRouter}
   */
  registerVersionedRoute(moduleId, version, method, path, handler, options = {}) { //
    const basePath = path.startsWith('/') ? path : `/${path}`;
    const versionedPath = `/api/v${version}${basePath}`; // [cite: 1160]
    return this.registerRoute(moduleId, method, versionedPath, handler, { ...options, apiVersion: version }); //
  }

  generateOpenApiDoc(info = {}) { //
    const paths = {}; // [cite: 1162]
    const tags = new Set(); // [cite: 1162]

    for (const route of this.getRoutes()) { //
      const { method, path, options } = route;
      if (options.tags && Array.isArray(options.tags)) options.tags.forEach(tag => tags.add(tag)); //

      const pathParams = []; //
      const openApiPath = path.replace(/:([^/]+)/g, (_, paramName) => { // [cite: 1165]
        pathParams.push({ name: paramName, in: 'path', required: true, schema: { type: 'string' } }); // [cite: 1165]
        return `{${paramName}}`; //
      });

      if (!paths[openApiPath]) paths[openApiPath] = {}; //
      paths[openApiPath][method.toLowerCase()] = { // [cite: 1167]
        tags: options.tags || [], //
        summary: options.summary || '', //
        description: options.description || '', //
        parameters: [
          ...pathParams,
          ...(options.schema?.parameters || []), // Assuming schema might define other params
        ], //
        requestBody: options.schema?.body ? { content: { 'application/json': { schema: options.schema.body } } } : undefined,
        responses: options.schema?.responses || { '200': { description: 'Success' } }, // [cite: 1171]
        security: options.auth ? [{ bearerAuth: [] }] : [], //
      };
    }

    return { //
      openapi: '3.0.0',
      info: { // [cite: 1173]
        title: info.title || 'API Documentation', //
        version: info.version || CoreRouter.version, // [cite: 1174]
        description: info.description || '', // [cite: 1175]
      },
      tags: Array.from(tags).map(tag => ({ name: tag, description: '' })), // [cite: 1175]
      paths, // [cite: 1175]
      components: { // [cite: 1176]
        securitySchemes: { // [cite: 1176]
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, // [cite: 1176]
        },
        schemas: info.components?.schemas || {} // Allow passing in shared schemas
      },
    };
  }


  // --- Event Handlers ---
  async handleRouteRegistration(event) { //
    // Event data is expected to be the full event object from CoreEventBus
    const routeData = event.data || event; // Adapt if event structure varies
    try {
      const { moduleId, method, path, handler, options } = routeData; // [cite: 1184]
      this.registerRoute(moduleId, method, path, handler, options || {}); //
    } catch (error) {
      // This error is from CoreRouter's own registerRoute (e.g. conflict)
      // It's already a RouterError. _handleInternalError will log and forward.
      await this._handleInternalError(error, { eventName: event.name, receivedData: routeData }); // (adapted)
      // No need to re-emit router:error here as registerRoute itself or _handleInternalError would emit.
    }
  }

  async handleRouteUnregistration(event) { // New handler
    const routeData = event.data || event;
    try {
        const { method, path } = routeData;
        this.unregisterRoute(method, path);
    } catch (error) {
        await this._handleInternalError(error, { eventName: event.name, receivedData: routeData });
    }
  }


  async handleRoutesClear(event) { //
    try {
      this.clearRoutes(); // [cite: 1186]
    } catch (error) {
      await this._handleInternalError(error, { eventName: event.name }); // (adapted)
    }
  }

  async handleModuleUnregister(event) { //
    const eventData = event.data || event;
    try {
      const { moduleId } = eventData; // [cite: 1188]
      if (moduleId) {
        this.unregisterModuleRoutes(moduleId); //
      } else {
          throw new RouterError(ErrorCodes.ROUTER.INVALID_PAYLOAD, "moduleId missing in router.module.unregister event payload.");
      }
    } catch (error) {
      await this._handleInternalError(error, { eventName: event.name, receivedData: eventData }); // [cite: 1189] (adapted)
    }
  }

  /**
   * Shuts down the CoreRouter.
   * Clears routes, adapters, middleware, and unsubscribes from events.
   * @returns {Promise<void>}
   */
  async shutdown() { //
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { // [cite: 1190]
      return;
    }
    super.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'CoreRouter' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; // [cite: 1191]
    const shutdownStartTime = Date.now();

    try {
      if (this.deps.eventBusSystem && this.deps.eventBusSystem.getEventBus) {
        const eventBus = this.deps.eventBusSystem.getEventBus();
        if (eventBus && typeof eventBus.unsubscribe === 'function') {
          for (const subId of this.subscriptions) { // [cite: 1192]
            eventBus.unsubscribe(subId); //
          }
        }
      }
      this.subscriptions = [];

      this.routes.clear(); //
      this.adapters.clear(); //
      this.middleware.clear(); //

      this.state.status = SYSTEM_STATUS.SHUTDOWN; // [cite: 1194]
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('corerouter.shutdown.time', shutdownTime);
      this.recordMetric('corerouter.shutdown.success', 1, { timestamp: Date.now() }); //
      super.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'CoreRouter', durationMs: shutdownTime, timestamp: new Date().toISOString() }); // (adapted)

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; //
      this.recordMetric('corerouter.shutdown.failure', 1, { error: error.code, timestamp: Date.now() }); //
      await this._handleInternalError(error, { phase: 'shutdown' }); // [cite: 1197]
      // Do not re-throw from CoreRouter shutdown itself unless critical, error is logged.
      // Original code threw a new RouterError.
      // It's safer for system stability not to throw from a core component's shutdown.
    }
  }


  // --- Health Checks & Metrics ---
  setupDefaultHealthChecks() { // [cite: 1085]
    this.registerHealthCheck('corerouter.state', this.checkSystemState.bind(this)); //
    this.registerHealthCheck('corerouter.routes', this.checkRouteStatus.bind(this)); //
    this.registerHealthCheck('corerouter.adapters', this.checkAdapterStatus.bind(this)); //
    this.registerHealthCheck('corerouter.middleware', this.checkMiddlewareStatus.bind(this));
  }

  recordMetric(name, value, tags = {}) { //
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags });
  }

  getMetrics() {
    const metrics = {};
    for (const [name, data] of this.state.metrics) {
      metrics[name] = data;
    }
    return metrics;
  }

  registerHealthCheck(name, checkFn) { //
    if (typeof checkFn !== 'function') {
        const err = new RouterError(ErrorCodes.ROUTER.INVALID_HANDLER, `CoreRouter Health check '${name}' must be a function.`); // [cite: 1090] (adapted)
        this._handleInternalError(err); // Log, but rethrow
        throw err;
    }
    this.state.healthChecks.set(name, checkFn);
  }

  async checkHealth() { //
    const results = {};
    let overallStatus = SYSTEM_STATUS.HEALTHY;

    for (const [name, checkFn] of this.state.healthChecks) {
      try {
        const checkResult = await checkFn();
        results[name] = checkResult;
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) { //
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY && checkResult.status === SYSTEM_STATUS.DEGRADED)
            ? SYSTEM_STATUS.DEGRADED
            : SYSTEM_STATUS.UNHEALTHY; //
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]); // (adapted)
        overallStatus = SYSTEM_STATUS.UNHEALTHY; // [cite: 1094]
      }
    }
    return { //
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

  async checkRouteStatus() { // (adapted)
    const routes = Array.from(this.routes.values());
    const routesByMethod = {};
    for (const route of routes) {
      routesByMethod[route.method] = (routesByMethod[route.method] || 0) + 1;
    }
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      count: routes.length, // [cite: 1087]
      byMethod: routesByMethod, // [cite: 1087]
      // Example: include first 5 route keys for quick check, if desired and not too verbose
      // sampleRouteKeys: Array.from(this.routes.keys()).slice(0, 5)
    });
  }

  async checkAdapterStatus() { // (adapted)
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      count: this.adapters.size, //
      adapterNames: Array.from(this.adapters.keys()), // [cite: 1089]
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

// No default factory function for CoreRouter, as it's typically managed by RouterSystem
// export default CoreRouter; // Original file had this. Named export is generally preferred.