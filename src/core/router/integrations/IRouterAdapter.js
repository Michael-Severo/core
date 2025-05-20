/**
 * @file src/core/router/integrations/IRouterAdapter.js
 * @description Defines the interface for framework-specific router adapters
 * that integrate with the CoreRouter.
 */

/**
 * @interface IRouterAdapter
 * @description Interface that framework-specific router adapters must implement.
 * These adapters are responsible for taking a list of standardized route definitions
 * from CoreRouter and applying them to a specific HTTP web framework instance.
 */
export class IRouterAdapter {
  /**
   * Applies an array of route definitions to the given web framework instance
   * for the initial setup.
   * Each route object in the array will typically include:
   * - `method`: (string) The HTTP method (e.g., 'GET', 'POST').
   * - `path`: (string) The route path.
   * - `handler`: (Function) The request handler function.
   * - `options`: (object) An object containing any framework-specific options,
   * schema definitions, middleware references, etc.
   * - `resolvedMiddleware`: (Array<Function>) An array of actual middleware handler
   * functions to be applied to this route, pre-resolved by CoreRouter.
   *
   * @param {object} framework - The instance of the web framework (e.g., Fastify app, Express app).
   * @param {Array<object>} routes - An array of route definition objects.
   * @returns {Promise<object|void>|object|void} The framework instance with routes applied, or nothing.
   * Return type can be Promise if adapter's operations are async.
   * @throws {Error} If the framework instance is invalid or if applying routes fails.
   */
  async applyRoutes(framework, routes) {
    if (this.constructor === IRouterAdapter) {
        throw new Error('IRouterAdapter.applyRoutes() is an abstract method and must be implemented by a subclass.');
    }
    throw new Error('IRouterAdapter.applyRoutes() must be implemented by subclass.');
  }

  /**
   * Dynamically refreshes the routes being served by the adapter.
   * This method is called when CoreRouter's route table has changed and the
   * live routes need to be updated without a full application restart.
   * The implementation will vary by adapter (e.g., updating an internal router,
   * re-registering a scoped plugin if the framework supports it).
   *
   * @param {Array<object>} routes - The new, complete list of route definition objects
   * from CoreRouter. Each object has the same structure as in `applyRoutes`.
   * @returns {Promise<void>|void}
   * @throws {Error} If refreshing routes fails.
   */
  async refreshRoutes(routes) {
    if (this.constructor === IRouterAdapter) {
        throw new Error('IRouterAdapter.refreshRoutes() is an abstract method and must be implemented by a subclass.');
    }
    throw new Error('IRouterAdapter.refreshRoutes() must be implemented by subclass.');
  }

  /**
   * Optional method for adapters to perform any necessary cleanup during shutdown.
   * For example, an adapter might need to release resources or unregister global handlers.
   *
   * @returns {Promise<void>|void}
   */
  async shutdown() {
    // Subclasses can override this if they have specific shutdown logic.
  }
}
