# TSMIS Routing System Documentation
Version: 2.0.0 (Refactored Core)

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
        * [3.2.6. OpenAPI Documentation Generation (`generateOpenApiDoc`)](#326-openapi-documentation-generation-generateopenapidoc)
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
    * [7.5. Generating OpenAPI Documentation](#75-generating-openapi-documentation)
8.  [Testing Strategy Notes](#8-testing-strategy-notes)
9.  [Future Considerations & Potential Enhancements](#9-future-considerations--potential-enhancements)

---

## 1. Introduction to the Routing System

### 1.1. Purpose & Philosophy
The TSMIS Routing System provides a structured, flexible, and framework-agnostic way to define, manage, and serve HTTP routes. Its core philosophy is to decouple the definition of API endpoints (which reside within business modules) from the underlying HTTP web framework (e.g., Fastify) used to serve them. This promotes modularity, testability, and the ability to potentially switch or use multiple web frameworks with minimal changes to business logic.

Key goals include:
* **Framework Agnosticism**: Modules define routes without direct ties to a specific web server's API.
* **Centralized Route Management**: `CoreRouter` acts as a single registry for all application routes.
* **Event-Driven Route Registration**: `RoutableModule`s announce their routes via events, which `CoreRouter` subscribes to.
* **Pluggable Adapters**: `IRouterAdapter` implementations bridge `CoreRouter` to specific web frameworks.
* **Middleware Support**: A consistent way to define and apply middleware to routes.
* **API Documentation**: Automated generation of OpenAPI (Swagger) specifications from route definitions.
* **Standardization**: Adherence to core TSMIS patterns for lifecycle, errors, health, and metrics.

### 1.2. Key Components & Their Roles
* **`RoutableModule.js`**: An extension of `CoreModule` that business modules inherit from if they need to define HTTP routes. It provides `registerRoute()` and `registerVersionedRoute()` methods and emits events for route registration/unregistration during its lifecycle.
* **`CoreRouter.js`**: The engine of the routing system. It listens for route definition events from `RoutableModule`s via the `CoreEventBus`, maintains an internal registry of all routes, checks for conflicts, manages framework adapters (implementations of `IRouterAdapter`), and handles middleware logic. It's responsible for applying these routes to a web framework instance through a chosen adapter and can generate OpenAPI documentation.
* **`RouterSystem.js`**: The high-level facade that manages the `CoreRouter` instance. It handles the lifecycle of `CoreRouter`, provides a simplified API for common tasks like registering adapters and applying routes, and integrates the routing subsystem into the application's standard monitoring and lifecycle frameworks. Application bootstrap code typically interacts with `RouterSystem`.
* **`IRouterAdapter.js`**: An interface defining the contract for framework-specific adapters (e.g., `FastifyAdapter.js`). Adapters are responsible for translating the standardized route definitions from `CoreRouter` into the specific API calls required by a web framework.
* **`FastifyAdapter.js`** (Example Integration): A concrete implementation of `IRouterAdapter` for the Fastify web framework.

## 2. Component: `RoutableModule.js` - Defining Routes in Modules

**(This section provides a summary. Full details are in the standalone `RoutableModule-docs.md`.)**

### 2.1. Overview & Purpose
`RoutableModule` extends `CoreModule` to empower business modules with the ability to define their own HTTP API routes. It provides a standardized API for route definition and integrates this process with the module's lifecycle, emitting events that the `CoreRouter` listens to. This decouples route definition from the central routing mechanism and the specific web framework being used.

### 2.2. Key API for Route Definition
* **`registerRoute(method: string, path: string, handler: Function, options = {}): RoutableModule`**: Allows modules to define a route by specifying the HTTP method, path, handler function (a method of the module), and optional parameters (e.g., schema for validation, middleware names, tags for OpenAPI).
* **`registerVersionedRoute(version: string | number, method: string, path: string, handler: Function, options = {}): RoutableModule`**: A convenience method for creating routes prefixed with a standard API version string (e.g., `/api/v1`).

### 2.3. Lifecycle Integration for Route Registration/Unregistration
* **`async onInitialize()`**: Overridden from `CoreModule`. After calling `super.onInitialize()`, it typically calls an internal `registerAllRoutes()` method which iterates through all routes defined via `registerRoute` (often defined within `onInitialize` itself before the super call) and emits `router.route.register` events for each one.
* **`async onShutdown()`**: Overridden from `CoreModule`. Before calling `super.onShutdown()`, it emits a `router.module.unregister` event with its `moduleId`. This signals `CoreRouter` to remove all routes previously registered by this module.

### 2.4. Event Emission for Routes
* **`router.route.register`**: Emitted for each route defined. Payload includes `moduleId`, `method`, `path`, `handler` (reference), and `options`.
* **`router.route.unregister`**: Emitted by `RoutableModule.unregisterRoute()` (if called manually). Payload: `{ moduleId, method, path }`.
* **`router.module.unregister`**: Emitted during `onShutdown`. Payload: `{ moduleId }`.
These events are broadcast via the `CoreEventBus` (accessed through `this.eventBus`).

## 3. Component: `CoreRouter.js` - The Routing Engine

**(This section provides a summary. Full details are in the standalone `CoreRouter-docs.md`.)**

### 3.1. Overview & Primary Responsibility
`CoreRouter` is the central processing unit for routing. It maintains a definitive registry of all application routes, manages different framework adapters, applies middleware, detects route conflicts, and can generate API documentation. It operates by subscribing to route definition events emitted by `RoutableModule`s.

### 3.2. Key Functionalities & API (`CoreRouter`)

#### 3.2.1. Event-Driven Route Management
During its `initialize()` phase, `CoreRouter` subscribes to events on the `CoreEventBus`:
* `router.route.register`: Handled by `handleRouteRegistration` to add a new route to its internal registry.
* `router.route.unregister`: Handled by `handleRouteUnregistration` to remove a specific route.
* `router.routes.clear`: Handled by `handleRoutesClear` to remove all routes.
* `router.module.unregister`: Handled by `handleModuleUnregister` to remove all routes associated with a specific module.

#### 3.2.2. Route Registry & Conflict Detection
* Routes are stored internally, typically in a `Map` keyed by `METHOD:path`.
* When `registerRoute(moduleId, method, path, handler, options)` is called (usually by an event handler), it checks for conflicts (same method and path). If a conflict exists, it throws a `RouterError`.

#### 3.2.3. Adapter Management (`registerAdapter`, `IRouterAdapter`)
* `registerAdapter(name: string, adapter: IRouterAdapter): CoreRouter`: Allows registration of framework-specific adapters (e.g., `FastifyAdapter`).
* `IRouterAdapter`: An interface that adapters must implement, primarily defining an `async applyRoutes(framework, routes)` method.

#### 3.2.4. Middleware Management (`registerMiddleware`, `getMiddlewareForRoute`)
* `registerMiddleware(name: string, handler: Function, options = {}): CoreRouter`: Registers named middleware functions with options for execution order and applicability (paths/methods).
* `getMiddlewareForRoute(route: object): Array<object>`: For a given route definition, this method resolves all applicable global and route-specific middleware (specified in `route.options.middleware`) and sorts them by their defined order. The output contains the actual middleware handler functions.

#### 3.2.5. Applying Routes (`applyRoutes`)
* `async applyRoutes(framework: object, adapterName: string): Promise<object>`: This crucial method retrieves the specified adapter and calls its `applyRoutes` method, passing the web framework instance and all registered routes. Each route object passed to the adapter includes its `resolvedMiddleware` (an array of handler functions) determined by `getMiddlewareForRoute`.

#### 3.2.6. OpenAPI Documentation Generation (`generateOpenApiDoc`)
* `generateOpenApiDoc(info = {}): object`: Constructs an OpenAPI 3.0 specification object from the current route registry, using route paths, methods, and metadata provided in `route.options` (like `summary`, `description`, `tags`, `schema`, `auth`).

### 3.3. State Management (`CoreRouter` Specifics)
Adheres to standard `this.state`. Manages internal Maps for:
* `this.routes: Map<string, object>` (route definitions).
* `this.adapters: Map<string, IRouterAdapter>` (registered framework adapters).
* `this.middleware: Map<string, object>` (registered named middleware).
* `this.subscriptions: Array<string>` (IDs for `CoreEventBus` subscriptions).

### 3.4. Lifecycle Management (`CoreRouter` Specifics)
* **`initialize()`**: Subscribes to route management events on `CoreEventBus`. Emits standard lifecycle events.
* **`shutdown()`**: Unsubscribes from all `CoreEventBus` events, clears internal registries (routes, adapters, middleware). Emits standard lifecycle events.

### 3.5. Error Handling within `CoreRouter`
* Uses `_handleInternalError` for operational errors (e.g., issues in event handlers), logging to `this.state.errors` and reporting via `safeHandleError`.
* Throws `RouterError` for API misuse or critical failures (e.g., route conflict, adapter not found, initialization failure), using codes from `ErrorCodes.ROUTER`.

### 3.6. Event Integration (`CoreRouter` Specifics)
* **Subscribes to**: `router.route.register`, `router.route.unregister`, `router.routes.clear`, `router.module.unregister` from `CoreEventBus`.
* **Emits (Operational Events via `super.emit`)**: `route:registered`, `route:unregistered`, `routes:cleared`, `adapter:registered`, `middleware:registered`, `routes:applied` to signal its own operational state changes. These are distinct from events on `CoreEventBus`.

### 3.7. Health Monitoring (`CoreRouter` Specifics)
Provides `checkHealth()`. Default checks:
* `corerouter.state`: Its lifecycle `status`, uptime, internal error count.
* `corerouter.routes`: Count of registered routes, often broken down by method.
* `corerouter.adapters`: Count of registered adapters and their names.
* `corerouter.middleware`: Count of registered named middleware and their names.

### 3.8. Metrics Tracking (`CoreRouter` Specifics)
Records metrics for lifecycle, internal errors, routes registered/unregistered/cleared/applied, and adapter/middleware registrations.

## 4. Component: `RouterSystem.js` - The Managing Facade

**(This section details the `RouterSystem` class. Full individual documentation would be in `router-system-docs.md`.)**

### 4.1. Overview & Primary Responsibility
`RouterSystem` serves as the high-level entry point and managing facade for the application's routing capabilities. It simplifies interaction with the routing subsystem by orchestrating the `CoreRouter` instance, handling its lifecycle, and ensuring the routing functionality is integrated with the application's standard error handling, health monitoring, and metrics systems.

### 4.2. Key Functionalities & API (`RouterSystem`)

#### 4.2.1. `initialize()` & `shutdown()`
* **`async initialize(): Promise<RouterSystem>`**: Creates and initializes its internal `CoreRouter` instance. It then sets up event forwarding to re-emit or translate events from `CoreRouter` for system-level observation.
* **`async shutdown(): Promise<void>`**: Manages the shutdown of its `CoreRouter` instance and cleans up its own resources.

#### 4.2.2. `getRouter(): CoreRouter`
Provides access to the managed `CoreRouter` instance. This is generally used if direct interaction with `CoreRouter` features not exposed by `RouterSystem` is needed, or for introspection.

#### 4.2.3. Delegated `CoreRouter` Methods
`RouterSystem` exposes most of `CoreRouter`'s public API as its own methods. When these methods are called on `RouterSystem`, it typically:
1.  Validates its own state (e.g., ensuring it's initialized).
2.  Delegates the actual operation to the corresponding method on its `this.router` (CoreRouter) instance.
3.  Records `RouterSystem`-level metrics for the operation.
4.  Catches any `RouterError` (or other errors) thrown by `CoreRouter`, processes it using `this.handleError()` (which reports to the global `ErrorSystem` and logs to `RouterSystem`'s state), and then re-throws the original error.
Examples: `registerAdapter`, `registerMiddleware`, `applyRoutes`, `getRoutes`, `generateOpenApiDoc`, etc..

### 4.3. Adherence to Standardization Pillars (Recap for `RouterSystem`)
* **State Management**: Implements standard `this.state`. Holds the `router` (CoreRouter instance).
* **Lifecycle Management**: Manages its own lifecycle and that of `CoreRouter`. Emits standard `LIFECYCLE_EVENTS`.
* **Error Handling**: Uses `_handleInternalError` for its own errors. Uses a public `handleError` for processing errors from delegated `CoreRouter` operations, reporting via `safeHandleError`. Throws `RouterError`.
* **Health Monitoring**: `checkHealth()` aggregates its own state with `CoreRouter`'s health (via `routersystem.corerouter` check).
* **Metrics Tracking**: Records metrics for its lifecycle, internal errors, and for high-level delegated operations.
* **Factory Function**: `createRouterSystem(deps = {})` is provided.

### 4.4. State Management (`RouterSystem` Specifics)
(Covered by 4.3 - Standard `this.state` plus the `router: CoreRouter | null` instance property).

### 4.5. Lifecycle Management (`RouterSystem` Specifics)
* **`initialize()`**: Creates and initializes `CoreRouter`. Calls `_setupEventForwarding()`.
* **`shutdown()`**: Ensures `CoreRouter.shutdown()` is called. Clears its own state.

### 4.6. Error Handling within `RouterSystem`
* **Internal Errors**: `_handleInternalError` for its own operational issues (e.g., failure to create `CoreRouter`).
* **Delegated Errors**: Catches errors from `this.router.*` calls, processes them via its public `handleError` (which logs, records metrics, reports to global `ErrorSystem`, emits `system:error`), and re-throws.

### 4.7. Event Integration (`RouterSystem` Specifics - Forwarding)
`_setupEventForwarding()` listens to operational events emitted by its managed `CoreRouter` instance (e.g., `route:registered`, `adapter:registered`). `RouterSystem` then typically re-emits these events:
1.  As a system-level event with a prefix (e.g., `system:route:registered`).
2.  With the original event name (e.g., `route:registered`).
This allows other systems to listen for routing activities at either the specific `CoreRouter` level (if they have a direct reference, though less common) or at the `RouterSystem` facade level. `CoreRouter`'s own `router:error` events are also caught, processed, and re-emitted as `system:error`.

### 4.8. Health Monitoring (`RouterSystem` Specifics)
Default health checks:
* **`routersystem.state`**: Its own lifecycle `status`, uptime, internal error count.
* **`routersystem.corerouter`**: Calls `this.router.checkHealth()` and includes the full, standardized health report from `CoreRouter`.

### 4.9. Metrics Tracking (`RouterSystem` Specifics)
Records metrics for:
* Its own lifecycle: `routersystem.initialized.success/failure`, `routersystem.shutdown.success/failure`.
* Its internal errors: `routersystem.errors.internal`.
* Operational errors from `CoreRouter` (handled by `handleError`): `routersystem.errors.operational`.
* High-level delegated operations: e.g., `routersystem.routes.applied` (tags: `adapterName`, `count`).

### 4.10. Static Factory (`createRouterSystem`)
**`createRouterSystem(deps = {}): RouterSystem`** for standardized instantiation.

## 5. Integrations (Routing System Level)

The overall Routing System (`RouterSystem` managing `CoreRouter`, which processes definitions from `RoutableModule`s) integrates with:

* **`EventBusSystem` / `CoreEventBus`**: This is the backbone for `RoutableModule`s to announce their route definitions and for `CoreRouter` to subscribe to these announcements.
* **HTTP Web Frameworks (e.g., Fastify)**: `CoreRouter` uses `IRouterAdapter` implementations (like `FastifyAdapter`) to translate its internal route registry into framework-specific route configurations. This is typically triggered by an application bootstrap process calling `RouterSystem.applyRoutes()`.
* **`ErrorSystem`**: All components (`RouterSystem`, `CoreRouter`, `RoutableModule`) use the `ErrorSystem` for centralized reporting of their operational errors. `RouterSystem`'s framework integrations (for errors, like `FastifyErrorHandler`) also play a role in how routing errors are ultimately presented in HTTP responses.
* **`ModuleSystem` & `CoreModule`**: `RoutableModule` is a specialized `CoreModule` managed by `ModuleSystem`. The lifecycle of `RoutableModule`s (and thus when they emit route definition events) is controlled by `ModuleSystem`.
* **`ContainerSystem`**: `RouterSystem` (and its dependency `CoreRouter`) is typically registered with and resolved from the `ContainerSystem`. The container injects necessary dependencies like `ErrorSystem`, `EventBusSystem`, and `config` into `RouterSystem`. Modules that `RoutableModule`s might depend on for their route handlers are also resolved by the `ContainerSystem`.

## 6. Overall Routing Flow Diagram (Route Definition to Application)

**Routing System**: Overall Route Definition and Application Flow

```mermaid
graph TD
    subgraph ApplicationBootstrap [Application Bootstrap/Setup]
        direction TB
        AppSetup["App Setup Code"]
        FastifyInst["Fastify Instance"]
    end

    subgraph RoutableModuleInstance [MyRoutableModule (extends RoutableModule)]
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
    end
    
    subgraph CoreRouterEngine [CoreRouter Engine]
        direction TB
        CR["CoreRouter"]
        CR_State[("this.state (Router)")]
        CR_Routes[("Route Registry")]
        CR_Adapters[("Adapter Registry")]
        CR_Middleware[("Middleware Registry")]
    end

    %% Initialization and Event Subscription
    AppSetup -- Creates & Initializes --> RS;
    RS -- Creates & Initializes --> CR;
    CR -- Subscribes to 'router.route.register' --> CEBus;

    %% Module Route Definition & Emission
    RM_OnInit --> RM_Emit;
    RM_Emit -- "Emits 'router.route.register' event with route definition" --> CEBus;
    
    %% CoreRouter Processes Event
    CEBus -- Delivers Event --> CR;
    CR -- "handleRouteRegistration(event)" --> CR_Routes;
    CR_Routes -- "Stores route definition" --> CR_Routes;

    %% Application Applies Routes
    AppSetup -- "1. routerSystem.registerAdapter('fastify', FastifyAdapter)" --> RS;
    RS -- Delegates --> CR;
    CR -- "Stores adapter" --> CR_Adapters;
    
    AppSetup -- "2. routerSystem.applyRoutes(FastifyInst, 'fastify')" --> RS;
    RS -- Delegates to --> CR;
    CR -- "applyRoutes(FastifyInst, 'fastify')" --> FastifyAdapterInst["FastifyAdapter Instance (from CR_Adapters)"];
    FastifyAdapterInst -- "Uses Fastify API to define routes" --> FastifyInst;

    classDef system fill:#D6EAF8,stroke:#5DADE2,stroke-width:2px;
    classDef module fill:#E8F8F5,stroke:#76D7C4,stroke-width:2px;
    classDef bus fill:#FEF9E7,stroke:#F7DC6F,stroke-width:2px;
    classDef stateNode fill:#f9f,stroke:#333,stroke-width:2px;

    class RS, CR system;
    class RM_OnInit, RM_Define, RM_Emit module;
    class EBSys, CEBus bus;
    class RS_State, CR_State, CR_Routes, CR_Adapters, CR_Middleware stateNode;
```

## 7. Usage Examples & Best Practices

### 7.1. Defining Routes in a `RoutableModule`
(Refer to Section 7.3.7 "InventoryModule.js (Main Module Class)" in the "Developing Business Modules" part of the main "Source of Truth" document for a detailed example.)
Key aspects:
* Extend `RoutableModule`.
* Call `this.registerRoute()` or `this.registerVersionedRoute()` within `onInitialize()` (typically before `super.onInitialize()` if relying on `registerAllRoutes` from `RoutableModule`'s base `onInitialize`).
* Implement handler methods as async methods of the module class.

### 7.2. Registering a Framework Adapter (e.g., Fastify)
(Typically done during application bootstrap)

**RouterSystem**: Registering a Framework Adapter

```javascript
// // In application bootstrap, after RouterSystem and ErrorSystem are initialized
// // Assuming 'container' is your initialized ContainerSystem instance
// // import { FastifyAdapter } from './core/router/integrations/fastify/FastifyAdapter.js';
// // import { ErrorCodes } from './core/errors/ErrorCodes.js';

// async function setupRouterAdapter(container) {
//   try {
//     const routerSystem = await container.resolve('routerSystem');
//     const logger = await container.resolve('logger'); // Assuming a logger is registered

//     // Create an instance of your adapter
//     const fastifyAdapter = new FastifyAdapter({ logger });

//     // Register the adapter with RouterSystem
//     routerSystem.registerAdapter('fastifyHttp', fastifyAdapter); // Use a descriptive name

//     logger.info('[AppSetup] FastifyAdapter registered with RouterSystem as "fastifyHttp".');
//   } catch (error) {
//     // Handle error (e.g., RouterSystem not resolved, adapter registration failed)
//     const errorSystem = await container.resolve('errorSystem');
//     await errorSystem.handleError(error, {
//       source: 'setupRouterAdapter',
//       message: 'Failed to setup router adapter.'
//     });
//     throw error; // Or handle more gracefully depending on bootstrap strategy
//   }
// }

// // setupRouterAdapter(container);
```

### 7.3. Registering and Using Middleware

**RouterSystem**: Registering and Using Middleware Example

```javascript
// // In application bootstrap or a dedicated middleware setup file
// // Assuming 'routerSystem' is an initialized RouterSystem instance
// // Assuming 'AuthService' is an authentication service that might be used by middleware

// // 1. Define Middleware Handlers
// async function simpleLoggerMiddleware(request, reply) {
//   request.log.info(`Request received for: ${request.method} ${request.url}`);
//   // 'done' is not typically used in Fastify async middleware, just proceed or reply/error
// }

// async function authenticationMiddleware(request, reply) {
//   // const authService = await container.resolve('authService'); // If AuthService is needed
//   const token = request.headers['authorization']?.split(' ')[1];
//   if (!token /* || !authService.isValid(token) */) {
//     request.log.warn('Authentication failed: No token or invalid token.');
//     reply.code(401).send({ message: 'Unauthorized' });
//     return reply; // Important: Signal Fastify that the request is handled and no further processing.
//   }
//   // request.user = authService.decodeToken(token); // Attach user to request
//   request.log.info('Authentication successful.');
// }

// // 2. Register Middleware with RouterSystem (via CoreRouter)
// // routerSystem.registerMiddleware('requestLogger', simpleLoggerMiddleware, { order: 10 });
// // routerSystem.registerMiddleware('authRequired', authenticationMiddleware, {
// //   order: 100,
// //   // This middleware could be applied globally or selectively via route options
// //   // paths: ['/api/v1/secure/*'] // Example: apply only to paths under /api/v1/secure/
// // });

// // 3. Applying Middleware in a RoutableModule
// // Inside a RoutableModule (e.g., SecureDataModule.js onInitialize method):
// // this.registerRoute('GET', '/secure/data', this.handleGetSecureData, {
// //   middleware: ['requestLogger', 'authRequired'] // Names of registered middleware
// // });
// //
// // this.registerRoute('GET', '/public/data', this.handleGetPublicData, {
// //   middleware: ['requestLogger'] // Only logger for this one
// // });
```

### 7.4. Applying Routes to a Web Framework
(Typically done during application bootstrap, after modules are initialized and an adapter is registered)

**RouterSystem**: Applying Routes to Fastify Example

```javascript
// // In application bootstrap, after RouterSystem is initialized,
// // modules have emitted their routes, and an adapter is registered.
// // Assuming 'container' is your initialized ContainerSystem instance
// // import Fastify from 'fastify';

// async function startHttpServer(container) {
//   try {
//     const routerSystem = await container.resolve('routerSystem');
//     const appConfig = await container.resolve('appConfig'); // Assuming config component
//     const logger = await container.resolve('logger');

//     const fastifyApp = Fastify({
//       logger: logger, // Use your application's logger instance if compatible
//       requestIdHeader: 'x-request-id',
//     });

//     // Ensure adapter is registered (example, might be done earlier)
//     // if (!routerSystem.getRouter().adapters.has('fastifyHttp')) {
//     //   routerSystem.registerAdapter('fastifyHttp', new FastifyAdapter({ logger }));
//     // }

//     // Apply all routes known to CoreRouter (via RouterSystem) to the Fastify instance
//     await routerSystem.applyRoutes(fastifyApp, 'fastifyHttp');
//     logger.info('[AppSetup] All routes applied to Fastify.');

//     // Setup global error handler for Fastify using ErrorSystem's integration
//     // (This part requires ErrorSystem and its FastifyErrorHandler to be set up with fastifyApp)
//     // const errorSystem = await container.resolve('errorSystem');
//     // const fastifyErrorHandlerInstance = errorSystem.integrations.get('fastifyMain'); // if named 'fastifyMain'
//     // if (fastifyErrorHandlerInstance && fastifyErrorHandlerInstance.initialized) {
//     //   logger.info('[AppSetup] Fastify global error handler is configured via ErrorSystem integration.');
//     // } else {
//     //   logger.warn('[AppSetup] FastifyErrorHandler integration not found or not initialized. Global errors might not be handled consistently.');
//     // }


//     await fastifyApp.listen({ port: appConfig.port || 3000, host: '0.0.0.0' });
//     // Fastify automatically logs listening address if logger is enabled

//   } catch (error) {
//     console.error('[AppSetup] CRITICAL: Failed to start HTTP server or apply routes:', error);
//     // Use global error system if possible, otherwise console
//     // const errorSystem = container.instances.get('errorSystem'); // Be careful with direct instance access
//     // if (errorSystem) {
//     //   await errorSystem.handleError(error, { source: 'startHttpServer', criticality: 'high' });
//     // }
//     process.exit(1);
//   }
// }

// // startHttpServer(container);
```

### 7.5. Generating OpenAPI Documentation

**RouterSystem**: Generating OpenAPI Documentation Example

```javascript
// // Assuming 'routerSystem' is an initialized RouterSystem instance
// // Assuming 'appConfig' holds application metadata

// async function generateAndServeOpenApiSpec(routerSystem, appConfig) {
//   try {
//     const openApiDocument = routerSystem.generateOpenApiDoc({
//       title: appConfig.appName || 'TSMIS API',
//       version: appConfig.version || '1.0.0',
//       description: 'API documentation for the TSMIS application.',
//       // You can add more info here, like contact, license, servers
//       // And also shared components.schemas if you have common data models
//       components: {
//         schemas: {
//           // ExampleError: {
//           //   type: 'object',
//           //   properties: {
//           //     code: { type: 'string' },
//           //     message: { type: 'string' },
//           //     details: { type: 'object', additionalProperties: true }
//           //   }
//           // }
//         }
//       }
//     });

//     // Now you can do something with this document:
//     // 1. Save it to a file
//     // import fs from 'fs/promises';
//     // await fs.writeFile('openapi.json', JSON.stringify(openApiDocument, null, 2));
//     // console.log('OpenAPI specification written to openapi.json');

//     // 2. Serve it via an API endpoint (e.g., using a RoutableModule itself)
//     // (This would typically be part of a 'DocsModule' or similar)
//     // For example, a route '/docs/openapi.json' could return this object.

//     return openApiDocument;

//   } catch (error) {
//     console.error('Failed to generate OpenAPI document:', error);
//     // await routerSystem.handleError(error, { operation: 'generateOpenApiDoc' }); // If error needs central reporting
//     // Or handle locally
//     return null;
//   }
// }

// // Example usage:
// // generateAndServeOpenApiSpec(routerSystemInstance, appConfigInstance)
// //   .then(doc => {
// //     if (doc) { /* Do something with the doc */ }
// //   });
```

**Best Practices:**
* **Decouple Route Definition**: Modules define routes via `RoutableModule`; `RouterSystem` orchestrates their application.
* **Use `static dependencies`**: For route handlers in modules that need other services.
* **Clear Route Paths & Methods**: Follow RESTful principles or clear conventions.
* **Schema Validation**: Use the `options.schema` in `registerRoute` for request/response validation when using frameworks like Fastify.
* **Middleware for Cross-Cutting Concerns**: Use `CoreRouter`'s middleware for auth, logging, etc., applied globally or per route.

## 8. Testing Strategy Notes
* **`RoutableModule`**: Test route definition logic (are correct events emitted in `onInitialize`?), test route handler logic by mocking request/reply and services.
* **`CoreRouter`**: Test route registration (including conflicts), adapter registration, middleware registration and resolution (`getMiddlewareForRoute`), event handling (simulating `CoreEventBus` events), `applyRoutes` (with a mock adapter), and `generateOpenApiDoc`. Test its lifecycle, health, and metrics.
* **`RouterSystem`**: Test its management of `CoreRouter`'s lifecycle. For delegated methods, mock `CoreRouter` and verify calls are passed through correctly, and that `RouterSystem` adds its own error handling/metrics. Test event forwarding from `CoreRouter`. Test its lifecycle, health, and metrics.
* **Adapters (e.g., `FastifyAdapter`)**: Test the `applyRoutes` method with a mock framework instance and a set of sample routes (including middleware) to ensure the framework's API is called correctly.

## 9. Future Considerations & Potential Enhancements
(Adapted from original Router System docs)
* **Advanced Route Matching**: Support for more complex route patterns (e.g., regex-based), conditional routing based on request properties beyond path/method.
* **Dynamic Routing Updates**: Capabilities to update or re-prioritize routes at runtime without a full restart or re-application of all routes.
* **Enhanced Request/Response Validation**: Deeper integration with schema validation libraries, potentially with automatic type coercion or transformation based on schemas.
* **Performance Optimizations**: For systems with extremely large numbers of routes, explore route tree optimizations or caching for faster matching.
* **More Granular Middleware Control**: More sophisticated ways to apply middleware stacks conditionally.
* **Additional Framework Adapters**: Develop adapters for other popular Node.js web frameworks as needed.