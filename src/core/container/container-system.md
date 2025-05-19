# TSMIS ContainerSystem Documentation
Version: 2.0.0 (Refactored Core)

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

* **Managing Component Lifecycles**: Orchestrating the creation, initialization, and eventual shutdown of registered application components (including other core systems, services, and business modules)[cite: 95].
* **Dependency Injection**: Automatically resolving and injecting declared dependencies into components when they are created or resolved[cite: 95].
* **Centralized Registry**: Acting as a central place where all major shared components of the application are registered and can be retrieved[cite: 96].
* **Facilitating Loose Coupling**: By managing dependencies, it allows components to be developed and tested more independently[cite: 96].
* **Component Discovery**: Optionally discovering and loading components from the filesystem based on predefined manifests[cite: 104, 143].

It ensures that the application is assembled correctly, dependencies are met, and components are started and stopped in a predictable and orderly fashion.

### 1.2. Key Features
* **Flexible Component Registration**: Supports registration of components as classes, factory functions, or pre-resolved instances[cite: 14, 16, 99, 100, 105, 106, 107, 109, 110, 111].
* **Automatic Dependency Resolution**: Analyzes `static dependencies` arrays on components to build a dependency graph and inject required instances.
* **Ordered Initialization & Shutdown**: Initializes components in a topologically sorted order respecting their dependencies, and shuts them down in reverse order.
* **Singleton Scope Management**: Primarily manages components as singletons, caching and reusing instances by default.
* **Manifest-Based Discovery**: Can scan directories for components, loading and validating them based on registered manifests.
* **Circular Dependency Detection**: Identifies and reports circular dependencies during the resolution or initialization phase, preventing an unstable application state[cite: 47, 48, 97, 131, 132].
* **Event Emission**: Emits various events related to its operations (e.g., `component:registered`, `initialized`) allowing other parts of the system to react[cite: 13, 16, 21, 22, 39, 44, 58, 59, 98, 139, 140, 141, 142].
* **Standardized Core Features**: Adheres to the TSMIS core standardization pillars for state management, error handling, lifecycle, health monitoring, and metrics.

## 2. Core Concepts

### 2.1. Dependency Injection (DI) & Inversion of Control (IoC)
* **IoC**: The `ContainerSystem` inverts the control of object creation and management. Instead of components creating their own dependencies, the container creates and provides them[cite: 95].
* **DI**: Components declare their dependencies (typically via a `static dependencies` array listing the names of other registered components). The container then "injects" instances of these dependencies into the component when it's created (usually via constructor arguments or arguments to a factory function).

### 2.2. Components (Definition and Types)
A "component" in the context of `ContainerSystem` is any piece of functionality that the container manages. This can be:
* **Classes**: JavaScript classes whose instances will be managed by the container. The container will call `new Component(resolvedDependencies)`[cite: 99, 108, 117].
* **Factory Functions**: Functions that return a component instance. The container will call `Component(resolvedDependencies)`. These can be synchronous or asynchronous[cite: 99, 109, 110, 118].
* **Instances**: Pre-existing objects that are registered directly with the container. The container will return this instance as-is when resolved[cite: 100, 111, 119].

### 2.3. Manifests & Component Discovery
* **Manifests**: A manifest (registered via `registerManifest`) defines a "type" of component and can include metadata like a configuration schema (`configSchema`). This schema is used to validate the configuration of components discovered on the filesystem.
* **Discovery**: The `discover(type, basePath)` method allows the container to automatically find and prepare components of a specific manifest type within a given directory structure. This involves scanning for files (`scanDirectory`), loading their configuration (`loadConfig`), validating that configuration against the manifest's schema (`validateConfig`), and loading the component's implementation (`loadImplementation`).

### 2.4. Dependency Resolution & Order
* When a component is resolved or when `ContainerSystem.initialize()` is called, the container builds a dependency graph.
* It uses a topological sort algorithm (`resolveDependencyOrder`) based on the `static dependencies` arrays to determine the correct order for initializing components, ensuring that a component's dependencies are initialized before the component itself.
* This same order (reversed) is used for shutting down components.
* Circular dependencies are detected during this process, leading to a `ConfigError`[cite: 47, 48, 131, 132].

### 2.5. Singleton Scope
By default, all components registered as classes or factory functions are treated as **singletons**[cite: 106]. This means the `ContainerSystem` creates only one instance of such a component. The first time it's resolved, the instance is created and cached in `this.instances`[cite: 30, 31, 113, 121]. Subsequent calls to `resolve()` for the same component name will return the cached instance[cite: 30, 31, 113]. Pre-resolved instances registered with the container are inherently singletons. While `options.singleton: false` can be specified[cite: 158, 159], the current refactored `resolve` method primarily focuses on singleton caching; full transient behavior (not caching if `singleton: false`) would be an enhancement.

## 3. API Reference (`ContainerSystem`)

### 3.1. Constructor
**`new ContainerSystem(deps = {})`**
* **`deps`**: `object` (optional)
    * `deps.config`: `object` (optional, default: `{}`) - Configuration specific to the `ContainerSystem`'s operation (e.g., `container.initOrder`, `container.maxErrorHistory`).
    * `deps.errorSystem`: `ErrorSystem` (optional) - An instance of `ErrorSystem` for reporting internal errors.

### 3.2. Component Registration Methods

