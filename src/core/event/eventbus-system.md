# TSMIS EventBusSystem & CoreEventBus Documentation
Version: 2.0.0 (Refactored Core)

## Table of Contents

1.  [Introduction to the Eventing System](#1-introduction-to-the-eventing-system)
    * [1.1. Purpose & Philosophy](#11-purpose--philosophy)
    * [1.2. Key Components: `EventBusSystem` and `CoreEventBus`](#12-key-components-eventbussystem-and-coreeventbus)
2.  [Component: `CoreEventBus.js` - The Eventing Engine](#2-component-coreeventbusjs---the-eventing-engine)
    * [2.1. Overview & Primary Responsibility](#21-overview--primary-responsibility)
    * [2.2. Key Functionalities & API (`CoreEventBus`)](#22-key-functionalities--api-coreeventbus)
        * [2.2.1. Standard Event Object Structure](#221-standard-event-object-structure)
        * [2.2.2. `emit(eventName, data, options)`](#222-emiteventname-data-options)
        * [2.2.3. `subscribe(pattern, handler, options)`](#223-subscribepattern-handler-options)
        * [2.2.4. `unsubscribe(subscriptionId)`](#224-unsubscribesubscriptionid)
        * [2.2.5. Event Queuing (`queueEvent`, `processQueue`, `processAllQueues`)](#225-event-queuing-queueevent-processqueue-processallqueues)
        * [2.2.6. Event History (`trackEvent`, `getHistory`, `getAllHistory`)](#226-event-history-trackevent-gethistory-getallhistory)
        * [2.2.7. `handleError(error, context)` (for Listeners)](#227-handleerrorerror-context-for-listeners)
        * [2.2.8. `reset()`](#228-reset)
    * [2.3. Wildcard and Pattern Subscription Details](#23-wildcard-and-pattern-subscription-details)
    * [2.4. State Management (`CoreEventBus` Specifics)](#24-state-management-coreeventbus-specifics)
    * [2.5. Lifecycle Management (`CoreEventBus` Specifics)](#25-lifecycle-management-coreeventbus-specifics)
    * [2.6. Error Handling within `CoreEventBus`](#26-error-handling-within-coreeventbus)
    * [2.7. Health Monitoring (`CoreEventBus` Specifics)](#27-health-monitoring-coreeventbus-specifics)
    * [2.8. Metrics Tracking (`CoreEventBus` Specifics)](#28-metrics-tracking-coreeventbus-specifics)
    * [2.9. Static Factory (`createEventBus`)](#29-static-factory-createeventbus)
3.  [Component: `EventBusSystem.js` - The Managing Facade](#3-component-eventbussystemjs---the-managing-facade)
    * [3.1. Overview & Primary Responsibility](#31-overview--primary-responsibility)
    * [3.2. Key Functionalities & API (`EventBusSystem`)](#32-key-functionalities--api-eventbussystem)
        * [3.2.1. `initialize()`](#321-initialize)
        * [3.2.2. `getEventBus()`](#322-geteventbus)
        * [3.2.3. `emit(eventName, ...args)`](#323-emiteventname-args)
        * [3.2.4. `shutdown()`](#324-shutdown)
    * [3.3. Adherence to Standardization Pillars (Recap for `EventBusSystem`)](#33-adherence-to-standardization-pillars-recap-for-eventbussystem)
    * [3.4. State Management (`EventBusSystem` Specifics)](#34-state-management-eventbussystem-specifics)
    * [3.5. Lifecycle Management (`EventBusSystem` Specifics)](#35-lifecycle-management-eventbussystem-specifics)
    * [3.6. Error Handling within `EventBusSystem`](#36-error-handling-within-eventbussystem)
    * [3.7. Event Integration (`EventBusSystem` Specifics - Forwarding)](#37-event-integration-eventbussystem-specifics---forwarding)
    * [3.8. Health Monitoring (`EventBusSystem` Specifics)](#38-health-monitoring-eventbussystem-specifics)
    * [3.9. Metrics Tracking (`EventBusSystem` Specifics)](#39-metrics-tracking-eventbussystem-specifics)
    * [3.10. Static Factory (`createEventBusSystem`)](#310-static-factory-createeventbussystem)
4.  [Integrations (Eventing System Level)](#4-integrations-eventing-system-level)
5.  [Overall Eventing Flow Diagram](#5-overall-eventing-flow-diagram)
6.  [Usage Examples & Best Practices](#6-usage-examples--best-practices)
    * [6.1. Emitting an Event](#61-emitting-an-event)
    * [6.2. Subscribing to Events (Exact, Pattern, Wildcard)](#62-subscribing-to-events-exact-pattern-wildcard)
    * [6.3. Using Event Queuing](#63-using-event-queuing)
    * [6.4. Accessing Event History](#64-accessing-event-history)
    * [6.5. Error Handling in Event Listeners](#65-error-handling-in-event-listeners)
7.  [Testing Strategy Notes](#7-testing-strategy-notes)
8.  [Future Considerations & Potential Enhancements](#8-future-considerations--potential-enhancements)

---

## 1. Introduction to the Eventing System

### 1.1. Purpose & Philosophy
The TSMIS Eventing System, comprising `EventBusSystem` and its managed `CoreEventBus`, is a cornerstone of the application's architecture, designed to facilitate decoupled, asynchronous communication between various components, particularly business modules. The philosophy behind it is to enable a more modular, scalable, and maintainable system where components can react to occurrences (events) without being tightly bound to the components that produce those events. This promotes an event-driven architecture (EDA) pattern.

Key goals include:
* **Decoupling**: Publishers of events do not need to know about subscribers, and vice-versa.
* **Asynchronicity**: Allows for non-blocking operations and better system responsiveness.
* **Extensibility**: New listeners can be added to react to existing events without modifying the event publishers.
* **Standardization**: Provides a consistent way to define, emit, subscribe to, and manage events.
* **Observability**: Offers built-in features for history, health monitoring, and metrics related to event processing.

### 1.2. Key Components: `EventBusSystem` and `CoreEventBus`
* **`CoreEventBus.js`**: This is the engine of the eventing system. It extends Node.js's `EventEmitter` and provides the core functionalities:
    * Emitting events with a standardized structure.
    * Managing subscriptions (exact name, pattern-based, and global wildcard).
    * Optional event queuing for deferred processing.
    * Optional event history for debugging and auditing.
    * Its own standardized state, lifecycle, error handling, health, and metrics.
* **`EventBusSystem.js`**: This system acts as a managing facade for `CoreEventBus`. Its responsibilities include:
    * Creating, initializing, and shutting down the `CoreEventBus` instance.
    * Providing a controlled access point to the `CoreEventBus` instance for the rest of the application (`getEventBus()`).
    * Integrating the eventing subsystem into the application's overall lifecycle, error reporting, health monitoring, and metrics collection through its adherence to the TSMIS core standardization pillars.
    * Potentially forwarding or reacting to specific system-level events from `CoreEventBus`.

Application components (like business modules) will primarily interact with the `CoreEventBus` instance obtained via `EventBusSystem.getEventBus()`.

## 2. Component: `CoreEventBus.js` - The Eventing Engine

**(This section details the `CoreEventBus` class. Full individual documentation would be in `core-event-bus-docs.md`.)**

### 2.1. Overview & Primary Responsibility
`CoreEventBus` is the central workhorse for event management in TSMIS. It provides a robust implementation for emitting events, managing complex subscription patterns (exact, wildcard, regex-like), queuing events for later processing, and maintaining a history of emitted events. It ensures all events adhere to a standard structure.

### 2.2. Key Functionalities & API (`CoreEventBus`)

#### 2.2.1. Standard Event Object Structure
All events emitted and received via `CoreEventBus.emit()` and subscriber handlers are wrapped in a standard object:

**CoreEventBus**: Standard Event Object Structure Example

```javascript
// {
//   id: "a1b2c3d4-e5f6-7890-1234-567890abcdef", // Unique event ID (e.g., UUID)
//   name: "user.created",                         // The original emitted eventName
//   data: {                                       // The event payload/data
//     userId: "usr_123",
//     username: "alice_wonder",
//     email: "alice@example.com"
//   },
//   timestamp: "2025-05-18T23:30:00.000Z",       // ISO 8601 timestamp of event creation
//   metadata: {                                   // User-supplied options.metadata or an empty object
//     correlationId: "corr_id_789",
//     sourceService: "AuthModule"
//   }
// }
```

This standardization simplifies handler logic as the event structure is predictable.

#### 2.2.2. `emit(eventName: string, data: any, options = {}): Promise<boolean>`
The primary method for publishing events.
* **`eventName`**: The string identifier of the event (e.g., `user.created`).
* **`data`**: The payload associated with the event.
* **`options`**: An optional object which can include:
    * `options.queue: boolean` (default: `false`): If `true`, the event is added to a named queue (based on `eventName`) for deferred processing instead of immediate emission to listeners.
    * `options.immediate: boolean` (default: `false`): If `options.queue` is `true`, setting this to `true` attempts to process the queue immediately after this event is added.
    * `options.metadata: object` (default: `{}`): Allows attaching additional, non-payload information to the event.
* Wraps `data` and `metadata` into the standard event object.
* Adds the event to history using `trackEvent()`.
* Records an `eventbus.events.emitted` metric.
* Handles queuing or direct emission to subscribers.
* **Returns**: `Promise<boolean>` indicating if the event had listeners (for direct emit) or was successfully queued.
* **Throws**: `EventError` for invalid `eventName` or internal processing issues.

#### 2.2.3. `subscribe(pattern: string, handler: Function, options = {}): string`
Registers a handler function to listen for events matching the given `pattern`.
* **`pattern`**: Can be an exact event name, a pattern with wildcards (e.g., `domain.*`, `*.action`), or a global wildcard (`*`).
* **`handler`**: An `async function(event: object)` that will be invoked with the single, full standard event object when a matching event is emitted.
* **`options`**: Reserved for future subscription-specific options.
* **Returns**: A unique `subscriptionId` (string) which can be used with `unsubscribe()`.
* **Throws**: `EventError` for invalid `pattern` or `handler`.

#### 2.2.4. `unsubscribe(subscriptionId: string): boolean`
Removes a previously established subscription.
* **`subscriptionId`**: The ID returned by `subscribe()`.
* **Returns**: `true` if a subscription was found and successfully removed, `false` otherwise.

#### 2.2.5. Event Queuing (`queueEvent`, `processQueue`, `processAllQueues`)
* **`async queueEvent(event: object, options = {}): Promise<boolean>`**: Internally used by `emit` (if `options.queue` is true) to add a fully formed standard event object to a named queue.
* **`async processQueue(queueName: string): Promise<number>`**: Processes a batch of events (size configurable via `config.eventBus.queueBatchSize`) from the specified queue by emitting them to their respective subscribers. Errors thrown by individual event handlers during queue processing are caught and reported via `this.handleError()`.
* **`async processAllQueues(): Promise<object>`**: Iterates through all existing queues and calls `processQueue()` for each, returning an object with processed counts per queue.

#### 2.2.6. Event History (`trackEvent`, `getHistory`, `getAllHistory`)
* **`trackEvent(event: object)`**: Automatically called by `emit` to add the event object to an in-memory, capped history list maintained per event name. The maximum history size is configurable via `this.maxHistorySize` (from `config.eventBus.maxHistorySize` or a default).
* **`getHistory(eventName: string, options = { limit?: number }): Array<object>`**: Retrieves the recorded history for a specific event name, optionally limited to the most recent `limit` events.
* **`getAllHistory(options = { limit?: number }): object`**: Retrieves history for all event names.

#### 2.2.7. `async handleError(error: Error, context = {}): Promise<void>`
A public method designed for event *listeners* to report errors they encounter during their own execution. This method standardizes how listener errors are reported to the central `ErrorSystem` by using `safeHandleError(this.deps.errorSystem, error, context)`.

#### 2.2.8. `async reset(): Promise<void>`
Clears all event queues, history, and removes all application-level event listeners and subscriptions. It also disables wildcard forwarding if it was active. This is a destructive operation typically used during testing or a controlled system reset.

### 2.3. Wildcard and Pattern Subscription Details
A key aspect of the refactored `CoreEventBus` is the consistent and predictable behavior of wildcard and pattern-based subscriptions:
* **Handler Signature**: All event handlers, regardless of whether they subscribe to an exact event name, a pattern (e.g., `user.*`), or the global wildcard (`*`), receive a **single argument**: the full, standardized event object (`{ id, name, data, timestamp, metadata }`).
* **Wildcard Forwarding (`*`)**: `CoreEventBus` dynamically manages an internal "wildcard forwarding" mechanism.
    * When the first listener subscribes to `*`, `CoreEventBus` wraps its native `emit` method (`this._enableWildcardForwarding()`). This wrapper ensures that after an event is emitted to its specific listeners, the same complete event object is also dispatched to the `"*"` channel if the original event name was not `"*"`.
    * This wrapper is removed when the last `"*"` listener unsubscribes (`this._disableWildcardForwarding()`).
* **Pattern Subscription (e.g., `item.*`)**: These subscriptions internally listen on the `"*"` channel. When they receive an event object (which is always the full standard object), their internal handler then applies a regular expression (generated from the pattern like `item.*`) against the `event.name` property to determine if their specific user-provided handler should be invoked.

This ensures that event data is consistently presented to all types of handlers, simplifying developer experience.

### 2.4. State Management (`CoreEventBus` Specifics)
`CoreEventBus` implements the standard `this.state` object. Key operational data is stored as instance properties:
* **`this.queues: Map<string, Array<object>>`**: Stores events waiting for processing, keyed by event name.
* **`this.subscriptions: Map<string, object>`**: Stores active subscription details (pattern, handler, etc.), keyed by a unique subscription ID.
* **`this.history: Map<string, Array<object>>`**: Stores recent event objects, keyed by event name.
* **`this.maxHistorySize: number`**: Configuration for history length.
* **`this._originalEmit: Function | null`**: Stores the original `super.emit` when wildcard forwarding is active.
* **`this._processingNewListener: boolean`**: Internal guard for `newListener` recursion.

### 2.5. Lifecycle Management (`CoreEventBus` Specifics)
* **`async initialize()`**: Sets up initial state. Wildcard forwarding logic is now primarily driven by `newListener` and `removeListener` hooks set up in the constructor. Emits `system:initializing`, `system:initialized`, `system:running`.
* **`async shutdown()`**: Calls `reset()` to clear all operational data (queues, history, listeners, subscriptions) and then removes all its own listeners (including internal ones for wildcard management). Emits `system:shutting_down` and logs `system:shutdown` (as listeners are removed).

### 2.6. Error Handling within `CoreEventBus`
* Uses a private `_handleInternalError(error, context)` method for its own operational errors (e.g., invalid arguments to `emit` or `subscribe`, unexpected issues in queuing/history). This logs to `this.state.errors`, records metrics, and reports to `ErrorSystem` via `safeHandleError`.
* Throws `EventError` with specific codes from `ErrorCodes.EVENT` for such failures.
* Catches errors from individual event handlers during `processQueue` and reports them via its public `handleError` method, allowing other events in the queue to be processed.

### 2.7. Health Monitoring (`CoreEventBus` Specifics)
Provides `checkHealth()`. Default checks:
* **`eventbus.state`**: Its lifecycle `status`, uptime, internal error count.
* **`eventbus.queues`**: Number of active queues and total events across all queues.
* **`eventbus.subscriptions`**: Number of active subscriptions and a list of their patterns.

### 2.8. Metrics Tracking (`CoreEventBus` Specifics)
Records detailed metrics:
* Lifecycle: `eventbus.initialized.success/failure`, `eventbus.shutdown.success/failure`.
* Errors: `eventbus.errors.internal`, `eventbus.errors.reported_by_listener`.
* Operations: `eventbus.wildcard.enabled/disabled`, `eventbus.events.emitted` (tags: `eventName`, `queued`), `eventbus.events.queued` (tags: `eventName`, `queueSize`), `eventbus.queue.processed` (tags: `queueName`, `processingTimeMs`), `eventbus.queue.remaining`, `eventbus.all_queues.processed_total`, `eventbus.subscriptions.added/removed` (tags: `pattern`), `eventbus.history.size` (tags: `eventName`), `eventbus.reset`.

### 2.9. Static Factory (`createEventBus`)
**`createEventBus(deps = {}): CoreEventBus`** for instantiation.

---
## 3. Component: `EventBusSystem.js` - The Managing Facade

**(This section details the `EventBusSystem` class. Full individual documentation would be in `event-bus-system-docs.md`.)**

### 3.1. Overview & Primary Responsibility
`EventBusSystem` acts as a managing facade for the `CoreEventBus` instance. Its main roles are to handle the lifecycle (creation, initialization, shutdown) of the `CoreEventBus`, provide a controlled access point (`getEventBus()`) for the rest of the application, and integrate the eventing subsystem's health and metrics into the standardized TSMIS monitoring framework.

### 3.2. Key Functionalities & API (`EventBusSystem`)

#### 3.2.1. `async initialize(): Promise<EventBusSystem>`
Validates its own dependencies (`errorSystem`, `config`). Creates a new instance of `CoreEventBus`, passing necessary dependencies. Calls `await coreEventBusInstance.initialize()`. Sets up event forwarding from `CoreEventBus` to `EventBusSystem` if needed.

#### 3.2.2. `getEventBus(): CoreEventBus`
The primary method for application components to retrieve the fully initialized and operational `CoreEventBus` instance. Throws an `EventError` if `EventBusSystem` (and by extension `CoreEventBus`) is not yet running.

#### 3.2.3. `async emit(eventName, ...args)`
While `EventBusSystem` is an `EventEmitter`, its `emit` method is primarily intended for its own lifecycle events (e.g., `system:initialized`). If used for other event names (not prefixed with `system:` or `coreEventBus:`), it forwards the emission to the managed `CoreEventBus` instance. Application components should generally use `getEventBus().emit()` for business events.

#### 3.2.4. `async shutdown(): Promise<EventBusSystem>`
Manages the graceful shutdown of the `CoreEventBus` (by calling its `shutdown()` method) and then cleans up its own resources and listeners.

### 3.3. Adherence to Standardization Pillars (Recap for `EventBusSystem`)
* **State Management**: Implements the standard `this.state` object. Also holds the `eventBus` (CoreEventBus instance) and `_forwardingInitialized` flag.
* **Lifecycle Management**: Manages its own lifecycle (`initialize`, `shutdown`) which includes managing `CoreEventBus`'s lifecycle. Emits standard `LIFECYCLE_EVENTS`.
* **Error Handling**: Uses `_handleInternalError` for its own operational errors, reporting via `safeHandleError`. Throws `EventError`.
* **Health Monitoring**: `checkHealth()` aggregates its own state with the health of the managed `CoreEventBus` (via `eventbussystem.corebus` check).
* **Metrics Tracking**: Records metrics for its own lifecycle and internal errors.
* **Factory Function**: `createEventBusSystem(deps = {})` is provided.

### 3.4. State Management (`EventBusSystem` Specifics)
(Covered by 3.3 - Standard `this.state` plus `eventBus` instance and `_forwardingInitialized` flag).

### 3.5. Lifecycle Management (`EventBusSystem` Specifics)
* **`initialize()`**: Instantiates and initializes `CoreEventBus`. Calls `_setupEventForwarding()`.
* **`shutdown()`**: Ensures `CoreEventBus.shutdown()` is called. Clears its own state.

### 3.6. Error Handling within `EventBusSystem`
Uses `_handleInternalError` for its own operational errors (e.g., if `CoreEventBus` fails to initialize). These are reported to the global `ErrorSystem`.

### 3.7. Event Integration (`EventBusSystem` Specifics - Forwarding)
`_setupEventForwarding()` listens to the managed `CoreEventBus` instance (typically via `on('*', eventHandler)`).
* It may re-emit certain non-system events from `CoreEventBus` on the `EventBusSystem` instance itself, allowing components holding only an `EventBusSystem` reference to listen.
* It also forwards specific lifecycle events from `CoreEventBus` (e.g., `CoreEventBus`'s own `system:initialized`) by emitting new events on `EventBusSystem` with a differentiating prefix (e.g., `coreEventBus:initialized`).

### 3.8. Health Monitoring (`EventBusSystem` Specifics)
Default health checks:
* **`eventbussystem.state`**: Its own lifecycle `status`, uptime, internal error count.
* **`eventbussystem.corebus`**: Calls `this.eventBus.checkHealth()` and includes the full, standardized health report from `CoreEventBus`.

### 3.9. Metrics Tracking (`EventBusSystem` Specifics)
Key metrics:
* `eventbussystem.initialized.success/failure`
* `eventbussystem.shutdown.success/failure`
* `eventbussystem.errors.internal`

### 3.10. Static Factory (`createEventBusSystem`)
**`createEventBusSystem(deps = {}): EventBusSystem`** for instantiation.

---
## 4. Integrations (Eventing System Level)

The Eventing System (`EventBusSystem` providing `CoreEventBus`) integrates with virtually all other parts of TSMIS:
* **`ContainerSystem`**: Instantiates `EventBusSystem` and provides its dependencies (`ErrorSystem`, `config`). `ContainerSystem` may also emit its own operational events that could be listened to via `CoreEventBus` if a bridge component were set up.
* **`ModuleSystem` & `CoreModule`s**: `ModuleSystem` injects `EventBusSystem` into `CoreModule`s. `CoreModule`s then use `eventBusSystem.getEventBus()` to obtain the `CoreEventBus` instance for:
    * Emitting domain-specific events (`this.emit()` in `CoreModule` uses it).
    * Subscribing to events from other modules or systems (in `setupEventHandlers()`).
* **`RouterSystem` & `CoreRouter`**: `CoreRouter` subscribes to `router.route.*` events (emitted by `RoutableModule`s via `CoreEventBus`) to learn about route definitions.
* **`ErrorSystem`**: `CoreEventBus` (via its public `handleError` method used by listeners) and `EventBusSystem` (via its `_handleInternalError`) report their errors to `ErrorSystem` using `safeHandleError`.
* **Application Services & Business Logic**: Any component needing to publish information or react to occurrences without direct coupling uses the `CoreEventBus`.

## 5. Overall Eventing Flow Diagram

**Eventing System**: Overall Event Flow

```mermaid
graph TD
    subgraph EventBusSystem_Facade [EventBusSystem Facade]
        direction LR
        EBS_State[("this.state (System)")]
        EBS_CEBInst(["Managed CoreEventBus Instance"])
    end

    subgraph CoreEventBus_Engine [CoreEventBus Engine]
        direction TB
        CEB_State[("this.state (Bus)")]
        CEB_Queues[("Queues Map")]
        CEB_History[("History Map")]
        CEB_Subscriptions[("Subscriptions Map")]
        CEB_WildcardLogic["Wildcard/Pattern Logic"]
    end
    
    EventBusSystem_Facade -- Manages/Creates & Initializes --> CoreEventBus_Engine;

    AppModuleA["App Module A (Emitter)"] -- "1. getEventBus()" --> EventBusSystem_Facade;
    EventBusSystem_Facade -- "2. Returns instance" --> AppModuleA;
    AppModuleA -- "3. coreEventBus.emit('eventX', data, options)" --> CoreEventBus_Engine;
    
    CoreEventBus_Engine -- "4. Create Event Object" --> StandardEvent["{id, name, data, ts, meta}"];
    StandardEvent -- "5. Track History" --> CEB_History;
    StandardEvent -- "6. Queue if options.queue" --> CEB_Queues;
    
    alt Direct Emission (Not Queued)
        StandardEvent -- "7. Find Subscribers" --> CEB_Subscriptions;
        CEB_Subscriptions -- "8. Match 'eventX' (Direct/Pattern/Wildcard)" --> CEB_WildcardLogic;
        CEB_WildcardLogic -- "9. Invoke Handler" --> HandlerB["AppModuleB.onEventX(eventObject)"];
        HandlerB -- "10. Processes Event" --> LogicB["Module B Logic Executed"];
    else Queued Event
        CEB_Queues -- Later via processQueue() --> StandardEvent; 
        StandardEvent -- "Re-enters Emission Flow (steps 7-10)" --> CEB_Subscriptions;
    end

    HandlerB -- "Optional: Reports Error via coreEventBus.handleError()" --> CoreEventBus_Engine;
    CoreEventBus_Engine -- "Forwards error via safeHandleError" --> ErrorSystemGlobal["ErrorSystem"];


    classDef stateNode fill:#f9f,stroke:#333,stroke-width:2px;
    classDef component fill:#D6EAF8,stroke:#5DADE2,stroke-width:2px;
    classDef appComp fill:#E8F8F5,stroke:#76D7C4,stroke-width:2px;

    class EBS_State, CEB_State, CEB_Queues, CEB_History, CEB_Subscriptions stateNode;
    class EventBusSystem_Facade, CoreEventBus_Engine component;
    class AppModuleA, HandlerB, LogicB, ErrorSystemGlobal appComp;
```

## 6. Usage Examples & Best Practices

### 6.1. Emitting an Event
(From a `CoreModule` subclass or any component with access to `CoreEventBus`)

**CoreEventBus**: Emitting an Event Example

```javascript
// Assuming 'eventBus' is an instance of CoreEventBus obtained via eventBusSystem.getEventBus()
// import { ErrorCodes } from '../core/errors/ErrorCodes.js'; // If emitting specific error codes

// async function publishUserCreation(userData) {
//   try {
//     const eventName = 'user.created'; // Consistent event name
//     const data = {
//       userId: userData.id,
//       username: userData.username,
//       email: userData.email,
//       registrationDate: new Date().toISOString()
//     };
//     const options = {
//       metadata: {
//         source: 'UserModule', // Or specific service name
//         correlationId: 'some-request-id-123' // For tracing
//       }
//       // To queue this event:
//       // queue: true,
//       // immediate: false, // Process queue later via processQueue('user.created')
//     };

//     const wasEmittedOrQueued = await eventBus.emit(eventName, data, options);

//     if (wasEmittedOrQueued) {
//       console.log(`Event '${eventName}' emitted/queued successfully.`);
//     } else {
//       // This might indicate no direct listeners if not queued,
//       // though emit itself usually doesn't throw for no listeners.
//       console.warn(`Event '${eventName}' had no direct listeners (if not queued).`);
//     }
//   } catch (error) {
//     // This catch block is for errors from the eventBus.emit() process itself
//     // (e.g., invalid eventName, internal history/queueing error),
//     // NOT for errors thrown by event listeners.
//     console.error(`Failed to emit event: ${error.message}`, error);
//     // Potentially report this critical failure to ErrorSystem if eventBus.emit itself fails
//     // await errorSystem.handleError(error, { operation: 'publishUserCreationEvent' });
//   }
// }

// // Example usage:
// // publishUserCreation({ id: 'usr_456', username: 'bob_the_builder', email: 'bob@example.com' });
```

### 6.2. Subscribing to Events (Exact, Pattern, Wildcard)
(Typically within a `CoreModule`'s `setupEventHandlers` method)

**CoreEventBus**: Subscription Examples

```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming INVENTORY_EVENTS and USER_EVENTS are imported objects with event name constants

// // --- Example 1: Subscribing to an exact event name ---
// const userCreatedSubId = eventBus.subscribe(
//   USER_EVENTS.CREATED, // e.g., 'user.created'
//   async (event) => { // Handler receives the full standard event object
//     console.log(`[UserCreationHandler] Received event: ${event.name} (ID: ${event.id})`);
//     console.log('User Data:', event.data);
//     console.log('Metadata:', event.metadata);
//     // Perform actions like sending a welcome email, setting up user profile, etc.
//     try {
//       // await welcomeEmailService.sendWelcomeEmail(event.data.email);
//     } catch (error) {
//       // Report errors from within the handler
//       await eventBus.handleError(error, {
//         handler: 'UserCreationHandler',
//         eventId: event.id,
//         eventName: event.name
//       });
//     }
//   }
// );
// // To unsubscribe later (e.g., in a module's onShutdown):
// // eventBus.unsubscribe(userCreatedSubId);


// // --- Example 2: Subscribing to a pattern (e.g., all item events in inventory) ---
// const inventoryItemSubId = eventBus.subscribe(
//   'inventory.item.*', // Matches inventory.item.added, inventory.item.updated, etc.
//   async (event) => { // Handler receives the full standard event object
//     console.log(`[InventoryItemEventHandler] Received event: ${event.name} (ID: ${event.id})`);
//     // event.name will be the specific event like 'inventory.item.added'
//     switch (event.name) {
//       case INVENTORY_EVENTS.ITEM_ADDED:
//         // console.log('Item Added:', event.data);
//         break;
//       case INVENTORY_EVENTS.STOCK_UPDATED:
//         // console.log('Stock Updated:', event.data);
//         break;
//       // default:
//         // console.log('Unhandled inventory item event:', event.name);
//     }
//   }
// );


// // --- Example 3: Subscribing to all events (global wildcard) ---
// const allEventsSubId = eventBus.subscribe(
//   '*', // Global wildcard
//   async (event) => { // Handler receives the full standard event object
//     // This can be very verbose, use with caution for debugging or specific auditing.
//     console.log(`[GlobalAuditLogger] Event Received - Name: ${event.name}, ID: ${event.id}, Timestamp: ${event.timestamp}`);
//     // console.log(`Data:`, event.data);
//     // console.log(`Metadata:`, event.metadata);
//   }
// );

// Remember: Handlers should be async if they perform asynchronous operations.
// The CoreEventBus (specifically for queue processing) expects handlers might be async.
```

### 6.3. Using Event Queuing

**CoreEventBus**: Event Queuing Example

```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming 'logger' is available

// async function sendBatchNotifications(notifications) {
//   for (const notification of notifications) {
//     try {
//       // Queue the notification event for sending
//       await eventBus.emit(
//         'notification.send', // Event name, also serves as queue name
//         notification,        // e.g., { userId, message, type: 'email' }
//         {
//           queue: true,       // Enable queuing for this event
//           immediate: false,  // Don't process immediately, let a worker/timer do it
//           metadata: { priority: 'low' }
//         }
//       );
//       logger.info(`Notification queued for user: ${notification.userId}`);
//     } catch (error) {
//       // Handle error from the emit/queueing process itself
//       logger.error(`Failed to queue notification for user ${notification.userId}: ${error.message}`);
//       // Potentially report this to ErrorSystem
//       // await errorSystem.handleError(error, { operation: 'queueNotification' });
//     }
//   }
// }

// // --- Later, in a separate worker or a scheduled task ---
// async function processNotificationQueue() {
//   logger.info('Starting to process notification queue...');
//   try {
//     const processedCount = await eventBus.processQueue('notification.send');
//     if (processedCount > 0) {
//       logger.info(`Processed ${processedCount} notifications from the queue.`);
//     } else {
//       logger.info('Notification queue was empty or no new items processed in this batch.');
//     }
//   } catch (error) {
//     // Handle error from the processQueue operation itself (not handler errors)
//     logger.error(`Error during notification queue processing: ${error.message}`);
//     // await errorSystem.handleError(error, { operation: 'processNotificationQueue' });
//   }
// }

// // Example: Queue some notifications
// // await sendBatchNotifications([
// //   { userId: 'user1', message: 'Your order has shipped!' },
// //   { userId: 'user2', message: 'Your subscription is about to renew.' }
// // ]);

// // Example: Process the queue (e.g., called by a cron job or after a certain interval)
// // setInterval(async () => {
// //   await processNotificationQueue();
// // }, 60000); // Process every minute

// // --- Handler for 'notification.send' (subscribed elsewhere) ---
// // eventBus.subscribe('notification.send', async (event) => {
// //   const notificationData = event.data;
// //   logger.info(`Handler invoked for 'notification.send': Sending to ${notificationData.userId}`);
// //   try {
// //     // await actualEmailOrPushNotificationService.send(notificationData);
// //     logger.info(`Notification successfully sent to ${notificationData.userId}`);
// //   } catch (handlerError) {
// //     logger.error(`Handler for 'notification.send' failed for user ${notificationData.userId}: ${handlerError.message}`);
// //     // Report error from within the handler using CoreEventBus's public handleError
// //     await eventBus.handleError(handlerError, {
// //       handler: 'NotificationSendHandler',
// //       eventId: event.id,
// //       notificationData
// //     });
// //     // Depending on policy, you might want to re-queue or move to a dead-letter queue
// //   }
// // });
```

### 6.4. Accessing Event History

**CoreEventBus**: Accessing Event History Example

```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming 'logger' is available

// async function inspectRecentUserEvents() {
//   const eventName = 'user.created';
//   try {
//     // Get the last 5 'user.created' events
//     const recentUserCreations = eventBus.getHistory(eventName, { limit: 5 });

//     if (recentUserCreations.length > 0) {
//       logger.info(`Last ${recentUserCreations.length} '${eventName}' events:`);
//       recentUserCreations.forEach(event => {
//         logger.info(`  ID: ${event.id}, Timestamp: ${event.timestamp}, Data: ${JSON.stringify(event.data)}`);
//       });
//     } else {
//       logger.info(`No recent history found for event '${eventName}'.`);
//     }

//     // Get all history for all events (potentially very large, use with caution or limits)
//     // const allHistory = eventBus.getAllHistory({ limit: 2 }); // Get last 2 events for each event type
//     // logger.info('Sample of all event history (last 2 per type):');
//     // for (const [name, events] of Object.entries(allHistory)) {
//     //   logger.info(`  Event Type: ${name}`);
//     //   events.forEach(event => {
//     //     logger.info(`    ID: ${event.id}, Timestamp: ${event.timestamp}`);
//     //   });
//     // }

//   } catch (error) {
//     // Handle error from getHistory or getAllHistory methods themselves
//     logger.error(`Failed to retrieve event history: ${error.message}`);
//     // await errorSystem.handleError(error, { operation: 'inspectRecentUserEvents' });
//   }
// }

// // Example: After some 'user.created' events have been emitted...
// // await eventBus.emit('user.created', { userId: 'user001', name: 'Alice' });
// // await eventBus.emit('user.created', { userId: 'user002', name: 'Bob' });
// // ...
// // inspectRecentUserEvents();
```

### 6.5. Error Handling in Event Listeners

**CoreEventBus**: Error Handling within Event Listeners

```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming 'logger' and 'ErrorSystem' (or a way to report to it) are available

// // Example event listener (subscriber handler)
// const orderProcessingSubId = eventBus.subscribe(
//   'order.created',
//   async (event) => { // Handler receives the full standard event object
//     logger.info(`[OrderProcessor] Processing order ID: ${event.data.orderId}, Event ID: ${event.id}`);
//     try {
//       const orderData = event.data;
//       // Simulate some processing that might fail
//       if (orderData.totalAmount <= 0) {
//         // For business rule violations, throw a specific CoreError subclass
//         throw new ValidationError(
//           ErrorCodes.VALIDATION.INVALID_INPUT, // Assuming this specific code exists
//           'Order total amount must be greater than zero.',
//           { orderId: orderData.orderId, totalAmount: orderData.totalAmount }
//         );
//       }

//       if (orderData.isFraudulent) { // Simulate another potential error
//         throw new Error("Simulated critical processing error for fraudulent order.");
//       }

//       // ... successful processing logic ...
//       logger.info(`[OrderProcessor] Successfully processed order ID: ${event.data.orderId}`);
//       // await someOtherService.finalizeOrder(orderData.orderId);

//     } catch (error) {
//       logger.error(`[OrderProcessor] Error handling event '${event.name}' (ID: ${event.id}): ${error.message}`);
//       // Report the error using CoreEventBus's public handleError method.
//       // This ensures the error is processed by the central ErrorSystem.
//       await eventBus.handleError(error, {
//         handlerName: 'OrderCreatedHandler',
//         eventName: event.name,
//         eventId: event.id,
//         eventDataSummary: { orderId: event.data.orderId, customerId: event.data.customerId } // Example context
//       });

//       // Depending on the error and system design, you might:
//       // - Let the error propagate (if not an async handler and not caught by event bus queue processing)
//       // - Emit a specific failure event (e.g., 'order.processing.failed')
//       // - Retry the operation (with caution, implement backoff/limits)
//       // - Move the event to a dead-letter queue (if using advanced queuing)
//     }
//   }
// );

// // Example of how an error reported by a listener might be handled by ErrorSystem:
// // errorSystem.registerHandler('ValidationError', async (validationError, context) => {
// //   logger.warn(`[GlobalValidationErrorHandler] Caught by ErrorSystem: ${validationError.message}`, {
// //     code: validationError.code,
// //     details: validationError.details,
// //     contextFromListener: context
// //   });
// //   // Maybe send to a specific channel or metrics system
// // });
```

**Best Practices:**
* **Obtain `CoreEventBus` via `EventBusSystem`**: Don't attempt to create standalone `CoreEventBus` instances; use the centrally managed one.
* **Clear Event Naming**: Use the `domain.entity.action` convention from `NamingConventions`. Define event name constants (e.g., in `module.events.js`).
* **Immutable Event Data**: Treat `event.data` as immutable within handlers.
* **Idempotent Handlers**: Design handlers to be idempotent if they might process the same logical event more than once (especially with queues or potential retries).
* **Focused Handlers**: Keep event handlers focused on a single responsibility. Complex logic should be delegated to services.
* **Unsubscribe**: In components with a lifecycle (like `CoreModule`), always `unsubscribe` from events in their shutdown/cleanup phase to prevent memory leaks.
* **Contextual Error Reporting**: When using `coreEventBus.handleError()` in a listener, provide rich context.
* **Queuing Strategy**: Use queuing for non-critical events or tasks that can be deferred to improve immediate responsiveness. Have a strategy for processing queues.

## 7. Testing Strategy Notes
* **`CoreEventBus`**:
    * Test `emit` with and without listeners, with and without queuing.
    * Test `subscribe` for exact, pattern, and wildcard matches, ensuring handlers receive the correct standardized event object. Test `unsubscribe`.
    * Test `queueEvent`, `processQueue` (including batching and error handling in listeners during processing), `processAllQueues`.
    * Test `trackEvent`, `getHistory`, `getAllHistory`, and `maxHistorySize` enforcement.
    * Test `reset()` and `shutdown()` for complete cleanup.
    * Test `handleError` correctly forwards to a mock `ErrorSystem`.
    * Test internal error handling (`_handleInternalError`) paths.
    * Verify all metrics and health check outputs.
* **`EventBusSystem`**:
    * Test `initialize` correctly creates and initializes `CoreEventBus`.
    * Test `getEventBus()` returns the correct instance or throws if not ready.
    * Test `shutdown()` correctly calls `CoreEventBus.shutdown()`.
    * Test event forwarding logic from `CoreEventBus` to `EventBusSystem` listeners if specific forwarding rules are maintained beyond lifecycle.
    * Verify its own lifecycle, health, metrics, and internal error handling.

## 8. Future Considerations & Potential Enhancements
(Drawn from `event-bus-docs.md` and broader EDA patterns)
* **Advanced Event Routing**: Introduce topic-based routing, content-based filtering, or even a dedicated message broker for more complex scenarios.
* **Event Schema Validation**: Implement schema validation for event payloads (e.g., using JSON Schema) upon emission or before handler invocation to ensure data integrity.
* **Event Versioning**: Support for versioning event schemas to manage changes over time without breaking existing subscribers.
* **Dead Letter Queues (DLQ)**: For events that consistently fail processing in queues, move them to a DLQ for later inspection and manual intervention.
* **Event Persistence & Sourcing**: Option to durably store all events, enabling event replay, auditing, and event sourcing patterns.
* **Distributed Event Bus**: For microservice architectures or distributed deployments, integrate or evolve towards a distributed event bus solution (e.g., Kafka, RabbitMQ, NATS) that ensures reliable cross-service communication.
* **Enhanced Observability**: Integrate event flows with distributed tracing systems for better end-to-end visibility of asynchronous operations.
* **Transactional Outbox Pattern**: For ensuring atomicity between database state changes and event emissions.