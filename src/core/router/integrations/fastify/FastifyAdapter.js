/**
 * @file src/core/router/integrations/fastify/FastifyAdapter.js
 * @description Implements IRouterAdapter for the Fastify web framework,
 * supporting dynamic route updates.
 */

import { IRouterAdapter } from '../IRouterAdapter.js';
import { CoreError } from '../../../errors/CoreError.js';
import { ErrorCodes } from '../../../errors/ErrorCodes.js';
import findMyWay from 'find-my-way'; // Fastify's router

export class FastifyAdapter extends IRouterAdapter {
  /** @type {object|null} */
  logger = null;
  /** @type {object|null} */
  fastify = null; // Store the fastify instance
  /** @type {object|null} */
  internalRouter = null; // Instance of find-my-way
  /** @type {string} */
  gatewayPrefix = '/api'; // Configurable prefix for all dynamic routes. Can be empty string for root.
  /** @type {boolean} */
  gatewayInitialized = false;

  /**
   * Creates an instance of FastifyAdapter.
   * @param {object} [options={}] - Optional adapter configuration.
   * @param {object} [options.logger=console] - A logger instance.
   * @param {string} [options.gatewayPrefix='/api'] - A prefix for all routes handled by this adapter.
   */
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
    if (options.gatewayPrefix !== undefined) { // Allow empty string prefix
        this.gatewayPrefix = options.gatewayPrefix;
    }
    // Internal router will be initialized on first applyRoutes or explicit initialize
  }

  /**
   * Initializes the gateway route on the Fastify instance.
   * This should be called once.
   * @param {object} fastifyInstance - The Fastify framework instance.
   */
  _initializeGateway(fastifyInstance) {
    if (this.gatewayInitialized) return;

    this.fastify = fastifyInstance;
    this.internalRouter = findMyWay({
      defaultRoute: (req, res) => {
        // This is the 404 handler for routes *within* the gatewayPrefix
        // Fastify's own 404 will handle requests outside the gatewayPrefix
        this.logger.warn(`[FastifyAdapter] Internal 404: Route ${req.method} ${req.url} not found within gateway.`);
        // Fastify's `res` is actually a `Reply` object.
        const reply = res; // For clarity if `res` is used by find-my-way's handler signature
        reply.code(404).send({
          error: 'Not Found',
          message: `Route ${req.method} ${req.url} not found.`,
          statusCode: 404
        });
      },
      // find-my-way can also take a caseSensitive option, Fastify defaults to case-sensitive
    });

    const gatewayPath = this.gatewayPrefix ? `${this.gatewayPrefix}/*` : '/*';

    this.fastify.all(gatewayPath, this._gatewayHandler.bind(this));
    this.logger.info(`[FastifyAdapter] Gateway initialized. Listening for all methods on: ${gatewayPath}`);
    this.gatewayInitialized = true;
  }

  /**
   * Handles incoming requests to the gateway route and dispatches them
   * using the internal router.
   * @private
   * @param {object} request - Fastify request object.
   * @param {object} reply - Fastify reply object.
   */
  async _gatewayHandler(request, reply) {
    // find-my-way expects the path without the prefix if the prefix is part of the gateway.
    let searchPath = request.raw.url; // Use raw.url to get the full path with query string
    if (this.gatewayPrefix && searchPath.startsWith(this.gatewayPrefix)) {
        searchPath = searchPath.substring(this.gatewayPrefix.length);
        if (!searchPath.startsWith('/')) {
            searchPath = '/' + searchPath;
        }
    }
    // Remove query string for matching, find-my-way handles it separately if needed by route constraints
    const queryIndex = searchPath.indexOf('?');
    if (queryIndex !== -1) {
        searchPath = searchPath.substring(0, queryIndex);
    }


    const found = this.internalRouter.find(request.raw.method, searchPath);

    if (found && found.handler) {
      request.params = found.params; // Attach URL params from find-my-way
      const routeStore = found.store || {}; // TSMIS route options and middleware
      const tsmisHandler = found.handler;
      const resolvedMiddleware = routeStore.resolvedMiddleware || [];

      try {
        // Execute middleware
        for (const mw of resolvedMiddleware) {
          // Fastify preHandlers can be async and can send a response to terminate early
          // We need to await them and check if response has been sent.
          await mw(request, reply);
          if (reply.sent) return;
        }
        // Execute main handler
        await tsmisHandler(request, reply);
      } catch (error) {
        // Errors from middleware or handler will be caught by Fastify's global error handler
        // which should be set up by FastifyErrorHandler integration.
        this.logger.error(`[FastifyAdapter] Error in TSMIS handler/middleware for ${request.raw.method} ${request.raw.url}:`, error);
        reply.send(error); // Forward to Fastify's error handler
      }
    } else {
      // Let find-my-way's defaultRoute (our internal 404) handle it
      this.internalRouter.defaultRoute(request.raw, reply, {});
    }
  }


  /**
   * Applies an array of route definitions to the internal router.
   * Initializes the gateway on the first call.
   * @override
   */
  async applyRoutes(fastifyInstance, routes) {
    if (!fastifyInstance || typeof fastifyInstance.all !== 'function') {
      throw new CoreError(
        ErrorCodes.ROUTER.INVALID_FRAMEWORK,
        'Invalid Fastify instance provided to FastifyAdapter.'
      );
    }

    if (!this.gatewayInitialized) {
      this._initializeGateway(fastifyInstance);
    } else if (this.fastify !== fastifyInstance) {
        this.logger.warn('[FastifyAdapter] applyRoutes called with a new Fastify instance after initial setup. Re-initializing gateway. This might lead to multiple gateway routes if not managed carefully.');
        this._initializeGateway(fastifyInstance); // Re-initialize if fastify instance changed (e.g. testing)
    }
    
    // Clear existing routes from internal router and repopulate
    // This makes applyRoutes effectively a refresh as well.
    this.internalRouter = findMyWay({ defaultRoute: this.internalRouter.defaultRoute }); // Re-init with same 404
    
    this.logger.info(`[FastifyAdapter] Applying/Updating ${routes.length} routes to internal router.`);

    for (const route of routes) {
      const { method, path, handler, options = {}, resolvedMiddleware = [] } = route;
      
      // Path for find-my-way should be relative to the gatewayPrefix
      let internalPath = path;
      if (this.gatewayPrefix && path.startsWith(this.gatewayPrefix)) {
          internalPath = path.substring(this.gatewayPrefix.length);
          if (!internalPath.startsWith('/')) {
              internalPath = '/' + internalPath;
          }
      }
      if (internalPath === '') internalPath = '/'; // Root of the prefix

      // Store TSMIS options and middleware in the 'store' argument of find-my-way
      const routeStore = {
        tsmisOptions: options,
        resolvedMiddleware: resolvedMiddleware || []
      };

      try {
        this.internalRouter.on(method.toUpperCase(), internalPath, handler, routeStore);
        this.logger.debug(`[FastifyAdapter] Internal route added: ${method.toUpperCase()} ${internalPath}`);
      } catch (error) {
        const routeApplicationError = new CoreError(
          ErrorCodes.ROUTER.ROUTE_REGISTRATION_FAILED, // Using a ROUTER code
          `Failed to add route ${method} ${internalPath} to internal router.`,
          { routePath: internalPath, routeMethod: method, originalMessage: error.message },
          { cause: error }
        );
        this.logger.error(routeApplicationError.message, routeApplicationError.toJSON());
        throw routeApplicationError;
      }
    }
    this.logger.info(`[FastifyAdapter] Internal router updated with ${routes.length} routes.`);
    return fastifyInstance;
  }

  /**
   * Dynamically refreshes the routes in the internal router.
   * @override
   */
  async refreshRoutes(routes) {
    if (!this.gatewayInitialized || !this.internalRouter) {
      this.logger.warn('[FastifyAdapter] Gateway not initialized. Cannot refresh routes. Call applyRoutes first.');
      // Optionally, could call applyRoutes here if fastify instance is known and this is desired behavior.
      // For now, refreshRoutes assumes applyRoutes has run at least once.
      if (this.fastify) { // If we have the fastify instance, we can effectively do an apply.
          this.logger.info('[FastifyAdapter] Calling applyRoutes from refreshRoutes as gateway was not initialized or internal router missing.');
          return this.applyRoutes(this.fastify, routes);
      }
      throw new CoreError(ErrorCodes.ROUTER.NOT_INITIALIZED, "FastifyAdapter gateway not initialized, cannot refresh routes.");
    }

    this.logger.info(`[FastifyAdapter] Refreshing internal router with ${routes.length} routes.`);
    
    // Re-initialize the internal router and add all new routes
    // This is the simplest way to ensure a clean state.
    this.internalRouter = findMyWay({ defaultRoute: this.internalRouter.defaultRoute });

    for (const route of routes) {
      const { method, path, handler, options = {}, resolvedMiddleware = [] } = route;
      let internalPath = path;
      if (this.gatewayPrefix && path.startsWith(this.gatewayPrefix)) {
          internalPath = path.substring(this.gatewayPrefix.length);
           if (!internalPath.startsWith('/')) {
              internalPath = '/' + internalPath;
          }
      }
      if (internalPath === '') internalPath = '/';

      const routeStore = {
        tsmisOptions: options,
        resolvedMiddleware: resolvedMiddleware || []
      };
      try {
        this.internalRouter.on(method.toUpperCase(), internalPath, handler, routeStore);
      } catch (error) {
         // Log error but continue trying to add other routes during a refresh
        this.logger.error(`[FastifyAdapter] Error adding route ${method} ${internalPath} during refresh: ${error.message}`);
      }
    }
    this.logger.info(`[FastifyAdapter] Internal router refreshed successfully.`);
  }

  /**
   * Optional shutdown logic for the FastifyAdapter.
   */
  async shutdown() {
    this.logger.info('[FastifyAdapter] Shutdown.');
    this.internalRouter = null;
    this.fastify = null;
    this.gatewayInitialized = false;
  }
}
