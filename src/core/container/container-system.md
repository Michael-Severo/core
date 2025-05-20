# TSMIS ContainerSystem Documentation
Version: 2.1.0 (Refactored Core)

## Table of Contents

1.  [Introduction to the ContainerSystem](#1-introduction-to-the-containersystem)
    * [1.1. Purpose & Core Responsibilities](#11-purpose--core-responsibilities)
    * [1.2. Key Features](#12-key-features)
2.  [Core Concepts](#2-core-concepts)
    * [2.1. Dependency Injection (DI) & Inversion of Control (IoC)](#21-dependency-injection-di--inversion-of-control-ioc)
    * [2.2. Components (Definition and Types)](#22-components-definition-and-types)
    * [2.3. Manifests & Component Discovery](#23-manifests--component-discovery)
    * [2.4. Dependency Resolution & Order](#24-dependency-resolution--order)
    * [2.5. Singleton Scope](#25-singleton-scope)
3.  [API Reference (`ContainerSystem`)](#3-api-reference-containersystem)
    * [3.1. Constructor](#31-constructor)
    * [3.2. Component Registration Methods](#32-component-registration-methods)
        * [3.2.1. `register(name, Component, options)`](#321-registername-component-options)
        * [3.2.2. `registerManifest(type, manifest)`](#322-registermanifesttype-manifest)
    * [3.3. Component Discovery Methods](#33-component-discovery-methods)
        * [3.3.1. `async discover(type, basePath)`](#331-async-discovertype-basepath)
    * [3.4. Component Resolution Methods](#34-component-resolution-methods)
        * [3.4.1. `async resolve(name)`](#341-async-resolvename)
    * [3.5. Lifecycle Methods](#35-lifecycle-methods)
        * [3.5.1. `async initialize()`](#351-async-initialize)
        * [3.5.2. `async shutdown()`](#352-async-shutdown)
    * [3.6. Internal Utility Methods (Conceptual Overview)](#36-internal-utility-methods-conceptual-overview)
        * [`resolveDependencyOrder()`](#resolvedependencyorder)
        * [`loadComponent(path, manifest)`](#loadcomponentpath-manifest)
        * [`scanDirectory(basePath)`](#scandirectorybasepath)
        * [`loadConfig(path)`](#loadconfigpath)
        * [`validateConfig(config, schema)`](#validateconfigconfig-schema)
        * [`loadImplementation(path)`](#loadimplementationpath)
    * [3.7. Static Factory (`createContainerSystem`)](#37-static-factory-createcontainersystem)
4.  [State Management (`ContainerSystem` Specifics)](#4-state-management-containersystem-specifics)
5.  [Lifecycle Management (`ContainerSystem` Specifics)](#5-lifecycle-management-containersystem-specifics)
    * [5.1. `initialize()` Process Flow](#51-initialize-process-flow)
    * [5.2. `shutdown()` Process Flow](#52-shutdown-process-flow)
6.  [Error Handling within `ContainerSystem`](#6-error-handling-within-containersystem)
7.  [Event Integration (`ContainerSystem` Specifics)](#7-event-integration-containersystem-specifics)
8.  [Health Monitoring (`ContainerSystem` Specifics)](#8-health-monitoring-containersystem-specifics)
9.  [Metrics Tracking (`ContainerSystem` Specifics)](#9-metrics-tracking-containersystem-specifics)
10. [Integrations (ContainerSystem Level)](#10-integrations-containersystem-level)
11. [Usage Examples & Best Practices](#11-usage-examples--best-practices)
    * [11.1. Basic Registration and Resolution](#111-basic-registration-and-resolution)
    * [11.2. Registering Different Component Types (Class, Factory, Instance)](#112-registering-different-component-types-class-factory-instance)
    * [11.3. Defining Component Dependencies](#113-defining-component-dependencies)
    * [11.4. Using Manifests and Discovery](#114-using-manifests-and-discovery)
    * [11.5. Application Bootstrap Sequence](#115-application-bootstrap-sequence)
    * [11.6. Handling Circular Dependencies (Detection)](#116-handling-circular-dependencies-detection)
12. [Testing Strategy Notes (`ContainerSystem`)](#12-testing-strategy-notes-containersystem)
13. [Future Considerations & Potential Enhancements](#13-future-considerations--potential-enhancements)

---

## 1. Introduction to the ContainerSystem

### 1.1. Purpose & Core Responsibilities
The `ContainerSystem` is the heart of the TSMIS application's startup and runtime component management. It is a sophisticated Dependency Injection (DI) and Inversion of Control (IoC) container. Its primary responsibilities are:

* **Managing Component Lifecycles**: Orchestrating the creation, initialization, and eventual shutdown of registered application components (including other core systems, services, and business modules)[cite: 372].
* **Dependency Injection**: Automatically resolving and injecting declared dependencies into components when they are created or resolved[cite: 373].
* **Centralized Registry**: Acting as a central place where all major shared components of the application are registered and can be retrieved[cite: 374].
* **Facilitating Loose Coupling**: By managing dependencies, it allows components to be developed and tested more independently[cite: 375].
* **Component Discovery**: Optionally discovering and loading components from the filesystem based on predefined manifests[cite: 376].
It ensures that the application is assembled correctly, dependencies are met, and components are started and stopped in a predictable and orderly fashion[cite: 377].

### 1.2. Key Features
* **Flexible Component Registration**: Supports registration of components as classes, factory functions, or pre-resolved instances[cite: 378].
* **Automatic Dependency Resolution**: Analyzes `static dependencies` arrays on components to build a dependency graph and inject required instances[cite: 379].
* **Ordered Initialization & Shutdown**: Initializes components in a topologically sorted order respecting their dependencies, and shuts them down in reverse order[cite: 380].
* **Singleton Scope Management**: Primarily manages components as singletons, caching and reusing instances by default[cite: 381].
* **Manifest-Based Discovery**: Can scan directories for components, loading and validating them based on registered manifests[cite: 382].
* **Circular Dependency Detection**: Identifies and reports circular dependencies during the resolution or initialization phase, preventing an unstable application state[cite: 383].
* **Event Emission**: Emits various events related to its operations (e.g., `component:registered`, `initialized`) allowing other parts of the system to react[cite: 384].
* **Standardized Core Features**: Adheres to the TSMIS core standardization pillars for state management, error handling, lifecycle, health monitoring, and metrics[cite: 385].

---
## 2. Core Concepts

### 2.1. Dependency Injection (DI) & Inversion of Control (IoC)
* **IoC**: The `ContainerSystem` inverts the control of object creation and management. Instead of components creating their own dependencies, the container creates and provides them[cite: 387].
* **DI**: Components declare their dependencies (typically via a `static dependencies` array listing the names of other registered components). The container then "injects" instances of these dependencies into the component when it's created.

### 2.2. Components (Definition and Types)
A "component" in the context of `ContainerSystem` is any piece of functionality that the container manages. This can be:
* **Classes**: JavaScript classes whose instances will be managed[cite: 392].
* **Factory Functions**: Functions that return a component instance[cite: 393].
* **Instances**: Pre-existing objects registered directly.

### 2.3. Manifests & Component Discovery
* **Manifests**: A manifest (registered via `registerManifest`) defines a "type" of component and can include metadata like a configuration schema (`configSchema`) for validation.
* **Discovery**: The `discover(type, basePath)` method automatically finds and prepares components from a directory structure.

### 2.4. Dependency Resolution & Order
* The container builds a dependency graph and uses a topological sort (`resolveDependencyOrder`) based on `static dependencies` to determine initialization order.
* Shutdown occurs in reverse order[cite: 402].
* Circular dependencies are detected, leading to a `ConfigError`[cite: 403].

### 2.5. Singleton Scope
By default, components are treated as **singletons**. The container creates one instance, caches it, and reuses it for subsequent resolutions. Transient behavior (non-singleton) is a potential enhancement.

---
## 3. API Reference (`ContainerSystem`)

### 3.1. Constructor
**`new ContainerSystem(deps = {})`**
* **`deps`**: `object` (optional)
    * `deps.config`: `object` (optional) - Configuration for `ContainerSystem` operations[cite: 410].
    * `deps.errorSystem`: `ErrorSystem` (optional) - For reporting internal errors[cite: 411].

### 3.2. Component Registration Methods

#### 3.2.1. `register(name: string, Component: Function | object, options = {}): ContainerSystem`
Registers a component (class, factory, or instance).
* **`options.singleton`**: `boolean` (default: `true`)[cite: 415].
* **Returns**: `ContainerSystem` instance[cite: 416].
* **Throws**: `ConfigError` for duplicates or if called on a shutdown container[cite: 416].
* **Emits**: `component:registered` event[cite: 417].

#### 3.2.2. `registerManifest(type: string, manifest: object): void`
Registers a component manifest for discovery[cite: 417].
* **`type`**: `string` - Unique name for the component type[cite: 418].
* **`manifest`**: `object` - Manifest data (e.g., `configSchema`)[cite: 418].
* **Throws**: `ConfigError` for duplicates or if called on a shutdown container[cite: 419].
* **Emits**: `manifest:registered` event[cite: 419].

### 3.3. Component Discovery Methods

#### 3.3.1. `async discover(type: string, basePath: string): Promise<Map<string, object>>`
Discovers components based on a manifest type[cite: 420].
* **Returns**: `Promise` resolving to a `Map` of discovered components[cite: 421].
* **Throws**: `ConfigError` if manifest type not found; `ServiceError` for general discovery failure[cite: 422].
* **Emits**: `discovery:error`, `discovery:completed`[cite: 423].

### 3.4. Component Resolution Methods

#### 3.4.1. `async resolve(name: string): Promise<any>`
Resolves and returns a component instance by name[cite: 424].
* **Returns**: `Promise<any>` - The resolved component instance[cite: 425].
* **Throws**: `ServiceError` if not registered; `ConfigError` for dependency issues.
* **Emits**: `component:resolved` event[cite: 426].

### 3.5. Lifecycle Methods

#### 3.5.1. `async initialize(): Promise<void>`
Initializes all registered singleton components in dependency order[cite: 427].
* **Throws**: `ServiceError` or `ConfigError` on failure[cite: 428].
* **Emits**: `system:initializing`, `system:initialized`, `system:running`[cite: 428].

#### 3.5.2. `async shutdown(): Promise<void>`
Shuts down all initialized singleton components in reverse dependency order[cite: 429].
* **Throws**: `ServiceError` on failure[cite: 430].
* **Emits**: `system:shutting_down`, `system:shutdown`, `shutdown:error`[cite: 430].

### 3.6. Internal Utility Methods (Conceptual Overview)
These private methods support the public API[cite: 431]:
* **`resolveDependencyOrder(): string[]`**: Determines component initialization order[cite: 431].
* **`async loadComponent(path, manifest): Promise<object|null>`**: Loads a single component's config and implementation[cite: 432].
* **`async scanDirectory(basePath): Promise<string[]>`**: Finds potential component files[cite: 433].
* **`async loadConfig(path): Promise<object>`**: Loads configuration for a component.
* **`async validateConfig(config, schema): Promise<boolean>`**: Validates loaded config against a schema.
* **`async loadImplementation(path): Promise<Function|Class|Object>`**: Imports the JavaScript module.

### 3.7. Static Factory (`createContainerSystem`)
**`createContainerSystem(deps = {}): ContainerSystem`**
A factory function for creating `ContainerSystem` instances[cite: 442].

---
## 4. State Management (`ContainerSystem` Specifics)

The `ContainerSystem` adheres to the standard `this.state` object pattern[cite: 443]:

**`ContainerSystem`: Standard 'this.state' Object Structure**
```javascript
// this.state = {
//   status: SYSTEM_STATUS.CREATED,
//   startTime: null,
//   errors: [], // Stores { error: CoreError, timestamp: string, context: object } for ContainerSystem's internal errors
//   metrics: new Map(),
//   healthChecks: new Map()
// };
```
* `status`: Current lifecycle status (from `SystemConstants.SYSTEM_STATUS`)[cite: 444].
* `startTime`: Timestamp of initialization start/completion[cite: 445].
* `errors`: Array storing internal operational errors of `ContainerSystem`[cite: 445].
* `metrics`: Map for storing operational metrics[cite: 445].
* `healthChecks`: Map for storing health check functions[cite: 446].

Key internal data structures (not part of `this.state`):
* **`this.components: Map<string, { Component: Function | object, options: object }>`**: Stores registered component definitions[cite: 447].
* **`this.instances: Map<string, any>`**: Cache for resolved singleton instances[cite: 448].
* **`this.dependencies: Map<string, Array<string>>`**: Stores declared dependency names for each component[cite: 449].
* **`this.manifests: Map<string, object>`**: Stores registered component manifests[cite: 450].

---
## 5. Lifecycle Management (`ContainerSystem` Specifics)

The `ContainerSystem` orchestrates its own lifecycle and that of managed components, adhering to standard methods and event emissions.

### 5.1. `initialize()` Process Flow
1.  Checks if already initialized; logs error and may return or throw `ServiceError` if so[cite: 453].
2.  Sets `state.status` to `INITIALIZING`, records `startTime`, emits `LIFECYCLE_EVENTS.INITIALIZING`[cite: 454].
3.  Calls `resolveDependencyOrder()` to determine initialization sequence and detect circular dependencies.
4.  Iterates through ordered components:
    * Calls `await this.resolve(componentName)` for instance and dependencies[cite: 457].
    * If instance has `initialize()` and container not yet `RUNNING`, calls `instance.initialize()`[cite: 458].
5.  On success:
    * Sets `state.status` to `RUNNING`[cite: 459].
    * Records success metrics[cite: 460].
    * Emits `LIFECYCLE_EVENTS.INITIALIZED` and `LIFECYCLE_EVENTS.RUNNING`[cite: 460].
6.  On error:
    * Sets `state.status` to `ERROR`[cite: 461].
    * Records failure metric[cite: 462].
    * Error processed by `_handleInternalError`[cite: 462].
    * `ServiceError` or `ConfigError` thrown[cite: 463].

### 5.2. `shutdown()` Process Flow
1.  Checks if already shutdown; returns if so[cite: 464].
2.  Sets `state.status` to `SHUTTING_DOWN`, emits `LIFECYCLE_EVENTS.SHUTTING_DOWN`[cite: 464].
3.  Calculates reverse dependency order[cite: 465].
4.  Iterates through reverse-ordered components:
    * Retrieves cached instance[cite: 466].
    * If instance exists and has `shutdown()`, calls it[cite: 466].
    * Errors from component `shutdown()` are caught, `shutdown:error` emitted, logged via `_handleInternalError`, but do not stop other shutdowns[cite: 467].
5.  Clears `this.instances`[cite: 468].
6.  On completion:
    * Sets `state.status` to `SHUTDOWN`, clears `startTime`[cite: 469].
    * Records success metrics[cite: 470].
    * Emits `LIFECYCLE_EVENTS.SHUTDOWN`[cite: 470].
7.  If `resolveDependencyOrder` fails during shutdown:
    * Sets `state.status` to `ERROR`[cite: 471].
    * Records failure metric, error processed by `_handleInternalError`, `ServiceError` thrown[cite: 472].

---
## 6. Error Handling within `ContainerSystem`

* **Internal Errors**: `ContainerSystem` uses a private `async _handleInternalError(error, context)` method for its own operational errors (e.g., individual component load failures during discovery, individual component shutdown failures). This method:
    1.  Ensures the error is a `ConfigError` or `ServiceError` (wrapping if necessary). For example, a generic internal failure might be wrapped as `new ServiceError(ErrorCodes.SERVICE.OPERATION_FAILED, 'Container internal operation failed: ' + error.message, context, { cause: error })` using an unprefixed specific code from `ErrorCodes.SERVICE`.
    2.  Logs the error to `this.state.errors`[cite: 476].
    3.  Records an `container.errors.internal` metric[cite: 476].
    4.  Uses `safeHandleError(this.deps.errorSystem, error, { source: 'ContainerSystem', ...context })` to report to `ErrorSystem`[cite: 477].
* **Directly Thrown Errors**: For issues immediately invalidating an operation (e.g., duplicate component, unknown component, circular dependencies), `ContainerSystem` throws `ConfigError` or `ServiceError` instances directly[cite: 478]. These errors use specific, unprefixed codes from `ErrorCodes.CONFIG` or `ErrorCodes.SERVICE` (e.g., `new ConfigError(ErrorCodes.CONFIG.DUPLICATE_COMPONENT, ...)` or `new ServiceError(ErrorCodes.SERVICE.UNKNOWN_COMPONENT, ...)`), and their constructors handle prefixing to form the final `error.code`. Examples:
    * `ConfigError` codes: `DUPLICATE_COMPONENT`, `DUPLICATE_MANIFEST`, `MISSING_DEPENDENCY`, `CIRCULAR_DEPENDENCY`, `MANIFEST_TYPE_NOT_FOUND`, `LOAD_FAILED`, `VALIDATION_FAILED`.
    * `ServiceError` codes: `UNKNOWN_COMPONENT`, `OPERATION_FAILED` (used for `ALREADY_INITIALIZED`, `INITIALIZATION_FAILED`, `SHUTDOWN_FAILED` wrappers), `DISCOVERY_FAILED`, `IMPLEMENTATION_LOAD_FAILED`, `COMPONENT_LOAD_FAILED`.

---
## 7. Event Integration (`ContainerSystem` Specifics)
`ContainerSystem` is an `EventEmitter` and emits several operational events[cite: 481]:
* **`manifest:registered`**: Payload: `{ type: string, manifest: object }`[cite: 482].
* **`component:registered`**: Payload: `{ name: string, Component: Function | object }`[cite: 483].
* **`discovery:error`**: Payload: `{ path: string, error: ServiceError }`[cite: 484].
* **`discovery:completed`**: Payload: `{ type: string, components: Map<string, object> }`[cite: 485].
* **`component:resolved`**: Payload: `{ name: string, instance: any }`[cite: 486].
* **`shutdown:error`**: Payload: `{ component: string, error: ServiceError }`[cite: 487].
It also emits standard system lifecycle events for itself (e.g., `system:initializing`)[cite: 487].

---
## 8. Health Monitoring (`ContainerSystem` Specifics)
Implements `checkHealth()` aggregating results from its registered health checks[cite: 488].
* **Default Health Checks Registered**[cite: 489]:
    * **`container.state`**: Reports `status`, `uptime`, internal `errorCount`[cite: 489].
    * **`container.components`**: Reports `registeredComponentCount`, `resolvedInstanceCount`, `manifestCount`[cite: 490].
* **Output Format**: Uses `createStandardHealthCheckResult` for sub-checks[cite: 490].

**`ContainerSystem`: Example checkHealth() Output**
```json
// {
//   "name": "ContainerSystem",
//   "version": "2.0.0",
//   "status": "healthy", // Could be "degraded" or "unhealthy" based on checks
//   "timestamp": "2025-05-19T05:18:00.123Z", // Example ISO timestamp
//   "uptime": 3600000, // Example uptime in milliseconds (e.g., 1 hour)
//   "errorCount": 0,    // Number of errors in this.state.errors
//   "checks": {
//     "container.state": {
//       "status": "healthy",
//       "detail": {
//         "currentStatus": "running",
//         "uptime": 3600000,
//         "internalErrorCount": 0
//       },
//       "errors": []
//     },
//     "container.components": {
//       "status": "healthy",
//       "detail": {
//         "registeredComponentCount": 15,
//         "resolvedInstanceCount": 12,
//         "manifestCount": 3
//       },
//       "errors": []
//     }
//     // ... any other custom health checks registered with ContainerSystem ...
//   }
// }
```

---
## 9. Metrics Tracking (`ContainerSystem` Specifics)
Implements `recordMetric()` and `getMetrics()`[cite: 493]. Key metrics automatically recorded:
* **Lifecycle**: `container.initialization.success/failure`, `container.initialization.time`, `container.shutdown.success/failure`, `container.shutdown.time`.
* **Internal Errors**: `container.errors.internal` (Tags: `errorName`, `errorCode`).
* **Operational Counts**: `container.manifests.registered`, `container.components.registered`, `container.components.resolved`, `container.discovery.started`, `container.discovery.completed`, `container.discovery.failed`.

---
## 10. Integrations (ContainerSystem Level)
* **`ErrorSystem`**: Reports internal errors to `deps.errorSystem` via `safeHandleError`[cite: 498].
* **Configuration (`deps.config`)**: Uses for its own settings (e.g., `initOrder`, `maxErrorHistory`).
* **Application Components**: Registers, resolves dependencies, injects them, and manages their lifecycle.
* **Node.js Filesystem (`fs/promises`, `path`, `fs`)**: Used internally for discovery.
* **`EventBusSystem` (Indirectly)**: Emits events consumable by other systems.

---
## 11. Usage Examples & Best Practices
(Sections 11.1 to 11.6's code examples should be reviewed to ensure any error instantiations within them follow the new error code prefixing strategy: specialized error types take unprefixed specific codes from `ErrorCodes.js`, and `CoreError` used directly takes fully prefixed codes. For example, if a `ConfigError` is thrown, it should be `new ConfigError(ErrorCodes.CONFIG.SOME_CODE, ...)` where `ErrorCodes.CONFIG.SOME_CODE` is the unprefixed specific string.)

### 11.1. Basic Registration and Resolution
**ContainerSystem**: Basic Component Registration and Resolution
```javascript
// Assuming ContainerSystem and createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js'; // Adjust path
// import { ErrorCodes } from './core/errors/ErrorCodes.js'; // For example errors
// import { ServiceError } from './core/errors/index.js'; // For example errors

// // 1. Create a ContainerSystem instance
// const container = createContainerSystem({
//   // Optional dependencies for the container itself
//   // config: { container: { maxErrorHistory: 50 } },
//   // errorSystem: myErrorSystemInstance // if ErrorSystem is already created
// });

// // 2. Define a simple component (class)
// class SimpleLogger {
//   constructor(deps) { // deps will be an empty object if no dependencies declared
//     this.prefix = '[Logger]';
//     console.log('SimpleLogger instance created.');
//   }

//   log(message) {
//     console.log(`${this.prefix} ${message}`);
//   }

//   async initialize() {
//     console.log('SimpleLogger initialized.');
//   }

//   async shutdown() {
//     console.log('SimpleLogger shutdown.');
//   }
// }

// // 3. Register the component with the container
// container.register('logger', SimpleLogger);
// // 'logger' is the name used to resolve this component.
// // By default, it's registered as a singleton.

// // 4. Initialize the container (and all registered components)
// async function startApp() {
//   try {
//     await container.initialize(); // Calls SimpleLogger.initialize()
//     console.log('ContainerSystem initialized.');

//     // 5. Resolve the component instance
//     const loggerInstance = await container.resolve('logger');
//     loggerInstance.log('Hello from the resolved logger!');

//     // Subsequent resolves for a singleton return the same instance
//     const anotherLoggerInstance = await container.resolve('logger');
//     console.log('Are logger instances the same?', loggerInstance === anotherLoggerInstance); // true

//     // 6. Shutdown the container
//     await container.shutdown(); // Calls SimpleLogger.shutdown()
//     console.log('ContainerSystem shutdown complete.');
//   } catch (error) {
//     console.error('Application error:', error);
//     // In a real app, ensure errorSystem handles this if container init/shutdown fails
//     // For example, if initialization failed:
//     // if (error.code === `SERVICE_${ErrorCodes.SERVICE.OPERATION_FAILED}`) { /* ... */ }
//   }
// }

// // startApp();
```

### 11.2. Registering Different Component Types (Class, Factory, Instance)
(Conceptual, focusing on factory functions)
**ContainerSystem**: Registering Components with Factory Functions
```javascript
// Assuming ContainerSystem, createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js';
// Assume LoggerService is defined and registered as 'logger' (as in previous example)

// // --- Example 1: Synchronous Factory Function ---
// function createSimpleConfigService(dependencies) {
//   // dependencies.logger would be injected if 'logger' was in SimpleConfigService.dependencies
//   const logger = dependencies.logger || console; // Fallback if logger not a formal dependency
//   logger.log('[SimpleConfigService Factory] Creating SimpleConfigService instance.');
//   return {
//     appName: 'TSMIS App (via Sync Factory)',
//     getAppName: function() { return this.appName; },
//     async initialize() { logger.log('[SimpleConfigService] Initialized (Sync Factory).'); },
//     async shutdown() { logger.log('[SimpleConfigService] Shutdown (Sync Factory).'); }
//   };
// }
// // If the factory needs dependencies from the container:
// // createSimpleConfigService.dependencies = ['logger'];

// // --- Example 2: Asynchronous Factory Function ---
// async function createAsyncDatabaseService(dependencies) {
//   const logger = dependencies.logger; // Assuming 'logger' is a declared dependency
//   logger.log('[AsyncDatabaseService Factory] Starting to create AsyncDatabaseService instance...');
//   // Simulate async operation, e.g., connecting to a database
//   await new Promise(resolve => setTimeout(resolve, 50)); // Simulate delay

//   const dbInstance = {
//     connectionString: 'mydb://localhost/prod_db_async',
//     query: async function(sql) {
//       logger.log(`[AsyncDatabaseService] Executing query: ${sql}`);
//       return [{ id: 1, data: 'async_result' }];
//     },
//     async initialize() { logger.log('[AsyncDatabaseService] Initialized.'); },
//     async shutdown() { logger.log('[AsyncDatabaseService] Shutdown.'); }
//   };
//   logger.log('[AsyncDatabaseService Factory] AsyncDatabaseService instance created.');
//   return dbInstance;
// }
// // Declare dependencies for the factory function itself
// createAsyncDatabaseService.dependencies = ['logger'];


// // --- Registration and Usage ---
// async function appWithFactories() {
//   const container = createContainerSystem();

//   // Register LoggerService (as a class or another factory)
//   class LoggerService { 
//     log(m){console.log(m);} 
//     async initialize(){console.log('LoggerService Init');} 
//     async shutdown(){console.log('LoggerService Shutdown');}
//   }
//   container.register('logger', LoggerService);

//   // Register components using their factory functions
//   container.register('configService', createSimpleConfigService);
//   container.register('dbService', createAsyncDatabaseService);

//   try {
//     await container.initialize(); // Initializes logger, then configService, dbService
//     console.log('ContainerSystem with factories initialized.');

//     const config = await container.resolve('configService');
//     console.log('App Name from ConfigService:', config.getAppName());

//     const db = await container.resolve('dbService');
//     const results = await db.query('SELECT * FROM users');
//     console.log('DB Query Results:', results);

//     await container.shutdown();
//     console.log('ContainerSystem with factories shutdown complete.');
//   } catch (error) {
//     console.error('Application error with factories:', error);
//   }
// }

// // appWithFactories();
```

### 11.3. Defining Component Dependencies
**ContainerSystem**: Defining and Resolving Component Dependencies
```javascript
// Assuming ContainerSystem and createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js';

// // 1. Define a LoggerService component
// class LoggerService {
//   log(message) { console.log(`[LoggerService] ${message}`); }
//   async initialize() { console.log('LoggerService initialized.'); }
//   async shutdown() { console.log('LoggerService shutdown.'); }
// }

// // 2. Define a UserService that depends on LoggerService
// class UserService {
//   static dependencies = ['logger']; // Declare 'logger' as a dependency

//   constructor(dependencies) {
//     // The container injects an object where 'logger' is the resolved LoggerService instance
//     this.logger = dependencies.logger;
//     if (!this.logger) {
//       throw new Error("Logger dependency was not injected into UserService!");
//     }
//     console.log('UserService instance created, logger injected.');
//   }

//   async initialize() {
//     this.logger.log('UserService initializing...');
//     console.log('UserService initialized.');
//   }

//   createUser(name) {
//     this.logger.log(`Creating user: ${name}`);
//     return { id: Date.now(), name };
//   }

//   async shutdown() {
//     this.logger.log('UserService shutting down...');
//     console.log('UserService shutdown.');
//   }
// }

// // 3. Create the container and register components
// const container = createContainerSystem();
// container.register('logger', LoggerService);
// container.register('userService', UserService); // ContainerSystem reads UserService.dependencies

// // 4. Initialize and use
// async function appWithDependencies() {
//   try {
//     await container.initialize(); // Initializes logger, then userService
//     console.log('ContainerSystem with dependencies initialized.');

//     const userServiceInstance = await container.resolve('userService');
//     const user = userServiceInstance.createUser('Alice');
//     console.log('User created:', user);

//     await container.shutdown(); // Shuts down userService, then logger
//     console.log('ContainerSystem with dependencies shutdown complete.');
//   } catch (error) {
//     console.error('Application error:', error);
//   }
// }

// // appWithDependencies();
```

### 11.4. Using Manifests and Discovery
**ContainerSystem**: Using Manifests and Component Discovery
```javascript
// Assuming ContainerSystem, createContainerSystem, ErrorCodes, ConfigError are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js';
// import { ErrorCodes } from './core/errors/ErrorCodes.js';
// import { ConfigError, ServiceError } // from './core/errors/index.js';

// // Assume the following directory structure and files for discovery:
// // src_example/
// // └── modules/
// //     └── reporting/
// //         ├── ReportGeneratorService.js
// //         ├── ReportGeneratorService.config.js
// //         └── DataAggregatorService.js (with embedded config)

// // --- File: src_example/modules/reporting/ReportGeneratorService.config.js ---
// // export default {
// //   name: 'reportGenerator',
// //   enabled: true,
// //   outputFormat: 'pdf',
// //   schedule: 'daily'
// // };

// // --- File: src_example/modules/reporting/ReportGeneratorService.js ---
// // export default class ReportGeneratorService {
// //   constructor(deps) { this.config = deps.config.moduleConfig; this.logger = deps.logger; }
// //   static dependencies = ['logger']; // Assuming logger is registered
// //   async initialize() { this.logger.log(`ReportGeneratorService (${this.config.name}) initialized. Format: ${this.config.outputFormat}`); }
// //   generate() { this.logger.log(`Generating ${this.config.outputFormat} report on schedule: ${this.config.schedule}`); }
// // }

// // --- File: src_example/modules/reporting/DataAggregatorService.js ---
// // export const config = { name: 'dataAggregator', enabled: true, source: 'realtimeDB' };
// // export default class DataAggregatorService {
// //   constructor(deps) { this.config = deps.config.moduleConfig; this.logger = deps.logger; }
// //   static dependencies = ['logger'];
// //   async initialize() { this.logger.log(`DataAggregatorService (${this.config.name}) initialized. Source: ${this.config.source}`); }
// //   aggregate() { this.logger.log('Aggregating data...'); }
// // }


// --- Application Setup ---
// async function appWithDiscovery() {
//   const container = createContainerSystem();
//   class Logger { log(m){console.log(m);} async initialize(){console.log('Logger for Discovery Init');} }
//   container.register('logger', Logger);

//   // 1. Register a manifest for 'service' components
//   container.registerManifest('service', {
//     configSchema: {
//       name: { type: 'string', required: true },
//       enabled: { type: 'boolean', default: true },
//       outputFormat: { type: 'string', enum: ['pdf', 'csv', 'html'] },
//       schedule: { type: 'string' },
//       source: { type: 'string' }
//     }
//   });
//   console.log("Manifest 'service' registered.");

//   let discoveredServices;
//   try {
//     // IMPORTANT: This path is illustrative. Node.js dynamic import() needs valid paths.
//     // For a real test, create these files and adjust the path.
//     const discoveryPath = './src_example/modules/reporting'; 
//     console.log(`Attempting to discover services in: ${discoveryPath}`);
//     // Mock 'fs/promises' and 'path' for environments where real fs isn't available or for unit tests.
//     // This example assumes a Node.js environment where these files exist.
//     discoveredServices = await container.discover('service', discoveryPath);
//     console.log(`Discovered ${discoveredServices.size} services.`);
//   } catch (error) {
//     console.error('Discovery process failed:', error);
//     // Example of how the error might be thrown by 'discover'
//     // if (error.code === `SERVICE_${ErrorCodes.SERVICE.DISCOVERY_FAILED}`) { /* ... */ }
//     // if (error.code === `CONFIG_${ErrorCodes.CONFIG.MANIFEST_TYPE_NOT_FOUND}`) { /* ... */ }
//     await container.shutdown();
//     return;
//   }

//   // 3. Register discovered components
//   if (discoveredServices && discoveredServices.size > 0) {
//     for (const [name, componentDef] of discoveredServices.entries()) {
//       if (componentDef.config.enabled !== false) {
//         console.log(`Registering discovered component: ${name} from path ${componentDef.path}`); // Assuming path is part of componentDef
//         container.register(
//           name, // Name from componentDef.name (from config or filename)
//           componentDef.implementation, // The loaded class/factory
//           // Pass loaded config to the component instance via options,
//           // so constructor(deps) receives it as deps.config.moduleConfig
//           // This requires the component to expect `deps.config.moduleConfig`.
//           // A more common pattern is for ModuleSystem to handle this for CoreModules.
//           // For generic components in ContainerSystem, this is one way.
//           { moduleConfig: componentDef.config } 
//         );
//       } else {
//         console.log(`Skipping registration of disabled component: ${name}`);
//       }
//     }
//   } else {
//     console.log('No services discovered or all were disabled.');
//   }

//   try {
//     await container.initialize();
//     console.log('Container initialized with discovered services.');

//     if (container.components.has('reportGenerator')) {
//       const reportService = await container.resolve('reportGenerator');
//       reportService.generate();
//     }
//     if (container.components.has('dataAggregator')) {
//       const dataService = await container.resolve('dataAggregator');
//       dataService.aggregate();
//     }
//   } catch (error) {
//     console.error('Error during initialization or usage of discovered services:', error);
//   } finally {
//     await container.shutdown();
//     console.log('Container shutdown after discovery example.');
//   }
// }

// // appWithDiscovery();
// // Note: To run this, create the example file structure and content, e.g., in 'src_example/modules/reporting'
```

### 11.5. Application Bootstrap Sequence
**ContainerSystem***: Example Application Bootstrap Sequence
```javascript
// src/app.js (Conceptual Bootstrap File)
// import { createContainerSystem } from './core/container/ContainerSystem.js';
// import { createErrorSystem, ErrorCodes, CoreError } from './core/errors/index.js';
// import { createEventBusSystem } from './core/event/EventBusSystem.js';
// import { createModuleSystem, InventoryModule } from './core/module/index.js'; // Assuming InventoryModule is a CoreModule derivative
// import { createRouterSystem, FastifyAdapter } from './core/router/index.js';
// import { createInventoryService } from './modules/inventory/InventoryService.js'; // Example service
// import Fastify from 'fastify';

// async function bootstrapApplication() {
//   let container;
//   try {
//     console.log('[Bootstrap] Starting application bootstrap...');
//     container = createContainerSystem({
//       config: {
//         container: {
//           initOrder: ['appConfig', 'logger', 'errorSystem', 'eventBusSystem', 'moduleSystem', 'routerSystem'],
//           maxErrorHistory: 20,
//         }
//       }
//     });
//     console.log('[Bootstrap] ContainerSystem created.');

//     // Register Foundational App Config & Logger
//     container.register('appConfig', () => ({ 
//       appName: 'TSMIS Core App', port: 3000, environment: 'development',
//       inventory: { lowStockThreshold: 10 }, // Config for InventoryModule
//       inventoryService: { allowNegativeStock: false } // Config for InventoryService
//     }));
//     container.register('logger', () => console);

//     // Register Core Systems
//     container.register('errorSystem', createErrorSystem);
//     container.register('eventBusSystem', createEventBusSystem);
//     container.register('moduleSystem', createModuleSystem);
//     container.register('routerSystem', createRouterSystem);
//     console.log('[Bootstrap] Core systems registered.');

//     // Register Application-Specific Services
//     container.register('inventoryService', createInventoryService);
//     console.log('[Bootstrap] Application services registered.');

//     // Pre-initialize core systems that ModuleSystem or others might need ready
//     // This step depends on how inter-system dependencies are handled vs. container.initialize()
//     // For this example, let's assume container.initialize() handles their init in order.

//     // Register Business Modules with ModuleSystem
//     const moduleSystem = await container.resolve('moduleSystem'); // Resolve early to register modules
//     const appConfigForModules = await container.resolve('appConfig');
//     // Assuming InventoryModule is defined somewhere
//     // class InventoryModule extends CoreModule { /* ... */ } 
//     // await moduleSystem.register('inventory', InventoryModule, appConfigForModules.inventory);
//     console.log('[Bootstrap] Business modules registered with ModuleSystem.');

//     await container.initialize(); // Initialize all components in dependency order
//     console.log('[Bootstrap] ContainerSystem and all components initialized successfully.');

//     // Setup HTTP Server (example with Fastify)
//     const routerSystem = await container.resolve('routerSystem');
//     const appConfig = await container.resolve('appConfig');
//     const errorSystem = await container.resolve('errorSystem'); // For Fastify error handler

//     const fastifyApp = Fastify({ logger: { level: 'info' } });
//     // Example: Setup Fastify error handling integration (assuming ErrorSystem has a method or one is set up)
//     // errorSystem.setupFrameworkIntegration(fastifyApp, 'fastify'); // Conceptual

//     routerSystem.registerAdapter('fastify', new FastifyAdapter({ logger: fastifyApp.log }));
//     await routerSystem.applyRoutes(fastifyApp, 'fastify');
//     console.log('[Bootstrap] Routes applied to Fastify.');

//     await fastifyApp.listen({ port: appConfig.port });
//     console.log(`[Bootstrap] Server listening on port ${appConfig.port}.`);
//     return { container, fastifyApp };

//   } catch (error) {
//     console.error('[Bootstrap] CRITICAL BOOTSTRAP FAILURE:', 
//                   error.message, 
//                   error.code, // This will be the prefixed code
//                   error.details, 
//                   error.stack);
//     // Example: Check for specific error code (prefixed)
//     // if (error.code === `SERVICE_${ErrorCodes.SERVICE.OPERATION_FAILED}` && error.cause?.code === ErrorCodes.CORE.INITIALIZATION_FAILED) {
//     //    console.error("This was a core initialization failure wrapped in a service error by the container.");
//     // }
//     const logger = container?.instances?.get('logger') || console;
//     const errorSystem = container?.instances?.get('errorSystem');
//     if (errorSystem?.handleError) {
//       await errorSystem.handleError(error, { phase: 'bootstrap', criticality: 'high' }).catch(e => console.error("Error handling the bootstrap error:", e));
//     } else if (logger) {
//       logger.error("CRITICAL BOOTSTRAP FAILURE (ErrorSystem unavailable):", error);
//     }
//     if (container && container.state.status !== SYSTEM_STATUS.SHUTDOWN) {
//       try { await container.shutdown(); } catch (shutdownError) { /* ... */ }
//     }
//     process.exit(1);
//   }
// }
// // bootstrapApplication();
```

### 11.6. Handling Circular Dependencies (Detection)
`ContainerSystem` detects circular dependencies during `resolveDependencyOrder()` and `resolve()`, throwing a `ConfigError` with code `ErrorCodes.CONFIG.CIRCULAR_DEPENDENCY`.

* **Best Practices**:
    * Single `ContainerSystem` instance.
    * Register core systems first.
    * Declare dependencies explicitly via `static dependencies`.
    * Use factory functions for complex instantiation.
    * Implement `async initialize()` and `async shutdown()` in components.
    * Prefer dependency injection over manual resolution.
    * Pass configuration appropriately.
    * Leverage manifests for pluggable components.

---
## 12. Testing Strategy Notes (`ContainerSystem`)
* **Registration**: Test `register()` with various component types, options, `registerManifest()`. Test `ConfigError` for duplicates[cite: 681].
* **Resolution**: Test instance creation, dependency injection, singleton behavior, nested dependencies. Test `ServiceError` and `ConfigError` for resolution issues.
* **Dependency Order & Circularity**: Test `resolveDependencyOrder()`. Test `ConfigError` for circular dependencies.
* **Lifecycle Management**: Mock components with `initialize()`/`shutdown()`. Verify correct order and error handling during component init/shutdown.
* **Discovery**: Mock filesystem. Test various file structures, valid/invalid configs, `enabled: false`. Test `validateConfig`, `loadImplementation`. Verify event emissions.
* **State, Health, Metrics**: Ensure `this.state` updates correctly. Test `checkHealth()` and metric recording.
* **Event Emission**: Verify operational and lifecycle events are emitted correctly[cite: 697].

---
## 13. Future Considerations & Potential Enhancements
(Adapted from original documentation)
* **Scoped/Child Containers**: For more granular dependency management.
* **Advanced Component Discovery**: Dynamic reloading, sophisticated file watching, component versioning.
* **Lazy Initialization**: Option for components to initialize on first resolution.
* **Dependency Graph Visualization**: Tooling to visualize component dependencies.
* **Asynchronous Registration**: Allowing `register()` to accept a Promise[cite: 706].
* **Enhanced Configuration Injection**: More direct/typed configuration injection[cite: 707].
* **Full Transient Component Support**: Not caching instances if `options.singleton` is `false`.