#### 3.2.1. `register(name: string, Component: Function | object, options = {}): ContainerSystem`
Registers a component (class, factory, or instance) with the container.
* **`name`**: `string` - The unique name for the component.
* **`Component`**: `Function | object` - The component's constructor (class), factory function, or the instance itself.
* **`options.singleton`**: `boolean` (default: `true`) - If `false`, implies transient scope (currently, resolve still caches singletons primarily).
* **Returns**: `ContainerSystem` - The container instance for chaining.
* **Throws**: `ConfigError` for duplicate names or if called on a shutdown container.
* **Emits**: `component:registered` event.

#### 3.2.2. `registerManifest(type: string, manifest: object): void`
Registers a component manifest used for discovery.
* **`type`**: `string` - Unique name for the component type.
* **`manifest`**: `object` - Object containing manifest data (e.g., `configSchema`).
* **Throws**: `ConfigError` for duplicate types or if called on a shutdown container.
* **Emits**: `manifest:registered` event.

### 3.3. Component Discovery Methods

#### 3.3.1. `async discover(type: string, basePath: string): Promise<Map<string, object>>`
Discovers components in a directory based on a manifest type.
* **Returns**: A `Promise` resolving to a `Map` of discovered components (`{ name, config, implementation }`).
* **Throws**: `ConfigError` if manifest type not found; `ServiceError` for general discovery failure.
* **Emits**: `discovery:error` for individual load failures, `discovery:completed` on success.

### 3.4. Component Resolution Methods

#### 3.4.1. `async resolve(name: string): Promise<any>`
Resolves and returns a component instance by name, handling dependency injection and singleton caching.
* **Returns**: `Promise<any>` - The resolved component instance.
* **Throws**: `ServiceError` if component not registered; `ConfigError` for dependency issues (missing, circular).
* **Emits**: `component:resolved` event.

### 3.5. Lifecycle Methods

#### 3.5.1. `async initialize(): Promise<void>`
Initializes all registered singleton components in dependency order. Calls `initialize()` on components that have this method.
* **Throws**: `ServiceError` or `ConfigError` if initialization fails.
* **Emits**: `system:initializing`, `system:initialized`, `system:running`.

#### 3.5.2. `async shutdown(): Promise<void>`
Shuts down all initialized singleton components in reverse dependency order. Calls `shutdown()` on components that have this method.
* **Throws**: `ServiceError` if shutdown fails.
* **Emits**: `system:shutting_down`, `system:shutdown`. Also `shutdown:error` for individual component shutdown failures.

