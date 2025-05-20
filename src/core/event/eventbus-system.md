# TSMIS EventBusSystem & CoreEventBus Documentation
Version: 2.1.0 (Refactored Core)

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
* **Observability**: Offers built-in features for history, health monitoring, and metrics related to event processing[cite: 2479].

### 1.2. Key Components: `EventBusSystem` and `CoreEventBus`
* **`CoreEventBus.js`**: This is the engine of the eventing system. It extends Node.js's `EventEmitter` and provides core functionalities like emitting events with a standard structure, managing subscriptions (exact, pattern, wildcard), optional event queuing, and event history. It adheres to TSMIS core standardization pillars.
* **`EventBusSystem.js`**: This system acts as a managing facade for `CoreEventBus`. Its responsibilities include lifecycle management of `CoreEventBus`, providing controlled access (`getEventBus()`), and integrating the eventing subsystem into the application's standard monitoring frameworks.
Application components primarily interact with the `CoreEventBus` instance obtained via `EventBusSystem.getEventBus()`.

---
## 2. Component: `CoreEventBus.js` - The Eventing Engine

### 2.1. Overview & Primary Responsibility
`CoreEventBus` is the central workhorse for event management in TSMIS. It provides robust implementation for emitting events, managing complex subscription patterns, queuing events, and maintaining event history, ensuring all events adhere to a standard structure.

### 2.2. Key Functionalities & API (`CoreEventBus`)

