# TSMIS Routing System Documentation
Version: 2.1.0 (Refactored Core)

## Table of Contents

1.  [Introduction to the Routing System](#1-introduction-to-the-routing-system)
    * [1.1. Purpose & Philosophy](#11-purpose--philosophy)
    * [1.2. Key Components & Their Roles](#12-key-components--their-roles)
2.  [Component: `RoutableModule.js` - Defining Routes in Modules](#2-component-routablemodulejs---defining-routes-in-modules)
    * [2.1. Overview & Purpose](#21-overview--purpose)
    * [2.2. Key API for Route Definition](#22-key-api-for-route-definition)
        * [`registerRoute(method, path, handler, options)`](#registerroutemethod-path-handler-options)
        * [`registerVersionedRoute(version, method, path, handler, options)`](#registerversionedrouteversion-method-path-handler-options)
    * [2.3. Lifecycle Integration for Route Registration/Unregistration](#23-lifecycle-integration-for-route-registrationunregistration)
    * [2.4. Event Emission for Routes](#24-event-emission-for-routes)
3.  [Component: `CoreRouter.js` - The Routing Engine](#3-component-corerouterjs---the-routing-engine)
    * [3.1. Overview & Primary Responsibility](#31-overview--primary-responsibility)
    * [3.2. Key Functionalities & API (`CoreRouter`)](#32-key-functionalities--api-corerouter)
        * [3.2.1. Event-Driven Route Management](#321-event-driven-route-management)
        * [3.2.2. Route Registry & Conflict Detection](#322-route-registry--conflict-detection)
        * [3.2.3. Adapter Management (`registerAdapter`, `IRouterAdapter`)](#323-adapter-management-registeradapter-irouteradapter)
        * [3.2.4. Middleware Management (`registerMiddleware`, `getMiddlewareForRoute`)](#324-middleware-management-registermiddleware-getmiddlewareforroute)
        * [3.2.5. Applying Routes (`applyRoutes`)](#325-applying-routes-applyroutes)
        * [3.2.6. Dynamic Route Updates](#326-dynamic-route-updates)
        * [3.2.7. OpenAPI Documentation Generation (`generateOpenApiDoc`)](#327-openapi-documentation-generation-generateopenapidoc)
    * [3.3. State Management (`CoreRouter` Specifics)](#33-state-management-corerouter-specifics)
    * [3.4. Lifecycle Management (`CoreRouter` Specifics)](#34-lifecycle-management-corerouter-specifics)
    * [3.5. Error Handling within `CoreRouter`](#35-error-handling-within-corerouter)
    * [3.6. Event Integration (`CoreRouter` Specifics)](#36-event-integration-corerouter-specifics)
    * [3.7. Health Monitoring (`CoreRouter` Specifics)](#37-health-monitoring-corerouter-specifics)
    * [3.8. Metrics Tracking (`CoreRouter` Specifics)](#38-metrics-tracking-corerouter-specifics)
4.  [Component: `RouterSystem.js` - The Managing Facade](#4-component-routersystemjs---the-managing-facade)
    * [4.1. Overview & Primary Responsibility](#41-overview--primary-responsibility)
    * [4.2. Key Functionalities & API (`RouterSystem`)](#42-key-functionalities--api-routersystem)
        * [4.2.1. `initialize()` & `shutdown()`](#421-initialize--shutdown)
        * [4.2.2. `getRouter()`](#422-getrouter)
        * [4.2.3. Delegated `CoreRouter` Methods](#423-delegated-corerouter-methods)
        * [4.2.4. Handling Dynamic Route Updates](#424-handling-dynamic-route-updates)
    * [4.3. Adherence to Standardization Pillars (Recap for `RouterSystem`)](#43-adherence-to-standardization-pillars-recap-for-routersystem)
    * [4.4. State Management (`RouterSystem` Specifics)](#44-state-management-routersystem-specifics)
    * [4.5. Lifecycle Management (`RouterSystem` Specifics)](#45-lifecycle-management-routersystem-specifics)
    * [4.6. Error Handling within `RouterSystem`](#46-error-handling-within-routersystem)
    * [4.7. Event Integration (`RouterSystem` Specifics - Forwarding)](#47-event-integration-routersystem-specifics---forwarding)
    * [4.8. Health Monitoring (`RouterSystem` Specifics)](#48-health-monitoring-routersystem-specifics)
    * [4.9. Metrics Tracking (`RouterSystem` Specifics)](#49-metrics-tracking-routersystem-specifics)
    * [4.10. Static Factory (`createRouterSystem`)](#410-static-factory-createroutersystem)
5.  [Integrations (Routing System Level)](#5-integrations-routing-system-level)
6.  [Overall Routing Flow Diagram (Route Definition to Application)](#6-overall-routing-flow-diagram-route-definition-to-application)
7.  [Usage Examples & Best Practices](#7-usage-examples--best-practices)
    * [7.1. Defining Routes in a `RoutableModule`](#71-defining-routes-in-a-routablemodule)
    * [7.2. Registering a Framework Adapter (e.g., Fastify)](#72-registering-a-framework-adapter-eg-fastify)
    * [7.3. Registering and Using Middleware](#73-registering-and-using-middleware)
    * [7.4. Applying Routes to a Web Framework](#74-applying-routes-to-a-web-framework)
    * [7.5. Triggering Dynamic Route Updates (Development)](#75-triggering-dynamic-route-updates-development)
    * [7.6. Generating OpenAPI Documentation](#76-generating-openapi-documentation)
8.  [Testing Strategy Notes](#8-testing-strategy-notes)
9.  [Future Considerations & Potential Enhancements](#9-future-considerations--potential-enhancements)

---

## 1. Introduction to the Routing System

### 1.1. Purpose & Philosophy
The TSMIS Routing System provides a structured, flexible, and framework-agnostic way to define, manage, and serve HTTP routes. Its core philosophy is to decouple API endpoint definitions (within business modules) from the underlying HTTP web framework. This promotes modularity, testability, and framework interchangeability.
Key goals include:
* **Framework Agnosticism**.
* **Centralized Route Management** (`CoreRouter`).
* **Event-Driven Route Registration** (`RoutableModule` emitting events).
* **Pluggable Adapters** (`IRouterAdapter`).
* **Middleware Support**.
* **Dynamic Route Updates**: Allowing routes to be updated at runtime without a full application restart, especially beneficial during development.
* **API Documentation**: Automated OpenAPI specification generation.
* **Standardization**: Adherence to core TSMIS patterns.

### 1.2. Key Components & Their Roles
* **`RoutableModule.js`**: Extends `CoreModule` for modules defining HTTP routes. Provides `registerRoute()` and emits route events.
* **`CoreRouter.js`**: The routing engine. Listens for route events, maintains route registry, manages adapters and middleware, applies routes, and handles dynamic updates by signaling changes. Can generate OpenAPI docs.
* **`RouterSystem.js`**: High-level facade managing `CoreRouter`. Handles its lifecycle, simplifies common tasks, integrates routing with standard monitoring, and orchestrates dynamic route refreshes via adapters.
* **`IRouterAdapter.js`**: Interface for framework-specific adapters (e.g., `FastifyAdapter.js`). Adapters translate `CoreRouter` definitions to framework-specific calls and now include a `refreshRoutes` method.
* **`FastifyAdapter.js`**: Example `IRouterAdapter` for Fastify, now capable of dynamic route updates using an internal router.

---
## 2. Component: `RoutableModule.js` - Defining Routes in Modules

### 2.1. Overview & Purpose
`RoutableModule` extends `CoreModule`, enabling business modules to define their own HTTP API routes in a standardized way, decoupled from the central routing mechanism and web framework.

### 2.2. Key API for Route Definition
* **`registerRoute(method: string, path: string, handler: Function, options = {}): RoutableModule`**: Defines a route. Throws `RouterError` (using unprefixed codes like `INVALID_METHOD` from `ErrorCodes.ROUTER`) for invalid parameters.
* **`registerVersionedRoute(version: string | number, method: string, path: string, handler: Function, options = {}): RoutableModule`**: Convenience for versioned routes (e.g., `/api/v1`). Throws `RouterError` (using unprefixed code `INVALID_API_VERSION`) for invalid version.

### 2.3. Lifecycle Integration for Route Registration/Unregistration
* **`async onInitialize()`**: Typically calls `this.registerAllRoutes()` which emits `router.route.register` events for all defined routes.
* **`async onShutdown()`**: Emits `router.module.unregister` event to signal `CoreRouter` to remove routes for this module.

### 2.4. Event Emission for Routes
Events are broadcast via `CoreEventBus`:
* **`router.route.register`**: Payload: `{ moduleId, method, path, handler, options }`.
* **`router.route.unregister`**: Payload: `{ moduleId, method, path }`.
* **`router.module.unregister`**: Payload: `{ moduleId }`.

---
## 3. Component: `CoreRouter.js` - The Routing Engine

### 3.1. Overview & Primary Responsibility
`CoreRouter` is the central routing processor. It maintains the route registry, manages framework adapters and middleware, detects conflicts, applies routes to frameworks, and now signals when its route table has changed to support dynamic updates.

### 3.2. Key Functionalities & API (`CoreRouter`)

#### 3.2.1. Event-Driven Route Management
During `initialize()`, subscribes to events from `CoreEventBus`:
* `router.route.register` (`handleRouteRegistration`).
* `router.route.unregister` (`handleRouteUnregistration`).
* `router.routes.clear` (`handleRoutesClear`).
* `router.module.unregister` (`handleModuleUnregister`).

#### 3.2.2. Route Registry & Conflict Detection
Routes stored internally (Map `METHOD:path`). `registerRoute()` checks for conflicts. For dynamic updates, re-registering a route might be treated as an update by the adapter if `_routesAppliedOnce` is true, though direct conflict still logs a warning. Throws `RouterError` with unprefixed code `ROUTE_CONFLICT` for true conflicts before initial application.

#### 3.2.3. Adapter Management (`registerAdapter`, `IRouterAdapter`)
* `registerAdapter(name: string, adapter: IRouterAdapter)`: Registers adapters. `IRouterAdapter` now includes `refreshRoutes(routes)`. `RouterError` with unprefixed codes `INVALID_ADAPTER_NAME` or `INVALID_ADAPTER` is thrown for issues.

#### 3.2.4. Middleware Management (`registerMiddleware`, `getMiddlewareForRoute`)
* `registerMiddleware(name, handler, options)`: Registers named middleware. Throws `RouterError` with unprefixed codes `INVALID_MIDDLEWARE_NAME` or `INVALID_MIDDLEWARE` for issues.
* `getMiddlewareForRoute(route)`: Resolves and sorts applicable middleware.

#### 3.2.5. Applying Routes (`applyRoutes`)
* `async applyRoutes(framework, adapterName)`: Retrieves adapter, calls `adapter.applyRoutes()` with routes and their resolved middleware. Sets an internal flag `_routesAppliedOnce` to true on first successful application. Throws `RouterError` (using unprefixed codes like `NOT_INITIALIZED`, `INVALID_FRAMEWORK`, `ADAPTER_NOT_FOUND`, or `ROUTES_APPLICATION_FAILED`) on issues.

#### 3.2.6. Dynamic Route Updates
* **Event Emission**: When methods like `registerRoute`, `unregisterRoute`, `clearRoutes`, etc., modify the internal route table *after* `_routesAppliedOnce` is true and the router is running, `CoreRouter` emits a `router:routes:changed` event (locally via `super.emit`). This signals `RouterSystem` to trigger an adapter refresh.
* The `registerRoute` method, when `_routesAppliedOnce` is true, might allow overwriting (logging a warning) to facilitate updates, relying on the adapter's `refreshRoutes` to handle the new complete list.

#### 3.2.7. OpenAPI Documentation Generation (`generateOpenApiDoc`)
* `generateOpenApiDoc(info = {})`: Constructs OpenAPI 3.0 spec from the route registry.

### 3.3. State Management (`CoreRouter` Specifics)
Standard `this.state`. Manages maps: `this.routes`, `this.adapters`, `this.middleware`, `this.subscriptions`. Added `this._routesAppliedOnce: boolean`.

### 3.4. Lifecycle Management (`CoreRouter` Specifics)
* **`initialize()`**: Subscribes to route events. Emits lifecycle events.
* **`shutdown()`**: Unsubscribes, clears registries, resets `_routesAppliedOnce`. Emits lifecycle events.

### 3.5. Error Handling within `CoreRouter`
* `_handleInternalError` for operational errors (throws `RouterError` with unprefixed code `INTERNAL_SYSTEM_ERROR`). Reports via `safeHandleError`.
* Throws `RouterError` with specific unprefixed codes from `ErrorCodes.ROUTER` for API misuse or critical failures.

### 3.6. Event Integration (`CoreRouter` Specifics)
* **Subscribes to (on `CoreEventBus`)**: `router.route.*`, `router.module.unregister`.
* **Emits (Locally via `super.emit`)**: `route:registered`, `route:unregistered`, etc., and now `router:routes:changed`.

### 3.7. Health Monitoring (`CoreRouter` Specifics)
Provides `checkHealth()`. Default checks: `corerouter.state`, `corerouter.routes`, `corerouter.adapters`, `corerouter.middleware`.

### 3.8. Metrics Tracking (`CoreRouter` Specifics)
Records metrics for lifecycle, errors, route operations, adapter/middleware registrations, and now `corerouter.routes.changed.emitted`.

---
## 4. Component: `RouterSystem.js` - The Managing Facade

### 4.1. Overview & Primary Responsibility
`RouterSystem` is the high-level facade for routing. It orchestrates `CoreRouter`, handles its lifecycle, and integrates routing with application standards, including now managing dynamic route updates.

### 4.2. Key Functionalities & API (`RouterSystem`)

#### 4.2.1. `initialize()` & `shutdown()`
* **`async initialize(): Promise<RouterSystem>`**: Creates and initializes `CoreRouter`. Sets up event forwarding, including listening for `router:routes:changed` to trigger dynamic refreshes.
* **`async shutdown(): Promise<void>`**: Manages `CoreRouter` shutdown.

#### 4.2.2. `getRouter(): CoreRouter`
Provides access to the managed `CoreRouter` instance. Throws `RouterError` (unprefixed `NOT_INITIALIZED`) if not running.

#### 4.2.3. Delegated `CoreRouter` Methods
Exposes most of `CoreRouter`'s API (e.g., `registerAdapter`, `applyRoutes`). These methods delegate to `CoreRouter`, adding `RouterSystem`-level metrics and error handling. Errors from `CoreRouter` (already `RouterError` with prefixed codes) are caught and re-thrown after processing via `this.handleError()`.
* **`applyRoutes(framework, adapterName)`**: Now also stores the `adapterName` and `framework` instance as `this._activeAdapterName` and `this._activeFrameworkInstance` to be used for dynamic refreshes.

#### 4.2.4. Handling Dynamic Route Updates
* **`_setupEventForwardingAndDynamicRefresh()`**: In addition to forwarding operational events from `CoreRouter`, this method now also makes `RouterSystem` listen for the `router:routes:changed` event from its `CoreRouter` instance.
* **`async _handleCoreRoutesChanged(eventData)`**: This new private method is invoked when `router:routes:changed` is received. It checks if the system is in a valid state to refresh (router running, initial routes applied, active adapter known). If so, it retrieves the active adapter instance (e.g., `FastifyAdapter`) and calls its `adapter.refreshRoutes(this.router.getRoutes())` method. Errors during the refresh process are handled by `this.handleError()`.

### 4.3. Adherence to Standardization Pillars (Recap for `RouterSystem`)
* **State Management**: Standard `this.state`; holds `router` instance, `_activeAdapterName`, `_activeFrameworkInstance`.
* **Lifecycle Management**: Manages its own and `CoreRouter` lifecycle. Emits `LIFECYCLE_EVENTS`.
* **Error Handling**: `_handleInternalError` for own errors (throws `RouterError` with unprefixed code `SYSTEM_INTERNAL_ERROR`); `handleError` for delegated operations. Reports via `safeHandleError`.
* **Health Monitoring**: `checkHealth()` aggregates its state with `CoreRouter`'s health.
* **Metrics Tracking**: For lifecycle, errors, delegated operations, and now `routersystem.routes.refreshed`.
* **Factory Function**: `createRouterSystem(deps = {})`.

### 4.4. State Management (`RouterSystem` Specifics)
Includes `router: CoreRouter | null`, `_activeAdapterName: string | null`, `_activeFrameworkInstance: object | null`.

### 4.5. Lifecycle Management (`RouterSystem` Specifics)
* **`initialize()`**: Creates/inits `CoreRouter`, calls `_setupEventForwardingAndDynamicRefresh()`.
* **`shutdown()`**: Ensures `CoreRouter.shutdown()`, cleans up listeners, resets active adapter info.

### 4.6. Error Handling within `RouterSystem`
* **Internal Errors**: `_handleInternalError` for own issues.
* **Delegated Errors**: Catches errors from `this.router.*` calls, processes via `handleError`, re-throws.

### 4.7. Event Integration (`RouterSystem` Specifics - Forwarding)
`_setupEventForwardingAndDynamicRefresh()` listens to `CoreRouter` operational events and `router:routes:changed`. Re-emits operational events with a `system:` prefix and/or original name. Handles `router:routes:changed` to trigger adapter refresh.

### 4.8. Health Monitoring (`RouterSystem` Specifics)
Default checks:
* **`routersystem.state`**: Own status, uptime, errors.
* **`routersystem.corerouter`**: Calls `this.router.checkHealth()`.

### 4.9. Metrics Tracking (`RouterSystem` Specifics)
Records metrics for lifecycle, errors, high-level delegated operations, and `routersystem.routes.refreshed`.

### 4.10. Static Factory (`createRouterSystem`)
**`createRouterSystem(deps = {}): RouterSystem`**. Throws `RouterError` with unprefixed code `CREATION_FAILED` if factory fails.

---
## 5. Integrations (Routing System Level)
Integrates with:
* **`EventBusSystem` / `CoreEventBus`**: For route definition eventing.
* **HTTP Web Frameworks (e.g., Fastify)**: Via `IRouterAdapter` (which now supports `refreshRoutes`).
* **`ErrorSystem`**: All routing components report errors.
* **`ModuleSystem` & `CoreModule`**: Manages `RoutableModule`s.
* **`ContainerSystem`**: Manages `RouterSystem` and its dependencies.

---
## 6. Overall Routing Flow Diagram (Route Definition to Application)
**Routing System**: Overall Route Definition and Application Flow

```mermaid
graph TD
    subgraph ApplicationBootstrap [Application Bootstrap/Setup]
        direction TB
        AppSetup["App Setup Code"]
        HttpFrameworkInst["HTTP Framework Instance (e.g., Fastify)"]
    end

    subgraph RoutableModuleInstance [MyRoutableModule]
        direction TB
        RM_Define["Define Routes (this.registerRoute(...))"]
        RM_OnInit["onInitialize() calls this.registerAllRoutes()"]
        RM_Emit["_emitRouteRegistration()"]
    end

    subgraph EventSystem [EventBusSystem & CoreEventBus]
        direction TB
        EBSys["EventBusSystem"]
        CEBus["CoreEventBus"]
        EBSys -- Provides --> CEBus
    end

    subgraph RouterSystemFacade [RouterSystem Facade]
        direction TB
        RS["RouterSystem"]
        RS_State[("this.state (System)")]
        RS_ActiveAdapter[("Active Adapter Ref")]
    end
    
    subgraph CoreRouterEngine [CoreRouter Engine]
        direction TB
        CR["CoreRouter"]
        CR_State[("this.state (Router)")]
        CR_Routes[("Route Registry")]
        CR_Adapters[("Adapter Registry")]
        CR_Mw[("Middleware Registry")]
        CR_AppliedFlag[("_routesAppliedOnce")]
    end

    %% Initialization
    AppSetup -- Creates & Initializes --> RS;
    RS -- Creates & Initializes --> CR;
    CR -- Subscribes to 'router.route.register', etc. --> CEBus;
    
    %% Module Route Definition
    RM_OnInit --> RM_Emit;
    RM_Emit -- "Emits 'router.route.register' event" --> CEBus;
    
    %% CoreRouter Processes Event
    CEBus -- Delivers Event --> CR;
    CR -- "handleRouteRegistration(event)" --> CR_Routes;
    CR_Routes -- "Stores route" --> CR_Routes;
    CR -- "If running & applied, emits 'router:routes:changed'" --> RS; %% CoreRouter emits to RouterSystem

    %% RouterSystem Handles Change (Dynamic Update Path)
    RS -- "Receives 'router:routes:changed'" --> RS;
    RS -- "_handleCoreRoutesChanged()" --> RS_ActiveAdapter;
    RS_ActiveAdapter -- "Calls adapter.refreshRoutes(allRoutes)" --> AdapterInst["Specific Adapter (e.g., FastifyAdapter)"];
    AdapterInst -- "Updates its internal router" --> AdapterInternalRouter["Adapter's Internal Router"];

    %% Application Applies Routes (Initial or Manual Full Apply)
    AppSetup -- "1. routerSystem.registerAdapter('fwKey', AdapterClass)" --> RS;
    RS -- Delegates --> CR;
    CR -- "Stores adapter" --> CR_Adapters;
    
    AppSetup -- "2. routerSystem.applyRoutes(HttpFrameworkInst, 'fwKey')" --> RS;
    RS -- "Stores active adapter/fw" --> RS_ActiveAdapter;
    RS -- Delegates to --> CR;
    CR -- "applyRoutes(HttpFrameworkInst, 'fwKey')" --> AdapterInst;
    AdapterInst -- "Populates its internal router & configures HttpFrameworkInst gateway" --> HttpFrameworkInst;
    CR -- "Sets _routesAppliedOnce = true" --> CR_AppliedFlag;


    classDef system fill:#D6EAF8,stroke:#5DADE2,stroke-width:2px;
    classDef module fill:#E8F8F5,stroke:#76D7C4,stroke-width:2px;
    classDef bus fill:#FEF9E7,stroke:#F7DC6F,stroke-width:2px;
    classDef stateNode fill:#f9f,stroke:#333,stroke-width:2px;
    classDef process fill:#E9D8FD,stroke:#8E44AD,stroke-width:1px;


    class RS, CR, AdapterInst system;
    class RM_OnInit, RM_Define, RM_Emit module;
    class EBSys, CEBus bus;
    class RS_State, CR_State, CR_Routes, CR_Adapters, CR_Mw, CR_AppliedFlag, RS_ActiveAdapter stateNode;
    class AppSetup, HttpFrameworkInst, AdapterInternalRouter process;
```

(Diagram to also conceptually include path for `router:routes:changed` -> `RouterSystem` -> `Adapter.refreshRoutes`)

---
## 7. Usage Examples & Best Practices

### 7.1. Defining Routes in a `RoutableModule`
Modules extend `RoutableModule` and use `this.registerRoute()` typically in `onInitialize()`. Errors thrown (e.g., `RouterError` with unprefixed code `INVALID_METHOD`) use the new code strategy.

### 7.2. Registering a Framework Adapter (e.g., Fastify)
Register adapter with `RouterSystem`. The adapter should implement `IRouterAdapter` including `refreshRoutes`.
**RouterSystem**: Registering a Framework Adapter Example (Updated)
```javascript
// // In application bootstrap, after RouterSystem and ErrorSystem are initialized
// // Assuming 'container' is your initialized ContainerSystem instance
// // import { FastifyAdapter } from './core/router/integrations/fastify/FastifyAdapter.js'; // Path to your adapter
// // import { ErrorCodes } from './core/errors/ErrorCodes.js'; // For error checking, if needed
// // import { RouterError } from './core/errors/index.js'; // For error checking, if needed

// async function setupRouterAdapter(container) {
//   try {
//     const routerSystem = await container.resolve('routerSystem');
//     const logger = await container.resolve('logger'); // Assuming a logger is registered

//     // Create an instance of your adapter
//     // The FastifyAdapter constructor now accepts options like gatewayPrefix
//     const fastifyAdapter = new FastifyAdapter({ 
//         logger,
//         gatewayPrefix: '/api' // Example prefix for all routes handled by this adapter
//     });

//     // Register the adapter with RouterSystem
//     routerSystem.registerAdapter('fastifyHttp', fastifyAdapter); // Use a descriptive name
//     logger.info('[AppSetup] FastifyAdapter registered with RouterSystem as "fastifyHttp".');

//   } catch (error) {
//     // Handle error (e.g., RouterSystem not resolved, adapter registration failed)
//     // error.code will be the fully prefixed code, e.g., ROUTER_INVALID_ADAPTER
//     const errorSystem = await container.resolve('errorSystem');
//     await errorSystem.handleError(error, {
//       source: 'setupRouterAdapter',
//       message: `Failed to setup router adapter. Error code: ${error.code}`
//     });
//     throw error; // Or handle more gracefully
//   }
// }

// // setupRouterAdapter(container);
```

### 7.3. Registering and Using Middleware
Register named middleware with `RouterSystem` (delegates to `CoreRouter`). Apply by name in route options.
**RouterSystem**: Registering and Using Middleware Example (Updated)

```javascript
// // In application bootstrap or a dedicated middleware setup file
// // Assuming 'routerSystem' is an initialized RouterSystem instance from container
// // import { ErrorCodes } from './core/errors/ErrorCodes.js'; // For specific error codes
// // import { AuthError } from './core/errors/index.js';     // Example of a specific error type

// // 1. Define Middleware Handlers
// async function simpleLoggerMiddleware(request, reply) {
//   // Assuming logger is attached to request by Fastify or another middleware
//   request.log.info(`Request received for: ${request.method} ${request.url}`);
//   // For Fastify, calling done() is not needed for async handlers unless there's an error.
//   // If you pass an error to done(), Fastify handles it. Otherwise, just let the promise resolve.
// }

// async function authenticationMiddleware(request, reply) {
//   // const authService = await request.diContainer.resolve('authService'); // Example: DI per request
//   const token = request.headers['authorization']?.split(' ')[1];
//   let userIsValid = false; // Assume false

//   // if (token && authService) {
//   //   userIsValid = await authService.validateTokenAndGetUser(token);
//   //   if (userIsValid) request.user = userIsValid; // Attach user to request
//   // }
//   
//   if (!userIsValid) {
//     request.log.warn('Authentication failed: No token or invalid token.');
//     // Throwing a specific error that FastifyErrorHandler can map
//     // ErrorCodes.AUTH.UNAUTHORIZED is 'UNAUTHORIZED'
//     throw new AuthError( 
//         ErrorCodes.AUTH.UNAUTHORIZED, 
//         'Authentication required.'
//     ); // AuthError constructor will prefix to AUTH_UNAUTHORIZED
//     // The global FastifyErrorHandler (setup via ErrorSystem) will catch this and send 401
//   }
//   request.log.info('Authentication successful for middleware.');
// }

// // 2. Register Middleware with RouterSystem (delegates to CoreRouter)
// // routerSystem.registerMiddleware('requestLogger', simpleLoggerMiddleware, { order: 10 });
// // routerSystem.registerMiddleware('authRequired', authenticationMiddleware, {
// //   order: 100,
// //   // paths: ['/api/v1/secure/*'] // Example: apply only to paths under /api/v1/secure/
// // });

// // 3. Applying Middleware in a RoutableModule
// // Inside a RoutableModule (e.g., SecureDataModule.js onInitialize method):
// // this.registerRoute('GET', '/secure/data', this.handleGetSecureData, {
// //   summary: 'Get secure data, auth required',
// //   middleware: ['requestLogger', 'authRequired'] // Names of registered middleware
// // });
// //
// // this.registerRoute('GET', '/public/data', this.handleGetPublicData, {
// //   summary: 'Get public data',
// //   middleware: ['requestLogger'] // Only logger for this one
// // });
```

### 7.4. Applying Routes to a Web Framework
Call `routerSystem.applyRoutes(frameworkInstance, adapterName)` during bootstrap.
**RouterSystem**: Applying Routes to Fastify Example (Updated)

```javascript
// // In application bootstrap, after RouterSystem is initialized,
// // modules have emitted their routes, and an adapter is registered.
// // Assuming 'container' is your initialized ContainerSystem instance
// // import Fastify from 'fastify';
// // import { FastifyAdapter } from './core/router/integrations/fastify/FastifyAdapter.js';
// // import { ErrorCodes } from './core/errors/ErrorCodes.js';
// // import { RouterError } from './core/errors/index.js';

// async function startHttpServer(container) {
//   try {
//     const routerSystem = await container.resolve('routerSystem');
//     const appConfig = await container.resolve('appConfig'); // Assuming config component
//     const logger = await container.resolve('logger');
//     const errorSystem = await container.resolve('errorSystem'); // For Fastify error handler setup

//     const fastifyApp = Fastify({
//       logger: logger, // Use your application's logger instance if compatible
//       requestIdHeader: 'x-request-id',
//       // Consider adding a custom child logger for requests with request IDs
//     });

//     // Ensure ErrorSystem's FastifyErrorHandler is set up for this fastifyApp instance
//     // This should have happened when ErrorSystem was initialized and registerIntegration was called.
//     // Example conceptual check (actual check might differ):
//     // if (!errorSystem.integrations.has('fastifyMain')) { // Assuming it was registered with this name
//     //    logger.warn('[AppSetup] FastifyErrorHandler integration not registered with ErrorSystem. Global errors might not be handled consistently.');
//     //    // Potentially register it here if not done, or throw error
//     // }

//     // Ensure router adapter is registered with RouterSystem
//     // This would typically be done before calling applyRoutes if not already.
//     if (!routerSystem.getRouter().adapters.has('fastifyHttp')) {
//       routerSystem.registerAdapter('fastifyHttp', new FastifyAdapter({ logger, gatewayPrefix: '/api' }));
//       logger.info('[AppSetup] FastifyAdapter registered on-the-fly.');
//     }

//     // Apply all routes known to CoreRouter (via RouterSystem) to the Fastify instance
//     // This will now use the FastifyAdapter's logic which sets up a gateway and internal router.
//     await routerSystem.applyRoutes(fastifyApp, 'fastifyHttp');
//     logger.info('[AppSetup] All TSMIS routes applied to Fastify via adapter gateway.');

//     await fastifyApp.listen({ port: appConfig.port || 3000, host: '0.0.0.0' });
//     // Fastify automatically logs listening address if logger is enabled

//   } catch (error) {
//     console.error('[AppSetup] CRITICAL: Failed to start HTTP server or apply routes:', error);
//     // error.code will be the fully prefixed code, e.g., ROUTER_ADAPTER_NOT_FOUND
//     // Example error checking:
//     // if (error.code === `ROUTER_${ErrorCodes.ROUTER.ADAPTER_NOT_FOUND}`) {
//     //   console.error("The 'fastifyHttp' adapter was not found!");
//     // }
//     // const errorSystemInstance = container.instances?.get('errorSystem'); // Be careful with direct instance access
//     // if (errorSystemInstance) {
//     //   await errorSystemInstance.handleError(error, { source: 'startHttpServer', criticality: 'high' });
//     // }
//     process.exit(1);
//   }
// }
// // startHttpServer(container);
```

### 7.5. Triggering Dynamic Route Updates (Development)
This section is new and describes the high-level process:
1.  **File Changes**: Developer modifies route definitions in a `RoutableModule` file.
2.  **File Watcher (External Tool)**: A development tool (e.g., Nodemon with script execution, custom `chokidar` watcher) detects the change.
3.  **Re-registration Trigger**: The watcher script interacts with the running TSMIS application to:
    * Get the specific `RoutableModule` instance (e.g., via `moduleSystem.resolve()`).
    * Call methods on the module to unregister its old routes and register the new/modified ones (e.g., a new `moduleInstance.reloadRoutes()` method or separate calls to `unregisterRoute` and `registerRoute`).
4.  **Core System Reaction**:
    * The module's calls to `registerRoute`/`unregisterRoute` update `CoreRouter`'s internal route list.
    * `CoreRouter` emits `router:routes:changed`.
    * `RouterSystem` receives this event and calls `activeAdapter.refreshRoutes()` with the complete new list of routes from `CoreRouter`.
    * The adapter (e.g., `FastifyAdapter`) updates its internal routing mechanism, making the changes live without an application restart.
*This mechanism provides a development-time convenience. Production route changes usually follow a more controlled deployment process.*

### 7.6. Generating OpenAPI Documentation
Call `routerSystem.generateOpenApiDoc(info)`.
**RouterSystem**: Generating OpenAPI Documentation Example (Updated)

```javascript
// // Assuming 'routerSystem' is an initialized RouterSystem instance
// // Assuming 'appConfig' holds application metadata

// async function generateAndServeOpenApiSpec(routerSystem, appConfig) {
//   try {
//     const openApiDocument = routerSystem.generateOpenApiDoc({
//       title: appConfig.appName || 'TSMIS API',
//       version: appConfig.appVersion || '1.0.0', // Assuming appConfig has appVersion
//       description: 'API documentation for the TSMIS application.',
//       components: {
//         schemas: {
//           // ExampleError: {
//           //   type: 'object',
//           //   properties: {
//           //     code: { type: 'string', example: 'VALIDATION_INVALID_INPUT' },
//           //     message: { type: 'string' },
//           //     details: { type: 'object', additionalProperties: true }
//           //   }
//           // }
//         }
//       }
//     });
//     // 1. Save to a file (example)
//     // import fs from 'fs/promises';
//     // await fs.writeFile('openapi.json', JSON.stringify(openApiDocument, null, 2));
//     // console.log('OpenAPI specification written to openapi.json');
//     // 2. Or serve via an API endpoint
//     return openApiDocument;

//   } catch (error) {
//     console.error('Failed to generate OpenAPI document:', error);
//     // Example: error.code would be prefixed if it's a RouterError
//     // await routerSystem.handleError(error, { operation: 'generateOpenApiDoc' });
//     return null;
//   }
// }
```

**Best Practices:**
* Decouple route definition in modules.
* Use `static dependencies` for handlers.
* Clear route paths/methods.
* Use schema validation via route options.
* Leverage middleware for cross-cutting concerns.
* For development, integrate a file watcher to trigger route re-registration for dynamic updates.

---
## 8. Testing Strategy Notes
* **`RoutableModule`**: Test route definition and event emission.
* **`CoreRouter`**: Test route registration/conflict, adapter/middleware management, event handling. Test new `router:routes:changed` emission. Test `applyRoutes` and `generateOpenApiDoc`.
* **`RouterSystem`**: Test `CoreRouter` lifecycle management. Test delegated methods. Test new logic for listening to `router:routes:changed` and calling `adapter.refreshRoutes` (with a mock adapter).
* **Adapters (e.g., `FastifyAdapter`)**: Test `applyRoutes` and the new `refreshRoutes` method thoroughly with a mock framework and route sets to ensure the internal router is updated and the gateway functions correctly.

---
## 9. Future Considerations & Potential Enhancements
(Original points are still valid.)
* **Advanced Route Matching**.
* **More Granular Dynamic Updates**: Beyond full refresh, explore adding/removing single routes from live adapters if framework and adapter design permit efficiently. (The current `refreshRoutes` takes the full list, which is simpler to implement robustly).
* **Enhanced Request/Response Validation**.
* **Performance Optimizations** for large route sets.
* **More Granular Middleware Control**.
* **Additional Framework Adapters**.