### 3.6. Internal Utility Methods (Conceptual Overview)
These private methods support the public API:
* **`resolveDependencyOrder(): string[]`**: Determines component initialization order using topological sort based on `static dependencies`.
* **`async loadComponent(path, manifest): Promise<object|null>`**: Loads a single component's configuration and implementation from a given path, using the provided manifest for guidance (e.g., config validation).
* **`async scanDirectory(basePath): Promise<string[]>`**: Recursively scans the `basePath` to find all potential component files (e.g., `.js`, `.mjs`, `.cjs`).
* **`async loadConfig(path): Promise<object>`**: Loads configuration for a component. It first checks for a dedicated `[filename].config.js` file. If not found, it attempts to extract a `config` property or call a `config()` method from the component file itself. Defaults to `{ name: [filename], enabled: true }` if no other configuration is found.
* **`async validateConfig(config, schema): Promise<boolean>`**: Validates the loaded `config` object against the provided `schema` (from the component's manifest). It checks for required fields, correct types, enum values, pattern matches, and can execute a custom `_validate` function if present in the schema.
* **`async loadImplementation(path): Promise<Function|Class|Object>`**: Imports the JavaScript module at the given `path`. It attempts to identify the main export by looking for `module.default`, then a named export matching the filename, then common factory function patterns (e.g., `createSomething`), or a class constructor. As a fallback, it returns the entire module object.

### 3.7. Static Factory (`createContainerSystem`)
**`createContainerSystem(deps = {}): ContainerSystem`**
A factory function for creating `ContainerSystem` instances, suitable for dependency injection setups.

## 4. State Management (`ContainerSystem` Specifics)

The `ContainerSystem` adheres to the standard `this.state` object pattern:

**ContainerSystem**: Standard 'this.state' Object Structure

```javascript
// this.state = {
//   status: SYSTEM_STATUS.CREATED,
//   startTime: null,
//   errors: [], // Stores { error: CoreError, timestamp: string, context: object } for ContainerSystem's internal errors
//   metrics: new Map(),
//   healthChecks: new Map()
// };
```

* `status`: Current lifecycle status (`CREATED`, `INITIALIZING`, `RUNNING`, `SHUTTING_DOWN`, `SHUTDOWN`, `ERROR`).
* `startTime`: Timestamp of when initialization started or completed.
* `errors`: Array storing internal operational errors of the `ContainerSystem` itself.
* `metrics`: Map for storing operational metrics.
* `healthChecks`: Map for storing health check functions.

In addition to the standard state, `ContainerSystem` manages these key internal data structures (not part of `this.state` but critical to its operation):
* **`this.components: Map<string, { Component: Function | object, options: object }>`**: Stores the definitions and registration options of all registered components[cite: 10, 15].
* **`this.instances: Map<string, any>`**: Acts as a cache for resolved singleton component instances[cite: 11, 30, 31, 38, 39].
* **`this.dependencies: Map<string, Array<string>>`**: Stores the declared dependency names for each component, derived from `Component.dependencies`[cite: 11, 16, 31, 48].
* **`this.manifests: Map<string, object>`**: Stores registered component manifests, keyed by type, used for the discovery process[cite: 11, 13].

## 5. Lifecycle Management (`ContainerSystem` Specifics)

The `ContainerSystem` orchestrates its own lifecycle and that of the components it manages. It adheres to the standardized lifecycle methods and event emissions.

### 5.1. `initialize()` Process Flow
1.  Checks if already initialized; if so, logs an error (via `_handleInternalError`) and may return or throw `ServiceError`.
2.  Sets `state.status` to `SYSTEM_STATUS.INITIALIZING` and records `state.startTime`. Emits `LIFECYCLE_EVENTS.INITIALIZING`[cite: 44].
3.  Calls `resolveDependencyOrder()` to determine the correct initialization sequence for all registered components[cite: 41]. This involves a topological sort based on `static dependencies` and detects circular dependencies.
4.  Iterates through the ordered component names:
    * Calls `await this.resolve(componentName)` to get/create the instance and its dependencies.
    * If the resolved instance has an `initialize()` method and the container itself is not yet fully `RUNNING` (to avoid double init if `resolve` initialized it post-container-init), its `initialize()` method is called and awaited.
5.  Upon successful initialization of all components:
    * Sets `state.status` to `SYSTEM_STATUS.RUNNING`.
    * Records success metrics (e.g., `container.initialization.time`, `container.initialization.success`).
    * Emits `LIFECYCLE_EVENTS.INITIALIZED` and `LIFECYCLE_EVENTS.RUNNING`.
6.  If any error occurs during this process (e.g., dependency resolution failure, error in a component's `initialize()`):
    * Sets `state.status` to `SYSTEM_STATUS.ERROR`.
    * Records a failure metric.
    * The error is processed by `_handleInternalError`.
    * A `ServiceError` or `ConfigError` (wrapping the original cause) is thrown, halting further initialization.

### 5.2. `shutdown()` Process Flow
1.  Checks if already shutdown; if so, returns.
2.  Sets `state.status` to `SYSTEM_STATUS.SHUTTING_DOWN`. Emits `LIFECYCLE_EVENTS.SHUTTING_DOWN`.
3.  Calculates the reverse dependency order using `resolveDependencyOrder().reverse()`.
4.  Iterates through the reverse-ordered component names:
    * Retrieves the cached singleton instance from `this.instances`.
    * If the instance exists and has a `shutdown()` method, it is called and awaited.
    * Errors from individual component `shutdown()` methods are caught, an `shutdown:error` event is emitted, the error is logged via `_handleInternalError`, but these errors do *not* typically stop the shutdown of other components.
5.  Clears `this.instances` (but usually not `this.components`, `this.dependencies`, or `this.manifests`, allowing for potential re-initialization if designed for it, though current refactor treats shutdown as final for an instance).
6.  Upon completion of all component shutdowns:
    * Sets `state.status` to `SYSTEM_STATUS.SHUTDOWN` and clears `state.startTime`.
    * Records success metrics (e.g., `container.shutdown.time`, `container.shutdown.success`).
    * Emits `LIFECYCLE_EVENTS.SHUTDOWN`.
7.  If an error occurs in `resolveDependencyOrder` itself during shutdown:
    * Sets `state.status` to `SYSTEM_STATUS.ERROR`.
    * Records a failure metric.
    * The error is processed by `_handleInternalError`.
    * A `ServiceError` is thrown.

## 6. Error Handling within `ContainerSystem`

* **Internal Errors**: `ContainerSystem` uses a private `async _handleInternalError(error, context)` method for its own operational errors that are not directly propagated as the primary outcome of a public API call. This includes errors during the processing of multiple items (like individual component load failures during discovery or individual component shutdown failures during system shutdown). This method:
    1.  Ensures the error is a `ConfigError` or `ServiceError` (wrapping if necessary).
    2.  Logs the error to `this.state.errors`.
    3.  Records an `container.errors.internal` metric.
    4.  Uses `safeHandleError(this.deps.errorSystem, error, { source: 'ContainerSystem', ...context })` to report the error to the configured `ErrorSystem`.
* **Directly Thrown Errors**: For issues that make a public API operation immediately invalid or impossible to proceed with (e.g., registering a duplicate component, resolving an unknown component, circular dependencies), `ContainerSystem` throws `ConfigError` or `ServiceError` instances directly to the caller. These errors usually contain codes from `ErrorCodes.CONFIG` or `ErrorCodes.SERVICE`.
    * `ConfigError` examples: `DUPLICATE_COMPONENT`, `DUPLICATE_MANIFEST`, `MISSING_DEPENDENCY`, `CIRCULAR_DEPENDENCY`, `INVALID_TYPE` (for manifests), `LOAD_FAILED` (for component config), `VALIDATION_FAILED` (for component config).
    * `ServiceError` examples: `UNKNOWN_COMPONENT`, `ALREADY_INITIALIZED`, `DISCOVERY_FAILED`, `IMPLEMENTATION_LOAD_FAILED`, `INITIALIZATION_FAILED` (overall container init), `SHUTDOWN_FAILED` (overall container shutdown).

## 7. Event Integration (`ContainerSystem` Specifics)

`ContainerSystem` is an `EventEmitter` and emits several operational events, allowing other parts of the application to monitor and react to its activities:
* **`manifest:registered`**: When `registerManifest()` is successfully called. Payload: `{ type: string, manifest: object }`.
* **`component:registered`**: When `register()` is successfully called. Payload: `{ name: string, Component: Function | object }`.
* **`discovery:error`**: When an error occurs loading an individual component during a `discover()` operation. Payload: `{ path: string, error: ServiceError }`.
* **`discovery:completed`**: When a `discover()` operation finishes scanning and processing files for a specific type. Payload: `{ type: string, components: Map<string, object> }`.
* **`component:resolved`**: When `resolve()` successfully provides a component instance (after creation and potential initialization if the container is already running). Payload: `{ name: string, instance: any }`.
* **`shutdown:error`**: When a managed component's `shutdown()` method throws an error during the global `ContainerSystem.shutdown()` process. Payload: `{ component: string, error: ServiceError }`.

It also emits standard system lifecycle events for itself: `system:initializing`, `system:initialized`, `system:running`, `system:shutting_down`, `system:shutdown`, as defined in `SystemConstants.LIFECYCLE_EVENTS`.

## 8. Health Monitoring (`ContainerSystem` Specifics)

`ContainerSystem` implements the standard `checkHealth()` method, which aggregates results from its registered health checks.
* **Default Health Checks Registered**:
    * **`container.state`**: Reports the `ContainerSystem`'s current lifecycle `status` (from `this.state.status`), its `uptime` since initialization (if running), and the count of its internal `errors` (from `this.state.errors`).
    * **`container.components`**: Reports key statistics about the components it manages:
        * `registeredComponentCount: this.components.size`
        * `resolvedInstanceCount: this.instances.size` (for singletons)
        * `manifestCount: this.manifests.size`
* **Output Format**: `checkHealth()` returns a standardized health object, using `createStandardHealthCheckResult` for each of its sub-checks.

**ContainerSystem**: Example checkHealth() Output

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

## 9. Metrics Tracking (`ContainerSystem` Specifics)

`ContainerSystem` implements `recordMetric()` and `getMetrics()` adhering to the standard.
Key metrics automatically recorded:
* **Lifecycle**:
    * `container.initialization.success` / `container.initialization.failure` (Count: 1)
    * `container.initialization.time` (Value: duration in ms)
    * `container.shutdown.success` / `container.shutdown.failure` (Count: 1)
    * `container.shutdown.time` (Value: duration in ms)
* **Internal Errors**:
    * `container.errors.internal` (Count: 1). Tags: `errorName`, `errorCode`.
* **Operational Counts**:
    * `container.manifests.registered` (Count: 1). Tags: `type`.
    * `container.components.registered` (Count: 1). Tags: `name`.
    * `container.components.resolved` (Count: 1). Tags: `name`, `singleton` (boolean).
    * `container.discovery.started` (Count: 1). Tags: `type`, `basePath`.
    * `container.discovery.completed` (Count: 1). Tags: `type`, `count` (number of components discovered).
    * `container.discovery.failed` (Count: 1). Tags: `type`.

## 10. Integrations (ContainerSystem Level)

* **`ErrorSystem`**: If an `ErrorSystem` instance is provided in `deps.errorSystem` during construction, `ContainerSystem` uses it via the `safeHandleError` utility to report its own internal operational errors. This ensures container-related issues are centrally logged and managed.
* **Configuration (`deps.config`)**: The `ContainerSystem` can receive its own operational configuration via `deps.config`. Examples include:
    * `deps.config.container.initOrder: string[]`: An optional array of component names to prioritize during the `initialize()` sequence. This allows ensuring critical systems like `ErrorSystem` or `ConfigSystem` are initialized first.
    * `deps.config.container.maxErrorHistory: number`: To control the size of its internal `this.state.errors` buffer.
* **Application Components (Core Systems, Services, Business Modules)**: This is the primary and most crucial integration. `ContainerSystem`:
    * **Registers** these components via `register()` or `registerManifest()` + `discover()`.
    * **Resolves their dependencies** by looking up other components registered within itself based on `static dependencies` arrays.
    * **Injects these resolved dependencies** into components upon their creation (via constructor arguments for classes, or as arguments to factory functions).
    * **Manages their lifecycle** by calling their `initialize()` and `shutdown()` methods in the correct, dependency-aware order.
* **Node.js Filesystem (`fs/promises`, `path`, `fs`)**: These are used internally by the `discover()` related methods (`scanDirectory`, `loadConfig`, `loadImplementation`) for reading component files and their configurations from the disk. These are direct Node.js API usages rather than integrations with other TSMIS systems.
* **`EventBusSystem` (Indirectly)**: `ContainerSystem` itself emits events (e.g., `component:registered`, `initialized`). While it doesn't directly call `EventBusSystem`, these events can be listened to by any system that has access to the `ContainerSystem` instance and subscribes to its events. An `EventBusSystem` or a dedicated monitoring component could subscribe to these to log container activities or trigger other actions.

## 11. Usage Examples & Best Practices
### 11.1 "Basic Registration and Resolution"

**ContainerSystem**: Basic Component Registration and Resolution

```javascript
// Assuming ContainerSystem and createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js'; // Adjust path

// // 1. Create a ContainerSystem instance
// const container = createContainerSystem({
//   // Optional dependencies for the container itself (e.g., logger, global config)
//   // config: { container: { maxErrorHistory: 50 } },
//   // errorSystem: myErrorSystemInstance // if ErrorSystem is already created
// });

// // 2. Define a simple component (class)
// class SimpleLogger {
//   constructor() {
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
//   }
// }

// // startApp();
```

### 11.3 "Defining Component Dependencies

**ContainerSystem**: Defining and Resolving Component Dependencies

```javascript
// Assuming ContainerSystem and createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js';

// // 1. Define a LoggerService component (same as before or simpler)
// class LoggerService {
//   log(message) {
//     console.log(`[LoggerService] ${message}`);
//   }
//   async initialize() { console.log('LoggerService initialized.'); }
//   async shutdown() { console.log('LoggerService shutdown.'); }
// }

// // 2. Define a UserService that depends on LoggerService
// class UserService {
//   // Declare 'logger' (the registered name of LoggerService) as a dependency
//   static dependencies = ['logger']; // [cite: 101]

//   constructor(dependencies) {
//     // The container will inject an object where 'logger' is the resolved LoggerService instance
//     this.logger = dependencies.logger; // [cite: 101]
//     if (!this.logger) {
//       throw new Error("Logger dependency was not injected into UserService!");
//     }
//     console.log('UserService instance created, logger injected.');
//   }

//   async initialize() {
//     this.logger.log('UserService initializing...');
//     // ... other initialization logic for UserService ...
//     console.log('UserService initialized.');
//   }

//   createUser(name) {
//     this.logger.log(`Creating user: ${name}`);
//     // ... actual user creation logic ...
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

### 11.2 Registering Different Component Types), specifically focusing on factory functions

**ContainerSystem**: Registering Components with Factory Functions

```javascript
// Assuming ContainerSystem, createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js';
// Assume LoggerService is defined and registered as 'logger'

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


// // --- Example 3: Factory for a component that itself has dependencies (less common for factory to *define* a class this way)
// // More often, the factory *returns* an instance of an already defined class, or a simple object.
// function createComplexServiceFactory(deps) {
//     // deps.logger and deps.configService are injected into the factory
//     deps.logger.log('[ComplexService Factory] Creating ComplexService instance.');
//     class ComplexService {
//         constructor(innerDeps) { // This class's constructor doesn't get DI from container directly here
//             this.logger = innerDeps.logger;
//             this.configService = innerDeps.configService;
//             this.creationTimestamp = Date.now();
//         }
//         getInfo() {
//             this.logger.log(`[ComplexService] Info: AppName = ${this.configService.getAppName()}, CreatedAt = ${this.creationTimestamp}`);
//         }
//         async initialize() { this.logger.log('[ComplexService] Initialized.'); }
//         async shutdown() { this.logger.log('[ComplexService] Shutdown.'); }
//     }
//     // The factory provides the dependencies to the class it instantiates.
//     return new ComplexService({ logger: deps.logger, configService: deps.configService });
// }
// createComplexServiceFactory.dependencies = ['logger', 'configService']; // Dependencies for the factory


// // --- Registration and Usage ---
// async function appWithFactories() {
//   const container = createContainerSystem();

//   // Register LoggerService (as a class)
//   class LoggerService { log(m){console.log(m);} async initialize(){console.log('LoggerService Init');} async shutdown(){console.log('LoggerService Shutdown');}}
//   container.register('logger', LoggerService);

//   // Register components using their factory functions
//   container.register('configService', createSimpleConfigService);
//   container.register('dbService', createAsyncDatabaseService);
//   container.register('complexService', createComplexServiceFactory);


//   try {
//     await container.initialize(); // Initializes logger, then configService, dbService, complexService
//     console.log('ContainerSystem with factories initialized.');

//     const config = await container.resolve('configService');
//     console.log('App Name from ConfigService:', config.getAppName());

//     const db = await container.resolve('dbService');
//     const results = await db.query('SELECT * FROM users');
//     console.log('DB Query Results:', results);
    
//     const complexSvc = await container.resolve('complexService');
//     complexSvc.getInfo();

//     await container.shutdown();
//     console.log('ContainerSystem with factories shutdown complete.');

//   } catch (error) {
//     console.error('Application error with factories:', error);
//   }
// }

// // appWithFactories();
```

### 11.4 Using Manifests and Discovery

**ContainerSystem**: Using Manifests and Component Discovery

```javascript
// Assuming ContainerSystem, createContainerSystem are imported
// import { createContainerSystem } from './core/container/ContainerSystem.js';
// Assume the following directory structure and files for discovery:
//
// src/
// └── modules/
//     └── reporting/
//         ├── ReportGeneratorService.js
//         ├── ReportGeneratorService.config.js
//         └── DataAggregatorService.js
//             // (No .config.js, will use default or embedded config)

// --- File: src/modules/reporting/ReportGeneratorService.config.js ---
// // export default {
// //   name: 'reportGenerator', // Overrides filename-based naming
// //   enabled: true,
// //   outputFormat: 'pdf',
// //   schedule: 'daily'
// // };

// --- File: src/modules/reporting/ReportGeneratorService.js ---
// // export default class ReportGeneratorService {
// //   constructor(deps) { this.config = deps.config.moduleConfig; this.logger = deps.logger; }
// //   static dependencies = ['logger']; // Assuming logger is registered
// //   async initialize() { this.logger.log(`ReportGeneratorService (${this.config.name}) initialized. Format: ${this.config.outputFormat}`); }
// //   generate() { this.logger.log(`Generating ${this.config.outputFormat} report on schedule: ${this.config.schedule}`); }
// // }

// --- File: src/modules/reporting/DataAggregatorService.js ---
// // export const config = { // Embedded config
// //   name: 'dataAggregator',
// //   enabled: true,
// //   source: 'realtimeDB'
// // };
// //
// // export default class DataAggregatorService {
// //   constructor(deps) { this.config = deps.config.moduleConfig; this.logger = deps.logger; }
// //   static dependencies = ['logger'];
// //   async initialize() { this.logger.log(`DataAggregatorService (${this.config.name}) initialized. Source: ${this.config.source}`); }
// //   aggregate() { this.logger.log('Aggregating data...'); }
// // }


// --- Application Setup ---
// async function appWithDiscovery() {
//   const container = createContainerSystem();

//   // Register a simple logger for dependency injection
//   class Logger { log(m){console.log(m);} async initialize(){console.log('Logger for Discovery Init');} }
//   container.register('logger', Logger);

//   // 1. Register a manifest for 'service' components
//   container.registerManifest('service', {
//     configSchema: { // Schema to validate the .config.js or embedded config
//       name: { type: 'string', required: true },
//       enabled: { type: 'boolean', default: true },
//       outputFormat: { type: 'string', enum: ['pdf', 'csv', 'html'] }, // Example specific field
//       schedule: { type: 'string' },
//       source: { type: 'string' }
//     }
//   });
//   console.log("Manifest 'service' registered.");

//   // 2. Discover components of type 'service' from a base path
//   // Note: For real execution, ensure paths are correct and async import works in your environment.
//   // This example assumes files are structured as above relative to a base path.
//   // The actual file system scanning part would require running this in a Node.js environment
//   // with appropriate permissions and correct relative paths.
//   let discoveredServices;
//   try {
//     // Assuming this script is run from a directory where './src/modules/reporting' is a valid path
//     // For testing, you might mock the fs/promises and path modules used by scanDirectory.
//     const discoveryPath = './src_example/modules/reporting'; // Path to the 'reporting' directory
//     console.log(`Attempting to discover services in: ${discoveryPath}`);
//     discoveredServices = await container.discover('service', discoveryPath);
//     console.log(`Discovered ${discoveredServices.size} services.`);
//   } catch (error) {
//     console.error('Discovery process failed:', error);
//     // Handle discovery failure (e.g., path doesn't exist, manifest type unknown)
//     await container.shutdown();
//     return;
//   }

//   // 3. Register discovered components with the container
//   if (discoveredServices && discoveredServices.size > 0) {
//     for (const [name, componentDef] of discoveredServices.entries()) {
//       if (componentDef.config.enabled !== false) { // Check if enabled
//         console.log(`Registering discovered component: ${name}`);
//         container.register(
//           name, // Name comes from componentDef.name (from config or filename)
//           componentDef.implementation, // The loaded class/factory
//           { moduleConfig: componentDef.config } // Pass loaded config to the component instance via options
//                                                 // The component constructor would then access it via deps.config.moduleConfig
//         );
//       } else {
//         console.log(`Skipping registration of disabled component: ${name}`);
//       }
//     }
//   } else {
//     console.log('No services discovered or all were disabled.');
//   }

//   // 4. Initialize the container
//   try {
//     await container.initialize(); // Initializes logger, reportGenerator, dataAggregator
//     console.log('Container initialized with discovered services.');

//     // 5. Resolve and use a discovered service
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
// // Note: To run this fully, you'd need to create the example file structure and content
// // in a 'src_example/modules/reporting' directory relative to where this script runs,
// // and ensure your Node version supports dynamic import() used by container.loadImplementation().
```

### 11.5 Application Bootstrap Sequence

**ContainerSystem**: Example Application Bootstrap Sequence 

```javascript
// src/app.js (Conceptual Bootstrap File)

// import { createContainerSystem } from './core/container/ContainerSystem.js';
// import { createErrorSystem } from './core/errors/ErrorSystem.js';
// import { ErrorCodes } from './core/errors/ErrorCodes.js'; // For any direct error creation if needed
// import { createEventBusSystem } from './core/event/EventBusSystem.js';
// import { createModuleSystem } from './core/module/ModuleSystem.js';
// import { createRouterSystem } from './core/router/RouterSystem.js';

// // Example: Business module and service imports
// import { createInventoryService } from './modules/inventory/InventoryService.js';
// import { InventoryModule } from './modules/inventory/InventoryModule.js';
// import { FastifyAdapter } from './core/router/integrations/fastify/FastifyAdapter.js'; // Assuming Fastify
// import Fastify from 'fastify';

// async function bootstrapApplication() {
//   let container;
//   try {
//     console.log('[Bootstrap] Starting application bootstrap...');

//     // 1. Create the main ContainerSystem instance
//     container = createContainerSystem({
//       // Optional global config for the container itself
//       config: {
//         container: {
//           // Ensure critical systems are initialized in this order if they have inter-dependencies
//           // that are not solely managed by their static dependencies array.
//           initOrder: ['config', 'logger', 'errorSystem', 'eventBusSystem', 'moduleSystem', 'routerSystem'],
//           maxErrorHistory: 20, // Container's own internal error log size
//         }
//       }
//       // errorSystem is not available yet to pass to container's constructor,
//       // so container's _handleInternalError would use console.error for very early errors.
//     });
//     console.log('[Bootstrap] ContainerSystem created.');

//     // 2. Register Core Systems & Foundational Services
//     // These are critical for the application and other modules/services.
//     container.register('appConfig', () => ({ // Simple config component
//       appName: 'TSMIS Core Application',
//       port: process.env.PORT || 3000,
//       environment: process.env.NODE_ENV || 'development',
//       inventory: { lowStockThreshold: 10 }, // Module-specific config section
//       inventoryService: { allowNegativeStock: false } // Service-specific config section
//     }));
//     container.register('logger', () => console); // Basic logger, could be a more advanced LoggingSystem

//     // ErrorSystem depends on 'logger' and 'appConfig' (implicitly, via 'config' alias in its deps)
//     // For simplicity, assuming direct naming match for deps in createXSystem factories.
//     // If ErrorSystem explicitly depends on 'appConfig', it should be named 'appConfig' in its deps.
//     // Or, ContainerSystem can be enhanced to map 'config' to 'appConfig' for specific components.
//     // Let's assume createErrorSystem expects 'config' and 'logger'.
//     container.register('errorSystem', createErrorSystem);
//     container.register('eventBusSystem', createEventBusSystem); // Depends on errorSystem, config
//     container.register('moduleSystem', createModuleSystem);   // Depends on errorSystem, eventBusSystem, config
//     container.register('routerSystem', createRouterSystem);   // Depends on errorSystem, eventBusSystem, config
//     console.log('[Bootstrap] Core systems registered.');

//     // 3. Register Application-Specific Services
//     container.register('inventoryService', createInventoryService); // Depends on config, logger
//     console.log('[Bootstrap] Application services registered.');

//     // 4. Register Business Modules with ModuleSystem (after ModuleSystem is resolved)
//     // This step is often done after core systems are available but before full container.initialize()
//     // if module registration itself needs resolved core systems.
//     // Alternatively, ModuleSystem can be initialized first, then modules registered, then MS.initialize().
//     // For this example, we register modules before global container.initialize(),
//     // and ModuleSystem.initialize() (called by container.initialize()) will handle their init.
//     const moduleSystem = await container.resolve('moduleSystem'); // Resolve MS to register modules
//     await moduleSystem.register('inventory', InventoryModule, container.resolve('appConfig').inventory);
//     console.log('[Bootstrap] Business modules registered with ModuleSystem.');

//     // 5. Initialize the Container (and all registered components)
//     // This will initialize components in dependency order.
//     // ErrorSystem -> Config -> EventBusSystem -> ModuleSystem & RouterSystem (parallel if no direct dep) -> Services -> Modules
//     await container.initialize();
//     console.log('[Bootstrap] ContainerSystem and all components initialized successfully.');

//     // 6. Setup HTTP Server and Apply Routes (if applicable)
//     const routerSystem = await container.resolve('routerSystem');
//     const appConfig = await container.resolve('appConfig');
//     const errorSystem = await container.resolve('errorSystem'); // For Fastify error handler setup

//     const fastifyApp = Fastify({
//       logger: {
//         level: appConfig.environment === 'development' ? 'debug' : 'info',
//         // Serializer setup would use createFastifyLoggerErrorSerializer
//       }
//     });

//     // Setup Fastify error handling using ErrorSystem's integration
//     // This assumes ErrorSystem.registerIntegration was called or a helper is available
//     // This part needs the actual FastifyErrorHandler to be registered with ErrorSystem.
//     // For example, if ErrorSystem had a method: await errorSystem.setupFramework(fastifyApp, 'fastify');
//     // Or more directly:
//     // const feh = new FastifyErrorHandler();
//     // await errorSystem.registerIntegration('fastify', FastifyErrorHandler, fastifyApp, { errorSystem });
//     // The above line (registerIntegration) should ideally happen after errorSystem is initialized,
//     // often as part of an "api layer" setup module or right after container init.
//     // For simplicity, we'll assume it's configured.

//     routerSystem.registerAdapter('fastify', new FastifyAdapter({ logger: fastifyApp.log }));
//     await routerSystem.applyRoutes(fastifyApp, 'fastify');
//     console.log('[Bootstrap] Routes applied to Fastify.');

//     await fastifyApp.listen({ port: appConfig.port });
//     console.log(`[Bootstrap] Server listening on port ${appConfig.port} in ${appConfig.environment} mode.`);

//     return { container, fastifyApp }; // Return container and app for potential further use/testing

//   } catch (error) {
//     console.error('[Bootstrap] CRITICAL BOOTSTRAP FAILURE:', error.message, error.details, error.stack);
//     // Attempt to use logger if available, otherwise console
//     const logger = container?.instances.get('logger') || console;
//     const errorSystem = container?.instances.get('errorSystem');
//     if (errorSystem && errorSystem.handleError) {
//       await errorSystem.handleError(error, { phase: 'bootstrap', criticality: 'high' }).catch(e => console.error("Error handling the bootstrap error:", e));
//     } else if (logger) {
//       logger.error("CRITICAL BOOTSTRAP FAILURE (ErrorSystem unavailable):", error);
//     }
//     // Graceful shutdown attempt if container exists
//     if (container && container.state.status !== SYSTEM_STATUS.SHUTDOWN) {
//       try {
//         await container.shutdown();
//       } catch (shutdownError) {
//         console.error('[Bootstrap] Error during shutdown after bootstrap failure:', shutdownError);
//       }
//     }
//     process.exit(1); // Exit if bootstrap is critical
//   }
// }

// // bootstrapApplication();
```

* **Best Practices**:
    * **Central Instance**: Typically, a single `ContainerSystem` instance is created at the root of the application to manage all global/shared components.
    * **Register Core Systems First**: Ensure foundational systems like `ErrorSystem`, `ConfigSystem` (if you build one), and `EventBusSystem` are registered early, especially if other components depend on them.
    * **Declare Dependencies Explicitly**: Components should clearly declare their dependencies via a `static dependencies = ['depName1', 'depName2'];` array[cite: 101, 108, 175]. This is crucial for the container's dependency resolution and initialization ordering.
    * **Use Factory Functions for Complex Instantiation**: For components that require complex setup logic or have dependencies not managed by the container during their *own* construction, use a factory function. The factory function itself will receive its declared dependencies from the container.
    * **Manage Lifecycle in Components**: Components that require setup (e.g., establishing database connections, starting timers, subscribing to external events) or cleanup should implement `async initialize()` and `async shutdown()` methods for the container to call.
    * **Avoid Resolving Too Early or Manually**: Prefer dependency injection (having the container provide dependencies via constructor/factory) over manually calling `container.resolve()` within a component's constructor or early lifecycle methods. Let the container manage the wiring. Resolve components only when explicitly needed by application logic outside the DI flow, or during the bootstrap phase.
    * **Configuration**: Pass necessary configuration to components at registration time or ensure they can access a central configuration component that is also managed by the container.
    * **Manifests for Pluggable Components**: Leverage the manifest and discovery system for components that are designed to be pluggable or when dealing with a large number of similar components that can be discovered from the filesystem.

## 12. Testing Strategy Notes (`ContainerSystem`)
* **Registration**: Test `register()` with classes, factory functions (synchronous and asynchronous), and direct instances. Verify that `options` (like `singleton`) are correctly processed. Test `registerManifest()`. Ensure `ConfigError` is thrown for duplicate registrations.
* **Resolution**:
    * Verify correct instance creation and that constructor/factory functions are called with correctly resolved dependencies.
    * Test singleton behavior: multiple `resolve()` calls for the same component name (if registered as singleton) should return the exact same instance.
    * Test resolution of deeply nested dependencies.
    * Test for `ServiceError` (unknown component) and `ConfigError` (missing dependency).
* **Dependency Order & Circularity**: Test `resolveDependencyOrder()` logic with various dependency graphs. Crucially, test that `ConfigError` is thrown when circular dependencies are present between components.
* **Lifecycle Management**:
    * Mock components with `initialize()` and `shutdown()` methods (some succeeding, some throwing errors).
    * Verify `ContainerSystem.initialize()` calls component `initialize()` methods in the correct dependency-aware order.
    * Verify `ContainerSystem.shutdown()` calls component `shutdown()` methods in the correct reverse dependency order.
    * Test error handling during component init/shutdown (e.g., ensure `ContainerSystem.initialize()` fails if a critical component fails to initialize; ensure `ContainerSystem.shutdown()` continues with other components if one fails, and emits `shutdown:error`).
* **Discovery (`discover`, `loadComponent`, etc.)**:
    * Mock filesystem interactions (`fs/promises`, `fs`, `path`) extensively.
    * Test with various file structures: valid components, components with missing or invalid `*.config.js` files, components that are marked `enabled: false` in their config.
    * Test `validateConfig` with valid and invalid schemas.
    * Test `loadImplementation` with different module export styles (`default`, named exports).
    * Verify correct emission of `discovery:error` and `discovery:completed`.
* **State, Health, Metrics**: Ensure `this.state` (status, errors, metrics, healthChecks) is updated correctly throughout the container's operations. Test `checkHealth()` output for accuracy and completeness based on the container's state. Verify that all documented metrics are recorded with correct tags and values.
* **Event Emission**: Mock event listeners to verify that all documented operational and lifecycle events are emitted by `ContainerSystem` with the correct payloads at the appropriate times.

## 13. Future Considerations & Potential Enhancements
(Adapted from original documentation)
* **Scoped/Child Containers**: Introduce support for hierarchical or scoped containers. This would allow for more granular dependency management, such as creating a new scope per HTTP request or for specific application features, enabling request-specific services or overriding global services within a limited scope.
* **Advanced Component Discovery**: Enhance discovery with features like:
    * Dynamic reloading/unloading of components or modules at runtime (hot-swapping).
    * More sophisticated file watching or plugin mechanisms.
    * Support for component versioning during discovery and resolution.
* **Lazy Initialization**: Provide an option for components to be fully initialized only when they are first resolved via `container.resolve()`, rather than all components being initialized upfront during `container.initialize()`. This could significantly improve application startup time if many components are registered but not immediately needed.
* **Dependency Graph Visualization**: Develop or integrate tooling to visualize the dependency graph of registered components. This would be invaluable for understanding complex application structures, debugging dependency issues, and architectural analysis.
* **Asynchronous Registration**: Consider allowing the `register()` method to accept a Promise if the component definition or its factory function itself needs to perform asynchronous operations before it can be fully defined or made available to the container.
* **Enhanced Configuration Injection**: Explore more direct or typed ways to inject specific configuration values into components, potentially with more sophisticated schema validation and type coercion at the point of injection, beyond just passing the entire `config` object as a dependency.
* **Full Transient Component Support**: Modify the `resolve` method to fully support transient scope by not caching instances if `options.singleton` is explicitly set to `false`. This would create a new instance every time `resolve()` is called for such a component.
* **Conditional Registration**: Allow components to be registered based on certain conditions or environment flags.