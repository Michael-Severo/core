# Bootstrapping Your TSMIS Application

Welcome to TSMIS Core! This guide will walk you through setting up and starting your application using our standardized core runtime. The goal is to get your TSMIS-powered application up and running with minimal boilerplate in your main application file (`app.js`).

## Understanding the Bootstrap Architecture

The TSMIS bootstrap process is designed to be robust and handle the initialization of all core systems in the correct order. Here's a simplified overview of the components involved:

1.  **Your `app.js` (Application Entry Point)**: This is *your* main file. You'll define application-specific configurations, list your business modules, instantiate your chosen web framework (e.g., Fastify), and then use `TSMISCoreRuntime` to bring everything to life.
2.  **`TSMISCoreRuntime` (`tsmis-core/src/core/TSMISCoreRuntime.js`)**: This is the main class you'll interact with from your `app.js`. It's the primary entry point to the TSMIS Core library. It takes your application's specifics (like your Fastify instance, config, logger, and modules) and orchestrates the entire setup and startup process.
3.  **`CoreBootstrapper` (`tsmis-core/src/core/bootstrap/CoreBootstrapper.js`)**: Used internally by `TSMISCoreRuntime`. This class is responsible for the detailed setup of the core infrastructure. It creates the main Dependency Injection (DI) container (`ContainerSystem`) and registers all the essential TSMIS core systems (like `ErrorSystem`, `EventBusSystem`, `ModuleSystem`, `RouterSystem`) based on a predefined manifest. It also handles the registration of your application-specific modules before the final initialization wave.
4.  **`core.manifest.js` (`tsmis-core/src/core/core.manifest.js`)**: An internal configuration file within TSMIS Core that lists the core systems and their default settings. This is used by `CoreBootstrapper` to know what core components to load.

**The Flow:**

Your `app.js` essentially tells `TSMISCoreRuntime` what framework and application-specifics to use. `TSMISCoreRuntime` then uses `CoreBootstrapper` to:
* Create and configure the main `ContainerSystem`.
* Register core TSMIS systems (Error, Event, Module, Router systems) and your application modules.
* Initialize everything in the correct dependency order.
Once the core is up, `TSMISCoreRuntime` sets up the HTTP integrations (like error handling and routing for your web framework) and starts the HTTP server.

## Setting Up Your `app.js`

Here’s a step-by-step guide to creating your application's main entry file.

### Prerequisites
* Node.js installed.
* Your TSMIS Core library available (e.g., installed via npm or linked locally).
* Your chosen web framework installed (this guide uses Fastify as an example).

### Step 1: Define Your Application Configuration (`appConfig`)

Create a configuration object that holds settings for your application. TSMIS Core will use parts of this, and you'll use it for your own modules.

* **`appName`**: A name for your application instance.
* **`port`**: The port your HTTP server will listen on.
* **`environment`**: E.g., 'development', 'production'.
* **`apiGatewayPrefix`**: (Optional) A base path for all routes handled by TSMIS (e.g., `/api/v1`).
* **`core`**: (Optional) An object to override default configurations for TSMIS core systems.
    * `core.containerSystem`: Settings for the main DI container, like `initOrder` additions or `maxErrorHistory`.
    * `core.errorSystem`, `core.eventBus`, etc.: Sections for specific core system overrides.
* **Module Configurations**: Include sections for each of your business modules (e.g., `myInventoryModule: { settingA: true }`).

**Example**: appConfig Structure