#### 2.2.1. Standard Event Object Structure
All events are wrapped in a standard object:
**CoreEventBus**: Standard Event Object Structure Example
```javascript
// {
//   id: "a1b2c3d4-e5f6-7890-1234-567890abcdef", // Unique event ID (e.g., UUID)
//   name: "user.created",                         // The original emitted eventName
//   data: {                                     // The event payload/data
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

#### 2.2.2. `emit(eventName: string, data: any, options = {}): Promise<boolean>`
Publishes events.
* **`eventName`**: Event identifier (e.g., `user.created`)[cite: 2498].
* **`data`**: Event payload.
* **`options`**: Can include `queue: boolean`, `immediate: boolean`, `metadata: object`.
* Wraps into standard event object, tracks history, records metrics, handles queuing or direct emission.
* **Returns**: `Promise<boolean>` (emitted/queued).
* **Throws**: `EventError` (using an unprefixed code from `ErrorCodes.EVENT` like `'INVALID_EVENT_NAME'` or `'EMISSION_FAILED'`) for issues[cite: 2505].

#### 2.2.3. `subscribe(pattern: string, handler: Function, options = {}): string`
Registers a handler for events matching `pattern` (exact, wildcard, global `*`).
* **`handler`**: `async function(event: object)` receiving the full standard event object.
* **Returns**: Unique `subscriptionId`.
* **Throws**: `EventError` (using unprefixed codes like `'INVALID_PATTERN'` or `'INVALID_HANDLER'`) for invalid arguments[cite: 2510].

#### 2.2.4. `unsubscribe(subscriptionId: string): boolean`
Removes a subscription.
* **Returns**: `true` if removed, `false` otherwise.

#### 2.2.5. Event Queuing (`queueEvent`, `processQueue`, `processAllQueues`)
* **`async queueEvent(event: object, options = {}): Promise<boolean>`**: Internally used by `emit` for queuing.
* **`async processQueue(queueName: string): Promise<number>`**: Processes a batch of events from a queue, emitting them. Errors in handlers are reported via `this.handleError()`.
* **`async processAllQueues(): Promise<object>`**: Processes all queues.

#### 2.2.6. Event History (`trackEvent`, `getHistory`, `getAllHistory`)
* **`trackEvent(event: object)`**: Automatically called by `emit` to add to in-memory, capped history per event name. Max size from `config.eventBus.maxHistorySize`.
* **`getHistory(eventName: string, options = { limit?: number }): Array<object>`**: Retrieves history for an event name.
* **`getAllHistory(options = { limit?: number }): object`**: Retrieves history for all event names[cite: 2519].

#### 2.2.7. `async handleError(error: Error, context = {}): Promise<void>`
Public method for event *listeners* to report their errors to `ErrorSystem` via `safeHandleError`.

#### 2.2.8. `async reset(): Promise<void>`
Clears queues, history, and application-level listeners/subscriptions. Disables wildcard forwarding.

### 2.3. Wildcard and Pattern Subscription Details
All event handlers receive a single argument: the full, standardized event object. `CoreEventBus` dynamically manages wildcard (`*`) forwarding by wrapping its native `emit` method. Pattern subscriptions (e.g., `item.*`) internally listen on `*` and filter based on `event.name`.

### 2.4. State Management (`CoreEventBus` Specifics)
Implements standard `this.state`. Operational data:
* `this.queues: Map<string, Array<object>>`
* `this.subscriptions: Map<string, object>`
* `this.history: Map<string, Array<object>>` [cite: 2534]
* `this.maxHistorySize: number`
* `this._originalEmit: Function | null`
* `this._processingNewListener: boolean` [cite: 2536]

### 2.5. Lifecycle Management (`CoreEventBus` Specifics)
* **`async initialize()`**: Sets up initial state. Wildcard forwarding driven by `newListener`/`removeListener`. Emits lifecycle events[cite: 2538].
* **`async shutdown()`**: Calls `reset()`, removes all listeners. Emits/logs lifecycle events[cite: 2539].

### 2.6. Error Handling within `CoreEventBus`
* Uses `_handleInternalError` for its own operational errors (throws `EventError` with unprefixed codes like `'INTERNAL_ERROR'`).
* Catches errors from handlers in `processQueue`, reports via `this.handleError()`.

### 2.7. Health Monitoring (`CoreEventBus` Specifics)
Provides `checkHealth()`. Default checks:
* **`eventbus.state`**: Lifecycle `status`, uptime, internal error count[cite: 2545].
* **`eventbus.queues`**: Queue counts and total events.
* **`eventbus.subscriptions`**: Subscription count and patterns[cite: 2546].

### 2.8. Metrics Tracking (`CoreEventBus` Specifics)
Records detailed metrics for lifecycle, errors, operations (wildcard, emit, queue, subscribe, history, reset).

### 2.9. Static Factory (`createEventBus`)
**`createEventBus(deps = {}): CoreEventBus`** for instantiation.

---
## 3. Component: `EventBusSystem.js` - The Managing Facade

### 3.1. Overview & Primary Responsibility
`EventBusSystem` manages the `CoreEventBus` instance, handling its lifecycle, providing controlled access (`getEventBus()`), and integrating eventing subsystem's monitoring into TSMIS standards.

### 3.2. Key Functionalities & API (`EventBusSystem`)

#### 3.2.1. `async initialize(): Promise<EventBusSystem>`
Validates dependencies, creates and initializes `CoreEventBus`, sets up event forwarding.

#### 3.2.2. `getEventBus(): CoreEventBus`
Primary method for components to get the `CoreEventBus` instance. Throws `EventError` (with unprefixed code `'NOT_INITIALIZED'`) if not running.

#### 3.2.3. `async emit(eventName, ...args)`
Primarily for `EventBusSystem`'s own lifecycle events. Forwards other non-system events to managed `CoreEventBus`. Apps should use `getEventBus().emit()`[cite: 2560].

#### 3.2.4. `async shutdown(): Promise<EventBusSystem>`
Manages `CoreEventBus.shutdown()` and cleans up its own resources.

### 3.3. Adherence to Standardization Pillars (Recap for `EventBusSystem`)
* **State Management**: Standard `this.state`, `eventBus` instance, `_forwardingInitialized` flag.
* **Lifecycle Management**: Manages its own and `CoreEventBus` lifecycle. Emits `LIFECYCLE_EVENTS`.
* **Error Handling**: `_handleInternalError` for own errors (throws `EventError` with unprefixed codes), reports via `safeHandleError`.
* **Health Monitoring**: `checkHealth()` aggregates its state with `CoreEventBus` health.
* **Metrics Tracking**: Records metrics for own lifecycle and internal errors.
* **Factory Function**: `createEventBusSystem(deps = {})`[cite: 2567].

### 3.4. State Management (`EventBusSystem` Specifics)
(Covered by 3.3).

### 3.5. Lifecycle Management (`EventBusSystem` Specifics)
* **`initialize()`**: Instantiates and initializes `CoreEventBus`. Calls `setupEventForwarding()`[cite: 2568].
* **`shutdown()`**: Ensures `CoreEventBus.shutdown()` is called.

### 3.6. Error Handling within `EventBusSystem`
Uses `_handleInternalError` for its operational errors (e.g., `CoreEventBus` init failure), reporting to global `ErrorSystem`. Errors thrown are `EventError` using unprefixed codes from `ErrorCodes.EVENT`.

### 3.7. Event Integration (`EventBusSystem` Specifics - Forwarding)
`setupEventForwarding()` listens to `CoreEventBus` (`on('*', ...)`).
* May re-emit certain non-system events from `CoreEventBus` on `EventBusSystem` itself.
* Forwards specific `CoreEventBus` lifecycle events with a differentiating prefix (e.g., `coreEventBus:initialized`).

### 3.8. Health Monitoring (`EventBusSystem` Specifics)
Default health checks:
* **`eventbussystem.state`**: Its own lifecycle `status`, uptime, internal error count.
* **`eventbussystem.corebus`**: Calls `this.eventBus.checkHealth()` for `CoreEventBus`'s full report.

### 3.9. Metrics Tracking (`EventBusSystem` Specifics)
Key metrics[cite: 2575]:
* `eventbussystem.initialized.success/failure`
* `eventbussystem.shutdown.success/failure`
* `eventbussystem.errors.internal`

### 3.10. Static Factory (`createEventBusSystem`)
**`createEventBusSystem(deps = {}): EventBusSystem`** for instantiation[cite: 2576].

---
## 4. Integrations (Eventing System Level)
The Eventing System integrates with:
* **`ContainerSystem`**: Instantiates `EventBusSystem` and provides dependencies[cite: 2577].
* **`ModuleSystem` & `CoreModule`s**: `ModuleSystem` injects `EventBusSystem` into `CoreModule`s, which use `getEventBus()` for emitting and subscribing.
* **`RouterSystem` & `CoreRouter`**: `CoreRouter` subscribes to route events via `CoreEventBus`.
* **`ErrorSystem`**: Both `CoreEventBus` and `EventBusSystem` report errors to `ErrorSystem`.
* **Application Services & Business Logic**: Use `CoreEventBus` for decoupled communication.

---
## 5. Overall Eventing Flow Diagram
**Eventing System**: Overall Event Flow Diagram
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
    classDef appComp fill:#E8F8F5,stroke:#76D7C4,stroke-width:1px;
    class EBS_State, CEB_State, CEB_Queues, CEB_History, CEB_Subscriptions stateNode;
    class EventBusSystem_Facade, CoreEventBus_Engine component;
    class AppModuleA, HandlerB, LogicB, ErrorSystemGlobal appComp;
```

