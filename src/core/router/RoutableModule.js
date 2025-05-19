/**
 * @file RoutableModule.js
 * @description Extends CoreModule to provide route registration capabilities for modules.
 * Routes are declared by the module and emitted as events for the RouterSystem to process.
 */

import { CoreModule } from '../module/CoreModule.js';
import { RouterError } from '../errors/types/RouterError.js'; // Assuming this is in types/RouterError.js
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS } from '../common/SystemConstants.js'; // For checking module state

export class RoutableModule extends CoreModule {
  // Inherits static dependencies and version from CoreModule.
  // If RoutableModule had specific additional dependencies, they'd be added here.
  // static dependencies = [...CoreModule.dependencies, 'anotherDependency'];
  static version = '2.0.0'; // Override CoreModule's version if specific to Routable features

  /**
   * Creates a new RoutableModule instance.
   * @param {object} [deps={}] - Dependencies for the RoutableModule.
   */
  constructor(deps = {}) {
    super(deps); //
    this.routes = []; // Stores route definitions before the module (and router) is initialized
                     // or for immediate registration if already initialized.
    // Health check for routes will be registered in onInitialize or onSetupHealthChecks
  }

  /**
   * Registers an HTTP route.
   * If the module is already initialized and running, it attempts to register immediately
   * by emitting an event. Otherwise, stores the route for batch registration during onInitialize.
   *
   * @param {string} method - HTTP method (e.g., 'GET', 'POST').
   * @param {string} path - Route path (e.g., '/users/:id').
   * @param {Function} handler - The handler function for this route.
   * @param {object} [options={}] - Route-specific options (e.g., schema, middleware, auth requirements).
   * @returns {RoutableModule} This instance for chaining.
   */
  registerRoute(method, path, handler, options = {}) { //
    if (!method || typeof method !== 'string' || !method.trim()) {
      // Use this.handleError for operational errors that are recoverable or need logging by the module
      // For programming errors like invalid arguments, throwing directly is often better.
      throw new RouterError(ErrorCodes.ROUTER.INVALID_METHOD, `${this.constructor.name}: Route method must be a non-empty string.`); //
    }
    if (!path || typeof path !== 'string' || !path.trim()) {
      throw new RouterError(ErrorCodes.ROUTER.INVALID_PATH, `${this.constructor.name}: Route path must be a non-empty string.`); //
    }
    if (typeof handler !== 'function') {
      throw new RouterError(ErrorCodes.ROUTER.INVALID_HANDLER, `${this.constructor.name}: Route handler for ${method} ${path} must be a function.`); //
    }

    const routeDefinition = {
      method: method.toUpperCase(), //
      path, //
      handler: handler.bind(this), // Ensure 'this' context is the module instance [cite: 1054]
      options: options || {}, //
    };

    this.routes.push(routeDefinition); // [cite: 1054]
    this.recordMetric(`${this.constructor.name.toLowerCase()}.routes.defined`, 1, { method: routeDefinition.method, path });

    // If module is already running, emit event for immediate registration by RouterSystem
    // This relies on eventBus being available and RouterSystem listening.
    if (this.state.status === SYSTEM_STATUS.RUNNING && this.eventBus) { // [cite: 1055]
      this._emitRouteRegistration(routeDefinition)
          .catch(error => {
              // Error during immediate emission, log it via module's error handler
              this.handleError(new RouterError(
                  ErrorCodes.ROUTER.ROUTE_REGISTRATION_FAILED,
                  `${this.constructor.name}: Failed to emit immediate registration for ${routeDefinition.method} ${routeDefinition.path}.`,
                  { method: routeDefinition.method, path: routeDefinition.path, originalMessage: error.message },
                  { cause: error }
              ), { phase: 'immediate-route-registration' });
          });
    }
    return this; //
  }

  /**
   * Helper to emit the route registration event.
   * @private
   */
  async _emitRouteRegistration(routeDefinition) {
    if (!this.eventBus) {
        // This might happen if eventBus wasn't ready when module was initialized.
        // The route is stored in this.routes and will be registered by registerAllRoutes later.
        console.warn(`[${this.constructor.name}] EventBus not available for emitting route: ${routeDefinition.method} ${routeDefinition.path}. It will be registered during batch registration.`);
        return;
    }
    await this.eventBus.emit('router.route.register', { // [cite: 1058]
      moduleId: this.constructor.name, //
      ...routeDefinition, // Spreads method, path, handler, options
    }); //
    this.recordMetric(`${this.constructor.name.toLowerCase()}.routes.emitted_for_registration`, 1, { method: routeDefinition.method, path: routeDefinition.path });
  }


  /**
   * Registers a versioned API route. Prepends `/api/v<version>` to the path.
   * @param {string|number} version - The API version number (e.g., 1, '2.1').
   * @param {string} method - HTTP method.
   * @param {string} path - Route path (e.g., '/users').
   * @param {Function} handler - Route handler.
   * @param {object} [options={}] - Route options.
   * @returns {RoutableModule} This instance.
   */
  registerVersionedRoute(version, method, path, handler, options = {}) { //
    if (!version || (typeof version !== 'string' && typeof version !== 'number')) {
        throw new RouterError(ErrorCodes.ROUTER.INVALID_API_VERSION || 'INVALID_API_VERSION', `${this.constructor.name}: API version must be a non-empty string or number.`);
    }
    const basePath = path.startsWith('/') ? path : `/${path}`; //
    const versionedPath = `/api/v${version}${basePath}`; //
    return this.registerRoute(method, versionedPath, handler, { //
      ...options, //
      apiVersion: version, // Add version to options for RouterSystem/Adapter use
    });
  }