```javascript
// In your app.js or a separate config file (e.g., src/config/app-config.js)

// const myAppSpecificConfig = {
//   appName: 'My Awesome TSMIS App',
//   port: process.env.PORT || 3001, // Example: Use a different port
//   environment: process.env.NODE_ENV || 'development',
//   apiGatewayPrefix: '/myapi/v1', // All TSMIS routes will be under /myapi/v1

//   // Optional: Overrides for TSMIS Core system configurations
//   core: {
//     containerSystem: {
//       // Add other components to be initialized after core systems
//       initOrder: ['myCustomAppService1'], // Will be merged with coreSystemInitOrder
//       maxErrorHistory: 75, // Override default for the main container
//     },
//     errorSystem: {
//       // No specific overrides for ErrorSystem in this example
//     },
//     coreEventBus: { // Note: config key for CoreEventBus specific settings
//       maxHistorySize: 250, // Override default for CoreEventBus
//       queueBatchSize: 75,
//     },
//     moduleSystem: {
//       defaultHealthCheckIntervalMs: 45000, // Override default for ModuleSystem
//     },
//     // routerSystem: { /* ... */ }
//   },

//   // Application-specific module configurations
//   inventoryModuleConfig: { // Key used to pass to InventoryModule
//     lowStockThreshold: 15,
//     defaultSupplierId: 'SUP-XYZ',
//     featureFlags: {
//       enableAutoReordering: false,
//     },
//   },
//   userModuleConfig: {
//     passwordPolicy: {
//       minLength: 10,
//       requireUppercase: true,
//     },
//     sessionTimeoutMinutes: 60,
//   },
//   // Configuration for other custom services or components
//   myCustomAppService1: {
//     apiKey: process.env.CUSTOM_SERVICE_API_KEY || 'fallback_api_key',
//   }
// };

// // If in a separate file, export it:
// // export default myAppSpecificConfig;
```

### Step 2: Define Your Logger

TSMIS Core components expect a logger instance. You can provide your preferred logger (like Pino, Winston) or use `console` for simplicity during initial development. The logger should support methods like `.info()`, `.warn()`, `.error()`, `.debug()`.

**Example**: Logger Definition

```javascript
// In your app.js

// For simple use cases or initial development, 'console' can act as a basic logger.
// const logger = console;

// For production, you'd typically use a more robust logger like Pino or Winston:
// import pino from 'pino';
// const logger = pino({
//   level: myAppSpecificConfig.environment === 'development' ? 'debug' : 'info',
//   prettyPrint: myAppSpecificConfig.environment === 'development' ? { colorize: true, translateTime: 'SYS:standard' } : false,
// });
// logger.info('Pino logger initialized.');

// Ensure the logger instance has methods like .info(), .warn(), .error(), .debug()
// TSMIS Core components will use these.
```

### Step 3: Define Your Application Modules

Your application's business logic will reside in modules that extend `CoreModule` or `RoutableModule` from TSMIS Core. You need to create an array defining these modules so `TSMISCoreRuntime` can register and initialize them.

Each module definition in the array should be an object with:
* `name`: A unique string to register this module instance (e.g., `'inventory'`).
* `Class`: The actual imported class of your module (e.g., `MyInventoryModule`).
* `config`: (Optional) The specific configuration object for this module instance, typically a slice from your main `appConfig` (e.g., `appConfig.myInventoryModule`).

**Example**: Application Module Definitions

```javascript
// In your app.js

// 1. Import your module classes (assuming they exist in your project)
// import { MyInventoryModule } from './modules/inventory/InventoryModule.js';
// import { MyUserManagementModule } from './modules/user/UserManagementModule.js';
// import { myAppSpecificConfig } from './config/app-config.js'; // (if config is separate)


// 2. Define the array of application modules for TSMISCoreRuntime
// const applicationModulesToRegister = [
//   {
//     name: 'inventoryManager', // Unique name for this module instance in ModuleSystem
//     Class: MyInventoryModule,    // The actual class (constructor function)
//     config: myAppSpecificConfig.inventoryModuleConfig // Pass its specific configuration
//   },
//   {
//     name: 'userAccess',
//     Class: MyUserManagementModule,
//     config: myAppSpecificConfig.userModuleConfig,
//     // If a module has no specific config, you can omit the 'config' key or pass {}
//   },
//   // Add more of your application's business modules here
// ];
```

### Step 4: Instantiate Your HTTP Framework

Create an instance of your chosen web framework. `TSMISCoreRuntime` needs this instance to integrate routing and error handling.

**Example**:

