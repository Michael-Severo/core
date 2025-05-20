/**
 * @file src/core/TSMISCoreRuntime.js
 * @description Main runtime class for initializing and managing a TSMIS core application.
 * It orchestrates the CoreBootstrapper and integrates the HTTP web framework.
 */

import { CoreBootstrapper } from './bootstrap/CoreBootstrapper.js';
import { FastifyAdapter } from './router/index.js'; // Default adapter for now
import { FastifyErrorHandler, createFastifyLoggerErrorSerializer } from './errors/integrations/fastify/index.js';
// Note: We are not importing Fastify itself here; the user provides the framework instance.
import { SYSTEM_STATUS, LIFECYCLE_EVENTS } from './common/SystemConstants.js';
import { CoreError, ErrorCodes } from './errors/index.js';

export class TSMISCoreRuntime {
  /**
   * Creates an instance of TSMISCoreRuntime.
   * @param {object} [options={}] - Configuration options for the runtime.
   * @param {object} options.frameworkInstance - An instance of the web framework (e.g., a Fastify instance). **Required**.
   * @param {string} [options.frameworkType='fastify'] - The type of web framework being used (e.g., 'fastify').
   * @param {object} [options.appConfig={}] - The global application configuration object.
   * @param {object} [options.logger=console] - An application logger instance.
   * @param {Array<object>} [options.applicationModules=[]] - An array of application-specific module definitions
   * to be registered. Each definition: { name: string, Class: CoreModule_Subclass, config?: object }.
   */
  constructor(options = {}) {
    this.appConfig = options.appConfig || { appName: 'TSMIS Application', port: 3000, environment: 'development' };
    this.logger = options.logger || console;
    this.frameworkInstance = options.frameworkInstance;
    this.frameworkType = (options.frameworkType || 'fastify').toLowerCase();
    this.applicationModules = options.applicationModules || [];

    if (!this.frameworkInstance) {
      const err = new CoreError(
        ErrorCodes.CORE.INVALID_ARGUMENT, // Using a CORE prefixed code
        'A web frameworkInstance (e.g., a Fastify app instance) must be provided to TSMISCoreRuntime.'
      );
      this.logger.error(`[TSMISCoreRuntime] ${err.message}`, err.toJSON());
      throw err; // Fail fast
    }

    this.container = null; // Will be the initialized ContainerSystem
    this.coreBootstrapper = new CoreBootstrapper(this.appConfig, this.logger, this.applicationModules);

    // Bind methods to ensure 'this' context if they are detached or used as event handlers
    this.start = this.start.bind(this);
    this.shutdown = this.shutdown.bind(this);
  }