---
## 6. Usage Examples & Best Practices

### 6.1. Emitting an Event
(From a `CoreModule` or component with access to `CoreEventBus`)
**CoreEventBus**: Emitting an Event Example
```javascript
// Assuming 'eventBus' is an instance of CoreEventBus obtained via eventBusSystem.getEventBus()
// import { ErrorCodes } from '../core/errors/ErrorCodes.js'; // For example errors
// import { EventError } from '../core/errors/index.js'; // For example errors

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
//       // This might indicate no direct listeners if not queued.
//       console.warn(`Event '${eventName}' had no direct listeners (if not queued).`);
//     }
//   } catch (error) {
//     // This catch block is for errors from the eventBus.emit() process itself
//     // (e.g., invalid eventName, internal history/queueing error),
//     // NOT for errors thrown by event listeners.
//     // error.code here would be a prefixed code like 'EVENT_INVALID_EVENT_NAME'
//     console.error(`Failed to emit event: [${error.code}] ${error.message}`, error);
//     // Example: if (error.code === `EVENT_${ErrorCodes.EVENT.INVALID_EVENT_NAME}`) { /* ... */ }
//     // Potentially report this critical failure to ErrorSystem
//     // await errorSystem.handleError(error, { operation: 'publishUserCreationEvent' });
//   }
// }

// // Example usage:
// // publishUserCreation({ id: 'usr_456', username: 'bob_the_builder', email: 'bob@example.com' });
```