```javascript
// In your app.js
// import Fastify from 'fastify';
// import { myAppSpecificConfig } from './config/app-config.js'; // (if config is separate)
// const logger = console; // or your configured logger

// const fastifyInstance = Fastify({
//   logger: { // Configure Fastify's internal logger
//     level: myAppSpecificConfig.environment === 'development' ? 'debug' : 'info',
//     // Note: Custom error serializer for Fastify's logger will be handled by TSMISCoreRuntime
//     // if you're using the FastifyErrorHandler integration.
//   },
//   requestIdHeader: 'x-request-id', // Recommended for request tracing
//   // You can add other Fastify-specific options here
//   // e.g., ajv: { customOptions: { ... } }
// });

// logger.info('[App] Fastify instance created.');
```

### Step 5: Create and Start `TSMISCoreRuntime`

Now, instantiate `TSMISCoreRuntime` with the pieces you've prepared and call its `start()` method.

* **`frameworkInstance`**: The Fastify (or other framework) instance you created.
* **`frameworkType`**: A string indicating the framework type (e.g., `'fastify'`). TSMIS Core uses this to select the correct internal adapter.
* **`appConfig`**: Your main application configuration object.
* **`logger`**: Your logger instance.
* **`applicationModules`**: The array of your business module definitions.

**Example**: `TSMISCoreRuntime` Instantiation and Start

```javascript
// In your app.js, within an async function
// import { TSMISCoreRuntime } from 'tsmis-core'; // Adjust path to TSMISCoreRuntime.js
// const fastifyInstance = ... ; // from Step 4
// const myAppSpecificConfig = ... ; // from Step 1
// const logger = ... ; // from Step 2
// const applicationModulesToRegister = ... ; // from Step 3

// async function startMyApplication() {
//   const tsmisRuntime = new TSMISCoreRuntime({
//     frameworkInstance: fastifyInstance,
//     frameworkType: 'fastify',       // Specify the framework type
//     appConfig: myAppSpecificConfig, // Your global application configuration
//     logger: logger,                 // Your application logger
//     applicationModules: applicationModulesToRegister // Your defined business modules
//   });

//   try {
//     await tsmisRuntime.start(); // This initializes core, registers your modules, sets up HTTP, and starts the server.
//     logger.info(`[App] '${tsmisRuntime.getAppConfig().appName}' started successfully!`);

//     // Your application is now running.
//     // You can access the container or other core components from tsmisRuntime if needed:
//     // const container = tsmisRuntime.getContainer();
//     // const moduleSystem = await container.resolve('moduleSystem');

//   } catch (error) {
//     logger.error('[App] CRITICAL FAILURE during TSMISCoreRuntime startup:', error);
//     process.exit(1); // Exit if core startup fails
//   }
// }
```

### Step 6: Add Graceful Shutdown (Recommended)

It's good practice to handle process signals for a clean shutdown of your application. `TSMISCoreRuntime` provides a `shutdown()` method for this.

**Example**: Graceful Shutdown Handling

```javascript
// In your app.js, after defining tsmisRuntime (likely within your main async function or globally)

// // const tsmisRuntime = ... ; // Initialized TSMISCoreRuntime instance
// // const logger = ... ;

// const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

// signals.forEach(signal => {
//   process.on(signal, async () => {
//     logger.info(`[App] Received ${signal}. Initiating graceful shutdown for '${tsmisRuntime.getAppConfig().appName}'...`);
//     try {
//       await tsmisRuntime.shutdown(); // Call the shutdown method on your runtime instance
//       logger.info('[App] Graceful shutdown complete. Exiting.');
//       process.exit(0);
//     } catch (shutdownError) {
//       logger.error('[App] Error during graceful shutdown:', shutdownError);
//       process.exit(1); // Exit with error on shutdown failure
//     }
//   });
// });

// // Global error catchers for truly unhandled issues during bootstrap or runtime
// process.on('unhandledRejection', (reason, promise) => {
//   const log = global.logger || logger || console; // Try to use a configured logger
//   log.error('CRITICAL FAILURE: Unhandled Rejection at:', promise, 'reason:', reason);
//   // Attempt a last-ditch shutdown if tsmisRuntime is available and might be running
//   if (typeof tsmisRuntime !== 'undefined' && tsmisRuntime && typeof tsmisRuntime.shutdown === 'function') {
//     tsmisRuntime.shutdown().finally(() => process.exit(1));
//   } else {
//     process.exit(1);
//   }
// });

// process.on('uncaughtException', (error, origin) => {
//   const log = global.logger || logger || console;
//   log.error(`CRITICAL FAILURE: Uncaught Exception. Origin: ${origin}`, error);
//   if (typeof tsmisRuntime !== 'undefined' && tsmisRuntime && typeof tsmisRuntime.shutdown === 'function') {
//     tsmisRuntime.shutdown().finally(() => process.exit(1));
//   } else {
//     process.exit(1);
//   }
// });
```

