# TSMIS Core Framework

**TSMIS Core is a robust, modular, and standardized Node.js framework designed to accelerate the development of scalable and maintainable enterprise-level applications.**

It provides a comprehensive set of interconnected core systems that handle common application concerns like dependency injection, lifecycle management, error handling, event-driven communication, and HTTP routing, allowing developers to focus on business logic.

## Key Features

* **Modular Architecture**: Build your application as a collection of independent, manageable business modules using `CoreModule` and `RoutableModule` base classes, orchestrated by `ModuleSystem`[cite: 642, 677, 2692].
* **Standardization Pillars**: Core systems and modules adhere to consistent patterns for:
    * State Management [cite: 624, 829]
    * Error Handling (Centralized via `ErrorSystem` with `CoreError` and `ErrorCodes.js`) [cite: 624, 633, 715]
    * Lifecycle Management (`initialize`, `shutdown`) [cite: 625, 848]
    * Health Monitoring (`checkHealth`) [cite: 625, 852]
    * Metrics Tracking (`recordMetric`) [cite: 626, 857]
* **Dependency Injection**: Powered by `ContainerSystem` for managing component dependencies and lifecycles[cite: 349, 629, 688].
* **Event-Driven Communication**: Decoupled inter-component communication via `EventBusSystem` and `CoreEventBus`, supporting publish/subscribe, queuing, and event history[cite: 637, 786].
* **Framework-Agnostic Routing**:
    * Define HTTP routes within `RoutableModule`s, independent of the web framework[cite: 645, 3239].
    * `RouterSystem` and `CoreRouter` manage route registration and application.
    * Pluggable adapters (e.g., `FastifyAdapter`) integrate with your chosen web framework[cite: 3142, 3277].
    * **Dynamic Route Updates**: Supports updating routes at runtime without a full server restart, ideal for development workflows[cite: 618, 3248].
* **Simplified Bootstrap**: `TSMISCoreRuntime` provides a high-level API to easily initialize and start your application with minimal boilerplate.

## Core Systems Overview

TSMIS Core is built around these key systems (found in `src/core/`):

* **`ContainerSystem`**: Manages DI, component registration, and lifecycle.
* **`ErrorSystem`**: Centralizes error processing and framework integration for error responses.
* **`EventBusSystem`**: Orchestrates event-driven communication via `CoreEventBus`.
* **`ModuleSystem`**: Manages the lifecycle and DI for your business logic modules (extensions of `CoreModule`).
* **`RouterSystem`**: Manages HTTP route definitions, middleware, and framework adapters.

## Getting Started: Bootstrapping Your Application

TSMIS Core makes it easy to get your application up and running. The primary entry point is `TSMISCoreRuntime`.

Here’s a conceptual `app.js` for a Fastify application:

1.  **Define Application Configuration (`appConfig`)**:
    ```javascript
    // my-app-config.js (or directly in app.js)
    export const myAppConfig = {
      appName: 'My TSMIS Powered Service',
      port: process.env.PORT || 3000,
      environment: process.env.NODE_ENV || 'development',
      apiGatewayPrefix: '/api/v1', // Base path for your TSMIS routes

      // Optional overrides for TSMIS Core defaults
      core: {
        // containerSystem: { initOrder: ['myCustomService'] },
        // coreEventBus: { maxHistorySize: 100 }
      },

      // Config for your application modules
      inventoryModule: {
        lowStockThreshold: 10,
      }
    };
    ```

2.  **Define Your Application Modules**:
    These are classes that extend `CoreModule` or `RoutableModule`.
    ```javascript
    // src/modules/inventory/InventoryModule.js (Example)
    // import { RoutableModule } from 'tsmis-core'; // Assuming tsmis-core is your npm package
    // import { ErrorCodes } from 'tsmis-core';
    // import { InventoryService } from './InventoryService.js'; // Your service

    // export class InventoryModule extends RoutableModule {
    //   static dependencies = [...RoutableModule.dependencies, 'inventoryService'];
    //
    //   constructor(deps) {
    //     super(deps);
    //     this.inventoryService = deps.inventoryService; // Directly injected!
    //     this.logger.info(`InventoryModule using threshold: ${this.config.lowStockThreshold}`);
    //   }
    //
    //   async onInitialize() {
    //     await super.onInitialize();
    //     this.registerRoute('GET', '/items/:sku', this.handleGetItem);
    //     this.logger.info('InventoryModule routes defined.');
    //   }
    //
    //   async handleGetItem(request, reply) {
    //     // const item = await this.inventoryService.getItem(request.params.sku);
    //     // if (!item) throw new CoreError(ErrorCodes.CORE.RESOURCE_NOT_FOUND, 'Item not found');
    //     // return item;
    //   }
    // }
    ```