### 6.2. Subscribing to Events (Exact, Pattern, Wildcard)
(Typically in `CoreModule.setupEventHandlers`)
**CoreEventBus**: Subscription Examples
```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming INVENTORY_EVENTS and USER_EVENTS are imported objects with event name constants
// e.g., const USER_EVENTS = { CREATED: 'user.created' };
// e.g., const INVENTORY_EVENTS = { ITEM_ADDED: 'inventory.item.added', STOCK_UPDATED: 'inventory.item.stock_updated' };
// import { EventError } from '../core/errors/index.js';
// import { ErrorCodes } from '../core/errors/ErrorCodes.js';

// // --- Example 1: Subscribing to an exact event name ---
// const userCreatedSubId = eventBus.subscribe(
//   USER_EVENTS.CREATED, // e.g., 'user.created'
//   async (event) => { // Handler receives the full standard event object
//     console.log(`[UserCreationHandler] Received event: ${event.name} (ID: ${event.id})`);
//     console.log('User Data:', event.data);
//     console.log('Metadata:', event.metadata);
//     try {
//       // await welcomeEmailService.sendWelcomeEmail(event.data.email);
//     } catch (error) {
//       // Report errors from within the handler
//       // Example of creating a new EventError if needed, or passing the caught error directly
//       const handlerError = error instanceof EventError ? error : new EventError(
//           ErrorCodes.EVENT.HANDLER_ERROR, // Using unprefixed code from ErrorCodes.EVENT
//           `Handler UserCreationHandler failed: ${error.message}`,
//           { originalErrorName: error.name },
//           { cause: error }
//       );
//       await eventBus.handleError(handlerError, {
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
//     console.log(`[GlobalAuditLogger] Event Received - Name: ${event.name}, ID: ${event.id}, Timestamp: ${event.timestamp}`);
//   }
// );
```

### 6.3. Using Event Queuing
**CoreEventBus**: Event Queuing Example
```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming 'logger' is available
// import { ErrorCodes } from '../core/errors/ErrorCodes.js'; // For example errors
// import { EventError } from '../core/errors/index.js'; // For example errors


// async function sendBatchNotifications(notifications) {
//   for (const notification of notifications) {
//     try {
//       await eventBus.emit(
//         'notification.send', // Event name, also serves as queue name
//         notification,        // e.g., { userId, message, type: 'email' }
//         {
//           queue: true,       // Enable queuing for this event
//           immediate: false,  // Don't process immediately
//           metadata: { priority: 'low' }
//         }
//       );
//       // logger.info(`Notification queued for user: ${notification.userId}`);
//     } catch (error) {
//       // Handle error from the emit/queueing process itself
//       // error.code would be prefixed, e.g., EVENT_QUEUE_OPERATION_FAILED
//       logger.error(`Failed to queue notification for user ${notification.userId}: [${error.code}] ${error.message}`);
//       // Example: if (error.code === `EVENT_${ErrorCodes.EVENT.QUEUE_OPERATION_FAILED}`) { /* ... */ }
//       // await errorSystem.handleError(error, { operation: 'queueNotification' });
//     }
//   }
// }

// // --- Later, in a separate worker or a scheduled task ---
// async function processNotificationQueue() {
//   // logger.info('Starting to process notification queue...');
//   try {
//     const processedCount = await eventBus.processQueue('notification.send');
//     // if (processedCount > 0) {
//     //   logger.info(`Processed ${processedCount} notifications from the queue.`);
//     // } else {
//     //   logger.info('Notification queue was empty or no new items processed in this batch.');
//     // }
//   } catch (error) {
//     // Handle error from the processQueue operation itself (not handler errors)
//     // error.code would be prefixed, e.g., EVENT_QUEUE_PROCESSING_FAILED
//     logger.error(`Error during notification queue processing: [${error.code}] ${error.message}`);
//     // await errorSystem.handleError(error, { operation: 'processNotificationQueue' });
//   }
// }

// // --- Handler for 'notification.send' (subscribed elsewhere) ---
// // eventBus.subscribe('notification.send', async (event) => {
// //   const notificationData = event.data;
// //   logger.info(`Handler invoked for 'notification.send': Sending to ${notificationData.userId}`);
// //   try {
// //     // await actualEmailOrPushNotificationService.send(notificationData);
// //     // logger.info(`Notification successfully sent to ${notificationData.userId}`);
// //   } catch (handlerError) {
// //     logger.error(`Handler for 'notification.send' failed for user ${notificationData.userId}: ${handlerError.message}`);
// //     // Report error from within the handler using CoreEventBus's public handleError
// //     // The handlerError might be a generic Error, or a specific CoreError subclass.
// //     // handleError will ensure it's reported to ErrorSystem.
// //     await eventBus.handleError(handlerError, {
// //       handler: 'NotificationSendHandler',
// //       eventId: event.id,
// //       notificationData
// //     });
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
//   } catch (error) {
//     // Handle error from getHistory or getAllHistory methods themselves
//     // (These methods themselves don't typically throw unless there's an unexpected internal state corruption)
//     logger.error(`Failed to retrieve event history: ${error.message}`);
//     // await errorSystem.handleError(error, { operation: 'inspectRecentUserEvents' });
//   }
// }
```
### 6.5. Error Handling in Event Listeners
**CoreEventBus**: Error Handling within Event Listeners
```javascript
// Assuming 'eventBus' is an instance of CoreEventBus
// Assuming 'logger' and 'ErrorSystem' (or a way to report to it) are available
// import { ErrorCodes } from '../core/errors/ErrorCodes.js';
// import { ValidationError } from '../core/errors/types/ValidationError.js'; // If throwing specific types

// // Example event listener (subscriber handler)
// const orderProcessingSubId = eventBus.subscribe(
//   'order.created',
//   async (event) => { // Handler receives the full standard event object
//     logger.info(`[OrderProcessor] Processing order ID: ${event.data.orderId}, Event ID: ${event.id}`);
//     try {
//       const orderData = event.data;
//       if (orderData.totalAmount <= 0) {
//         // For business rule violations, throw a specific CoreError subclass
//         // ErrorCodes.VALIDATION.INVALID_INPUT is 'INVALID_INPUT'
//         throw new ValidationError(
//           ErrorCodes.VALIDATION.INVALID_INPUT, 
//           'Order total amount must be greater than zero.',
//           { 
//             validationErrors: [{ field: 'totalAmount', message: 'Must be positive' }],
//             orderId: orderData.orderId, 
//             totalAmount: orderData.totalAmount 
//           }
//         );
//         // The error.code on this instance will be 'VALIDATION_INVALID_INPUT'
//       }

//       if (orderData.isFraudulent) { // Simulate another potential error
//         throw new Error("Simulated critical processing error for fraudulent order.");
//       }
//       // ... successful processing logic ...
//       logger.info(`[OrderProcessor] Successfully processed order ID: ${event.data.orderId}`);
//     } catch (error) {
//       logger.error(`[OrderProcessor] Error handling event '${event.name}' (ID: ${event.id}): ${error.message}`);
//       // Report the error using CoreEventBus's public handleError method.
//       // This ensures the error is processed by the central ErrorSystem.
//       // If 'error' is not already a CoreError, handleError will wrap it.
//       await eventBus.handleError(error, {
//         handlerName: 'OrderCreatedHandler',
//         eventName: event.name,
//         eventId: event.id,
//         eventDataSummary: { orderId: event.data.orderId, customerId: event.data.customerId }
//       });
//     }
//   }
// );
```
**Best Practices:**
* Obtain `CoreEventBus` via `EventBusSystem`.
* Clear event naming (e.g., `domain.entity.action`).
* Treat event data as immutable in handlers.
* Idempotent handlers.
* Focused handlers; delegate complex logic.
* Unsubscribe in component shutdown to prevent memory leaks.
* Provide rich context when reporting listener errors via `coreEventBus.handleError()`.
* Use queuing strategically.