  /**
   * Emits events for all defined routes to be registered by the RouterSystem.
   * Typically called during the module's `onInitialize` lifecycle hook.
   * @returns {Promise<void>}
   */
  async registerAllRoutes() { //
    if (!this.eventBus) {
      await this.handleError(new ModuleError(
          ErrorCodes.MODULE.DEPENDENCY_NOT_READY,
          `${this.constructor.name}: EventBus is not available for registering routes. Ensure EventBusSystem is initialized.`,
          { moduleName: this.constructor.name }
      ), { phase: 'registerAllRoutes' });
      // Do not throw here, as this might be called during initialization where eventBus could be late.
      // Routes remain in this.routes and can be registered later if a mechanism is added.
      return;
    }

    let successfulEmissions = 0;
    for (const route of this.routes) { //
      try {
        await this._emitRouteRegistration(route); //
        successfulEmissions++;
      } catch (error) {
        // Error during batch emission, log it and continue with others
        await this.handleError(new RouterError(
            ErrorCodes.ROUTER.ROUTE_REGISTRATION_FAILED,
            `${this.constructor.name}: Failed to emit registration for ${route.method} ${route.path} during batch.`,
            { method: route.method, path: route.path, originalMessage: error.message },
            { cause: error }
        ), { phase: 'batch-route-registration' });
      }
    }
    this.recordMetric(`${this.constructor.name.toLowerCase()}.routes.batch_emitted`, successfulEmissions, { totalDefined: this.routes.length });
  }

  /**
   * Unregisters a previously registered route by emitting an event.
   * @param {string} method - HTTP method.
   * @param {string} path - Route path.
   * @returns {Promise<boolean>} True if the unregistration event was emitted, false if route not found locally.
   */
  async unregisterRoute(method, path) { //
    const upperMethod = method.toUpperCase(); //
    const index = this.routes.findIndex(r => r.method === upperMethod && r.path === path); //

    if (index === -1) { // [cite: 1069]
      this.deps.logger?.warn(`[${this.constructor.name}] Route ${upperMethod} ${path} not found locally for unregistration.`);
      return false; //
    }

    this.routes.splice(index, 1); //
    this.recordMetric(`${this.constructor.name.toLowerCase()}.routes.removed_local`, 1, { method: upperMethod, path });

    if (this.state.status === SYSTEM_STATUS.RUNNING && this.eventBus) { //
      try {
        await this.eventBus.emit('router.route.unregister', { //
          moduleId: this.constructor.name, //
          method: upperMethod, //
          path, //
        });
        this.recordMetric(`${this.constructor.name.toLowerCase()}.routes.emitted_for_unregistration`, 1, { method: upperMethod, path });
        return true; //
      } catch (error) {
         await this.handleError(new RouterError(
            ErrorCodes.ROUTER.ROUTE_UNREGISTRATION_FAILED || 'ROUTE_UNREGISTRATION_FAILED',
            `${this.constructor.name}: Failed to emit unregistration for ${upperMethod} ${path}.`,
            { method: upperMethod, path: path, originalMessage: error.message },
            { cause: error }
        ), { phase: 'route-unregistration' });
        return false; // Emission failed
      }
    }
    return true; // Removed locally, but not emitted if module not running or no eventBus
  }

  // --- CoreModule Lifecycle Overrides ---

  /**
   * Registers a health check for the routes defined by this module.
   * This is called by CoreModule's `setupHealthChecks`.
   */
  async onSetupHealthChecks() { // // (Hook from CoreModule)
    await super.onSetupHealthChecks(); // Call CoreModule's hook first
    this.registerHealthCheck(`${this.constructor.name.toLowerCase()}.routes`, async () => { //
      return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, { //
        count: this.routes.length, //
        paths: this.routes.map(r => `${r.method} ${r.path}`), //
      });
    });
  }

  /**
   * Hook into CoreModule's initialization to register all defined routes.
   */
  async onInitialize() { // // (Hook from CoreModule)
    await super.onInitialize(); // Call CoreModule's initialization logic first
    // Register all routes that might have been defined before eventBus was ready or if not using immediate registration
    await this.registerAllRoutes(); //
  }

  /**
   * Hook into CoreModule's shutdown to signal unregistration of all this module's routes.
   */
  async onShutdown() { // // (Hook from CoreModule)
    if (this.state.status === SYSTEM_STATUS.RUNNING && this.eventBus) { // Check if it was running
      try {
        await this.eventBus.emit('router.module.unregister', { // [cite: 1075]
          moduleId: this.constructor.name, //
        });
        this.recordMetric(`${this.constructor.name.toLowerCase()}.routes.all_emitted_for_unregistration`, 1);
      } catch (error) {
        await this.handleError(new RouterError(
            ErrorCodes.ROUTER.MODULE_UNREGISTRATION_FAILED || 'MODULE_UNREGISTRATION_FAILED',
            `${this.constructor.name}: Failed to emit module route unregistration event.`,
            { moduleId: this.constructor.name, originalMessage: error.message },
            { cause: error }
        ), { phase: 'module-routes-unregistration' });
      }
    }
    this.routes = []; // Clear local route definitions [cite: 1076]
    await super.onShutdown(); // Call CoreModule's shutdown logic last
  }
}

/**
 * Factory function for creating a RoutableModule instance.
 * @param {object} [deps={}] - Dependencies for the RoutableModule.
 * @returns {RoutableModule}
 */
export function createRoutableModule(deps = {}) { //
  // CoreModule's factory (createModule) already handles default dependencies for errorSystem, eventBusSystem, config.
  // So, we can just pass deps through.
  return new RoutableModule(deps); //
}

// Default export of an object containing the class and factory was present in original file.
// For ES Modules, named exports are generally preferred.
// export default { RoutableModule, createRoutableModule };