## Business Module Configuration In-Depth

You have fine-grained control over the configuration for each of your business modules.

1.  **Define in `appConfig`**: Create a dedicated section within your main `appConfig` object for each module. For example:
    ```javascript
    const appConfig = {
      // ... other global settings ...
      myModuleName: { // Configuration specific to 'myModuleName'
        setting1: 'value1',
        featureToggleX: true,
        apiEndpoint: '[https://api.example.com/data](https://api.example.com/data)'
      },
      anotherModule: { /* ... */ }
    };
    ```

2.  **Pass to `TSMISCoreRuntime`**: When defining your `applicationModules` array, pass the relevant slice of `appConfig` to the `config` property of your module definition:
    ```javascript
    // import { MyModule } from './modules/my-module.js';
    const applicationModules = [
      {
        name: 'myModuleInstanceName', // How it's registered in ModuleSystem
        Class: MyModule,
        config: appConfig.myModuleName // Pass the config section
      }
    ];
    ```

3.  **Access in Your Module**: Your `CoreModule` (or `RoutableModule`) subclass will receive this configuration object directly in its constructor's `deps` argument, and it's also conveniently available as `this.config`.
    ```javascript
    // Inside your MyModule.js (which extends CoreModule)
    // class MyModule extends CoreModule {
    //   constructor(deps) {
    //     super(deps);
    //     // this.config is automatically populated with appConfig.myModuleName
    //     this.logger.info(`MyModule setting1: ${this.config.setting1}`);
    //     this.featureXEnabled = this.config.featureToggleX;
    //   }
    //
    //   async onValidateConfig() {
    //     if (typeof this.config.apiEndpoint !== 'string') {
    //       throw new ValidationError(ErrorCodes.VALIDATION.INVALID_INPUT, "apiEndpoint must be a string");
    //     }
    //     return true;
    //   }
    //   // ...
    // }
    ```
    Your module can then use `this.config` and validate it in its `onValidateConfig()` lifecycle hook.

This approach allows for centralized application configuration while ensuring each module gets precisely the settings it needs.

## Complete `app.js` Example

Putting it all together, your simplified `app.js` might look like this:

**Complete `app.js` Example for TSMIS Core**:

```javascript
// src/app.js (Example Application Entry Point)

import { TSMISCoreRuntime } from './core/TSMISCoreRuntime.js'; // Adjust path as needed
import Fastify from 'fastify';

// --- 1. Application Configuration ---
const appConfig = {
  appName: 'My TSMIS Powered Web Service',
  port: process.env.PORT || 3000,
  environment: process.env.NODE_ENV || 'development',
  apiGatewayPrefix: '/api/v1', // All TSMIS routes will be under /api/v1

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
```

## What Happens Next?

Once `await tsmisRuntime.start()` completes successfully:
* All TSMIS core systems are initialized and running.
* Your application-specific modules (passed in the `applicationModules` array) are registered and initialized.
* The HTTP server is started and listening for requests.
* Routes defined by your `RoutableModule`s are live and handled by the appropriate adapter (e.g., `FastifyAdapter`).
* Errors will be processed by `ErrorSystem` and the configured framework error handler.
* Events can be emitted and subscribed to via the `EventBusSystem`.

You can now focus on building out the business logic within your modules and services! Refer to the specific documentation for `CoreModule`, `RoutableModule`, and the other core systems for details on how to leverage their features.