---
## 7. Testing Strategy Notes
* **`CoreEventBus`**:
    * Test `emit` (with/without listeners/queuing), `subscribe` (exact, pattern, wildcard, handler signature), `unsubscribe`.
    * Test queuing (`queueEvent`, `processQueue` batching & listener error handling), `processAllQueues`.
    * Test history (`trackEvent`, `getHistory`, `getAllHistory`, `maxHistorySize`).
    * Test `reset()`, `shutdown()`.
    * Test `handleError` forwarding. Test internal error handling. Verify metrics & health.
* **`EventBusSystem`**:
    * Test `initialize` creates/inits `CoreEventBus`. Test `getEventBus()`. Test `shutdown()`.
    * Test event forwarding logic if maintained. Verify own lifecycle, health, metrics, errors.

---
## 8. Future Considerations & Potential Enhancements
(Drawn from `event-bus-docs.md` and broader EDA patterns)
* **Advanced Event Routing**: Topic/content-based routing, message broker integration.
* **Event Schema Validation**: Using JSON Schema for payloads.
* **Event Versioning**: Managing schema changes.
* **Dead Letter Queues (DLQ)**: For consistently failing events.
* **Event Persistence & Sourcing**: Durable storage, replay, event sourcing.
* **Distributed Event Bus**: For microservices (Kafka, RabbitMQ, NATS).
* **Enhanced Observability**: Integration with distributed tracing.
* **Transactional Outbox Pattern**: Atomicity for DB changes and event emissions.