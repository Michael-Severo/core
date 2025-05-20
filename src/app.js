// src/app.js (Example Application Entry Point)

import { TSMISCoreRuntime } from './core/TSMISCoreRuntime.js'; // Adjust path as needed
import Fastify from 'fastify';

// --- 1. Application Configuration ---
const appConfig = {
  appName: 'My TSMIS Powered Web Service',
  port: process.env.PORT || 3000,
  environment: process.env.NODE_ENV || 'development',
  apiGatewayPrefix: '', // All TSMIS routes will be under ''

  core: { // Optional overrides for TSMIS Core defaults
    // containerSystem: { initOrder: ['myAppService'] },
    // coreEventBus: { maxHistorySize: 100 }
  },

  // Example config for an application module
  // myExampleModule: {
  //   someSetting: 'exampleValue',
  //   featureEnabled: true,
  // },
};

// --- 2. Logger ---
const logger = console; // Replace with your preferred logger (Pino, Winston, etc.)

// --- 3. Application Modules (Import and define them here) ---
// import { MyExampleModule } from './modules/my-example-module/MyExampleModule.js';
const applicationModulesToRegister = [
  // {
  //   name: 'exampleModule',
  //   Class: MyExampleModule,
  //   config: appConfig.myExampleModule,
  // },
];

// --- 4. Main Application Function ---
async function startMyApplication() {
  logger.info(`[App] Bootstrapping '${appConfig.appName}'...`);

  // Instantiate your chosen web framework
  const fastifyInstance = Fastify({
    logger: {
      level: appConfig.environment === 'development' ? 'debug' : 'info',
      // Custom serializers are handled by TSMISCoreRuntime when integrating FastifyErrorHandler
    },
    requestIdHeader: 'x-request-id',
    disableRequestLogging: appConfig.environment === 'development' ? false : true,
  });

  // Create and configure the TSMIS Core Runtime
  const tsmisRuntime = new TSMISCoreRuntime({
    frameworkInstance: fastifyInstance,
    frameworkType: 'fastify', // TSMIS Core will use the Fastify adapter/integrations
    appConfig: appConfig,
    logger: logger,
    applicationModules: applicationModulesToRegister
  });

  try {
    // Start the TSMIS Core and your application
    await tsmisRuntime.start();
    logger.info(`[App] '${tsmisRuntime.getAppConfig().appName}' is now fully operational and listening on port ${tsmisRuntime.getAppConfig().port}.`);

    // Application is running.
    // For further interactions post-startup, you can use `tsmisRuntime.getContainer()` etc.

  } catch (error) {
    logger.error('[App] CRITICAL FAILURE: TSMIS Application failed to start.');
    // Detailed error logging is handled within TSMISCoreRuntime.start()
    // Ensure process exits if startup is catastrophic.
    process.exit(1);
  }

  // --- Graceful Shutdown ---
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
  signals.forEach(signal => {
    process.on(signal, async () => {
      logger.info(`[App] Received ${signal}. Initiating graceful shutdown for '${tsmisRuntime.getAppConfig().appName}'...`);
      try {
        await tsmisRuntime.shutdown();
        logger.info('[App] Graceful shutdown complete. Exiting process.');
        process.exit(0);
      } catch (shutdownError) {
        logger.error('[App] Error during graceful shutdown:', shutdownError);
        process.exit(1);
      }
    });
  });
}

// --- Global Unhandled Error Catchers ---
process.on('unhandledRejection', (reason, promise) => {
  (logger || console).error('CRITICAL GLOBAL FAILURE: Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1); // Exit on unhandled promise rejection
});

process.on('uncaughtException', (error, origin) => {
  (logger || console).error(`CRITICAL GLOBAL FAILURE: Uncaught Exception. Origin: ${origin}`, error);
  process.exit(1); // Exit on uncaught exception
});

// --- Run the Application ---
startMyApplication();