/**
 * @file src/core/router/integrations/fastify/FastifyAdapter.js
 * @description Implements IRouterAdapter for the Fastify web framework.
 */

import { IRouterAdapter } from '../IRouterAdapter.js';
import { CoreError } from '../../../errors/CoreError.js'; // For throwing specific errors if needed
import { ErrorCodes } from '../../../errors/ErrorCodes.js'; // For standardized error codes

export class FastifyAdapter extends IRouterAdapter {
  /**
   * @type {object|null}
   */
  logger = null;

  /**
   * Creates an instance of FastifyAdapter.
   * @param {object} [options={}] - Optional adapter configuration.
   * @param {object} [options.logger=console] - A logger instance.
   */
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
  }

  /**
   * Applies an array of route definitions to the given Fastify framework instance.
   *
   * @param {object} fastify - The Fastify framework instance.
   * @param {Array<object>} routes - An array of route definition objects. Each object includes:
   * - `method`: (string) The HTTP method.
   * - `path`: (string) The route path.
   * - `handler`: (Function) The main request handler function.
   * - `options`: (object) Route-specific options, which might include `options.fastify`
   * for Fastify-specific settings and `options.schema` for validation.
   * - `resolvedMiddleware`: (Array<Function>) An array of pre-resolved middleware
   * handler functions to be applied as preHandler hooks.
   * @returns {Promise<object>} The Fastify instance with routes applied.
   * @throws {CoreError} If the Fastify instance is invalid.
   * @override
   */
  async applyRoutes(fastify, routes) { //
    if (!fastify || typeof fastify.route !== 'function') { //
      throw new CoreError(
        ErrorCodes.ROUTER.INVALID_FRAMEWORK || 'ROUTER_INVALID_FRAMEWORK', // Ensure this code exists
        'Invalid Fastify instance provided to FastifyAdapter.'
      );
    }

    this.logger.info(`[FastifyAdapter] Applying ${routes.length} routes to Fastify instance.`);

    for (const route of routes) { //
      const { method, path, handler, options = {}, resolvedMiddleware = [] } = route; //

      // Extract Fastify-specific options and schema from the general route options
      const fastifySpecificOptions = options.fastify || {};
      const schema = options.schema || fastifySpecificOptions.schema || {}; // Prioritize options.schema

      const routeConfig = { //
        method: method.toUpperCase(), // Ensure method is uppercase for Fastify
        url: path, //
        schema,    //
        handler,   //
        ...fastifySpecificOptions, // Spread other Fastify-specific options (e.g., constraints, version)
      };

      // Add resolved middleware as preHandler hooks
      // Fastify's preHandler can be a single function or an array of functions.
      if (resolvedMiddleware && resolvedMiddleware.length > 0) {
        routeConfig.preHandler = resolvedMiddleware; //
      }

      try {
        fastify.route(routeConfig); //
        this.logger.debug(`[FastifyAdapter] Applied route: ${routeConfig.method} ${routeConfig.url}`);
      } catch (error) {
        // Fastify usually handles its own route definition errors well,
        // but catch any unexpected errors during the .route() call.
        const routeApplicationError = new CoreError(
          ErrorCodes.ROUTER.ROUTES_APPLICATION_FAILED,
          `Failed to apply route ${routeConfig.method} ${routeConfig.url} to Fastify.`,
          { routePath: routeConfig.url, routeMethod: routeConfig.method, originalMessage: error.message },
          { cause: error }
        );
        // Log it via the adapter's logger, as this is an adapter operational issue.
        // The caller (CoreRouter.applyRoutes) will catch this and handle it with ErrorSystem.
        this.logger.error(routeApplicationError.message, routeApplicationError.toJSON());
        throw routeApplicationError; // Re-throw for CoreRouter to handle
      }
    }

    this.logger.info(`[FastifyAdapter] Successfully applied ${routes.length} routes.`);
    return fastify; //
  }

  /**
   * Optional shutdown logic for the FastifyAdapter.
   */
  async shutdown() {
    this.logger.info('[FastifyAdapter] Shutdown.');
    // No specific resources to release for this adapter in its current form.
  }
}

// Default export for consistency if other adapters follow this pattern
// export default FastifyAdapter; // Original had this