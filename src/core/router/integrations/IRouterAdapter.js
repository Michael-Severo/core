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
   * Applies an array of route definitions to the given web framework instance.
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
    // This check ensures that users of this "interface" (which is a class in JS)
    // know that this method MUST be overridden.
    if (this.constructor === IRouterAdapter) {
        throw new Error('IRouterAdapter.applyRoutes() is an abstract method and must be implemented by a subclass.');
    }
    // The actual implementation will be in concrete adapters like FastifyAdapter.js
    // For the purpose of this interface file, we can throw or leave it more abstract.
    // Throwing ensures it's not called directly on an IRouterAdapter instance.
    throw new Error('IRouterAdapter.applyRoutes() must be implemented by subclass.'); // [cite: 1316]
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

// Named export is generally preferred for classes/interfaces in ES Modules.
// export default IRouterAdapter; // Original export [cite: 1316]