3.  **Create Your Main `app.js`**:
    ```javascript
    // src/app.js
    import { TSMISCoreRuntime } from 'tsmis-core'; // Adjust path if local: './core/TSMISCoreRuntime.js'
    import Fastify from 'fastify';
    import { myAppConfig } from './config/my-app-config.js'; // Your app config

    // Import your module classes and service factories
    // import { InventoryModule } from './modules/inventory/InventoryModule.js';
    // import { createInventoryService } from './modules/inventory/InventoryService.js';

    const logger = console; // Or your preferred logger

    async function startApp() {
      // Define your application modules to be registered by TSMIS Core
      const applicationModules = [
        // {
        //   name: 'inventory', // Unique name for this module instance
        //   Class: InventoryModule,
        //   config: myAppConfig.inventoryModule // Pass module-specific config
        // },
        // Add other modules here
      ];

      // Register any non-module application services with the container *before* bootstrapping core if modules depend on them.
      // Or, TSMISCoreRuntime can be enhanced to accept service definitions too.
      // For now, services expected by modules should be resolvable by ContainerSystem.
      // One way is to register them with a temporary container used by CoreBootstrapper,
      // or have CoreBootstrapper accept service definitions.
      // (This part of direct service registration for modules is handled by ModuleSystem using the main container)

      const tsmisRuntime = new TSMISCoreRuntime({
        frameworkInstance: Fastify({ logger: { level: myAppConfig.environment === 'development' ? 'debug' : 'info' } }),
        frameworkType: 'fastify',
        appConfig: myAppConfig,
        logger: logger,
        applicationModules: applicationModules
      });

      try {
        await tsmisRuntime.start();
        logger.info(`Application '${tsmisRuntime.getAppConfig().appName}' is UP and running on port ${tsmisRuntime.getAppConfig().port}`);

        // To register a non-module service *after* core start (if not a module dependency):
        // const container = tsmisRuntime.getContainer();
        // if (container) {
        //    container.register('myUtilityService', () => new MyUtilityService());
        //    await (await container.resolve('myUtilityService')).initialize?.();
        // }

      } catch (error) {
        logger.error('[App] CRITICAL FAILURE during application startup:', error);
        process.exit(1);
      }

      // Graceful shutdown
      ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => 
        process.on(signal, async () => {
          logger.info(`[App] Received ${signal}. Shutting down...`);
          await tsmisRuntime.shutdown();
          process.exit(0);
        })
      );
    }

    startApp();
    ```

**How Module Configuration Works:**
* You define module-specific configurations within your main `appConfig` (e.g., `appConfig.inventoryModule`).
* When defining your `applicationModules` array for `TSMISCoreRuntime`, you pass this specific config section to your module's definition: `{ name: 'inventory', Class: InventoryModule, config: appConfig.inventoryModule }`.
* `TSMISCoreRuntime` (via `CoreBootstrapper` and `ModuleSystem`) ensures this config is passed to your module's constructor.
* Your module (extending `CoreModule`) can then access it via `this.config`.

## Developing Your Application

With TSMIS Core handling the underlying infrastructure:
* Focus on building your business logic within **Services**.
* Expose functionality through **Modules** that extend `CoreModule` or `RoutableModule`.
* Declare dependencies (other modules or services) in your module's `static dependencies` array. `ModuleSystem` will inject them.
    * Example: `static dependencies = [...CoreModule.dependencies, 'myCustomService', { name: 'optionalAnalyticsModule', optional: true }];`
* Leverage `this.eventBus.emit()` and `this.eventBus.subscribe()` for event-driven interactions.
* Use `this.handleError()` for reporting errors, throwing specific `CoreError` subclasses with codes from `ErrorCodes.js`.
* Implement lifecycle hooks like `onInitialize()` and `onShutdown()` in your modules for setup and cleanup.

## Our Philosophy

TSMIS Core aims to provide a highly structured, yet flexible, foundation based on best practices like Dependency Injection, Event-Driven Design, and clear Separation of Concerns. By standardizing common patterns, it allows developers to build complex applications more efficiently and with greater confidence in their stability and maintainability.