  /**
   * Initializes all core systems, registers application modules,
   * sets up the HTTP framework, and starts the server.
   * @returns {Promise<TSMISCoreRuntime>} The initialized runtime instance.
   * @throws {CoreError} If startup fails.
   */
  async start() {
    this.logger.info(`[TSMISCoreRuntime] Starting TSMIS Core for app: ${this.appConfig.appName || 'Untitled TSMIS App'}...`);
    try {
      // 1. Bootstrap core systems and application modules (via CoreBootstrapper)
      this.container = await this.coreBootstrapper.bootstrapCore();
      this.logger.info('[TSMISCoreRuntime] Core systems and application modules bootstrapped successfully.');

      // 2. Resolve essential systems from the now-initialized container
      const routerSystem = await this.container.resolve('routerSystem');
      const errorSystem = await this.container.resolve('errorSystem');
      // ModuleSystem is already initialized, application modules are registered.

      this.logger.info('[TSMISCoreRuntime] Core systems for HTTP setup resolved.');

      // 3. Setup HTTP Framework Integration
      if (this.frameworkType === 'fastify') {
        const fastify = this.frameworkInstance;

        const fastifyAdapter = new FastifyAdapter({
          logger: fastify.log || this.logger, // Prefer framework's logger if available
          gatewayPrefix: this.appConfig.apiGatewayPrefix !== undefined ? this.appConfig.apiGatewayPrefix : '/api' // Allow empty prefix
        });
        routerSystem.registerAdapter('fastifyHttp', fastifyAdapter);
        this.logger.info('[TSMISCoreRuntime] FastifyAdapter ("fastifyHttp") registered with RouterSystem.');

        // Register FastifyErrorHandler with ErrorSystem
        // Note: ErrorSystem should have been initialized by bootstrapCore
        await errorSystem.registerIntegration(
          'fastifyMainIntegration', // A unique name for this integration instance
          FastifyErrorHandler,      // The FastifyErrorHandler class
          fastify,                  // The Fastify framework instance
          { errorSystem: errorSystem, logger: fastify.log || this.logger } // Options
        );
        this.logger.info('[TSMISCoreRuntime] FastifyErrorHandler integration registered with ErrorSystem.');

        // Configure Fastify Logger Serializer for consistent error logging
        const activeFastifyIntegration = errorSystem.integrations.get('fastifyMainIntegration');
        if (activeFastifyIntegration && typeof fastify.log?.setSerializers === 'function') {
            fastify.log.setSerializers({
                ...(fastify.log.serializers || {}), // Preserve existing serializers
                error: createFastifyLoggerErrorSerializer(
                    activeFastifyIntegration.serializeError.bind(activeFastifyIntegration)
                )
            });
            this.logger.info('[TSMISCoreRuntime] Fastify logger error serializer updated for TSMIS format.');
        } else if (activeFastifyIntegration) {
            this.logger.warn('[TSMISCoreRuntime] Fastify logger might not support setSerializers or is not Pino-compatible. Custom error serialization for logger may not apply.');
        }

        // Apply TSMIS Routes (defined by RoutableModules) to Fastify via the adapter
        this.logger.info('[TSMISCoreRuntime] Applying routes to Fastify...');
        await routerSystem.applyRoutes(fastify, 'fastifyHttp');
        this.logger.info('[TSMISCoreRuntime] Routes applied. Fastify gateway is active.');

        // Start the HTTP Server
        const port = this.appConfig.port || 3000;
        const host = this.appConfig.host || '0.0.0.0'; // Default to listen on all interfaces
        this.logger.info(`[TSMISCoreRuntime] Starting Fastify server on ${host}:${port}...`);
        await fastify.listen({ port, host });
        this.logger.info(`[TSMISCoreRuntime] ${this.appConfig.appName} listening on port ${port}. Core Runtime is UP!`);
      } else {
        throw new CoreError(
            ErrorCodes.CORE.NOT_IMPLEMENTED, // Using a CORE prefixed code
            `Framework type '${this.frameworkType}' is not currently supported by TSMISCoreRuntime.`
        );
      }

      this.logger.info('[TSMISCoreRuntime] TSMIS Core started successfully.');
      return this; // Return the runtime instance

    } catch (error) {
      this.logger.error('[TSMISCoreRuntime] CRITICAL ERROR DURING TSMISCoreRuntime STARTUP:', error.message);
      if (error instanceof CoreError) {
        this.logger.error(`  Error Code: ${error.code}`);
        this.logger.error(`  Error Details: ${JSON.stringify(error.details, null, 2)}`);
        if (error.cause) {
            this.logger.error(`  Error Cause: ${error.cause.name} - ${error.cause.message}`);
        }
      }
      this.logger.error(`  Stack: ${error.stack}`);
      
      // Attempt graceful shutdown of what might have started
      await this.shutdown().catch(shutdownErr => {
          this.logger.error('[TSMISCoreRuntime] Error during automated shutdown after startup failure:', shutdownErr);
      });
      throw error; // Re-throw the original error for the calling application to handle (e.g., process.exit)
    }
  }

  /**
   * Gracefully shuts down all core systems and the HTTP server.
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.logger.info('[TSMISCoreRuntime] Initiating TSMIS Core shutdown...');
    let serverClosed = false;
    if (this.frameworkInstance && typeof this.frameworkInstance.close === 'function') {
      // Check if server is actually listening before trying to close
      // Fastify specific: server.listening
      if (this.frameworkInstance.server && this.frameworkInstance.server.listening) {
        this.logger.info('[TSMISCoreRuntime] Closing HTTP server...');
        await this.frameworkInstance.close()
            .then(() => { serverClosed = true; this.logger.info('[TSMISCoreRuntime] HTTP server closed.'); })
            .catch(err => this.logger.error('[TSMISCoreRuntime] Error closing HTTP server:', err));
      } else {
        this.logger.info('[TSMISCoreRuntime] HTTP server was not listening, no need to close.');
        serverClosed = true; // Consider it "closed" if not started
      }
    } else {
        serverClosed = true; // No server instance or no close method
    }

    if (this.container) {
      const containerStatus = this.container.getSystemStatus?.().status;
      if (containerStatus && containerStatus !== SYSTEM_STATUS.SHUTDOWN && containerStatus !== SYSTEM_STATUS.CREATED) {
        this.logger.info(`[TSMISCoreRuntime] Shutting down ContainerSystem (current status: ${containerStatus})...`);
        await this.container.shutdown().catch(err => this.logger.error('[TSMISCoreRuntime] Error shutting down ContainerSystem:', err));
      } else {
        this.logger.info(`[TSMISCoreRuntime] ContainerSystem already shutdown or not initialized. Status: ${containerStatus}`);
      }
    } else {
      this.logger.info('[TSMISCoreRuntime] No container instance to shutdown.');
    }
    this.logger.info('[TSMISCoreRuntime] Shutdown sequence complete.');
  }

  /**
   * Provides access to the initialized dependency injection container.
   * @returns {ContainerSystem|null} The ContainerSystem instance, or null if not started.
   */
  getContainer() {
    if (!this.container || this.container.getSystemStatus?.().status !== SYSTEM_STATUS.RUNNING) {
        this.logger.warn('[TSMISCoreRuntime] getContainer() called, but core systems are not fully running.');
    }
    return this.container;
  }

  /**
   * Provides access to the application configuration.
   * @returns {object} The application configuration object.
   */
  getAppConfig() {
    return this.appConfig;
  }

  /**
   * Provides access to the logger.
   * @returns {object} The logger instance.
   */
  getLogger() {
    return this.logger;
  }
}