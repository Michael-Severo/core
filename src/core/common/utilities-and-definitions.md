# TSMIS Core Utilities and Definitions Documentation
Version: 2.1.0 (Aligned with Core System Refactor v2.0.0)

## Table of Contents

1.  [Introduction](#1-introduction)
    * [1.1. Purpose of these Foundational Files](#11-purpose-of-these-foundational-files) [cite: 30]
    * [1.2. Location in Architecture](#12-location-in-architecture) [cite: 31]
2.  [Component: `SystemConstants.js` - Shared System Constants](#2-component-systemconstantsjs---shared-system-constants)
    * [2.1. Overview & Purpose](#21-overview--purpose) [cite: 32]
    * [2.2. Key Definitions](#22-key-definitions)
        * [2.2.1. `SYSTEM_STATUS`](#221-system_status) [cite: 33]
        * [2.2.2. `LIFECYCLE_EVENTS`](#222-lifecycle_events)
        * [2.2.3. `DEFAULT_CONFIG`](#223-default_config) [cite: 34]
    * [2.3. Usage Guidelines & Example](#23-usage-guidelines--example)
3.  [Component: `ErrorUtils.js` - Error Handling and Health Utilities](#3-component-errorutilsjs---error-handling-and-health-utilities)
    * [3.1. Overview & Purpose](#31-overview--purpose) [cite: 35]
    * [3.2. Key Functions](#32-key-functions)
        * [3.2.1. `async safeHandleError(errorSystem, error, context = {})`](#321-async-safehandleerrorerrorsystem-error-context---) [cite: 36]
        * [3.2.2. `createStandardHealthCheckResult(status, detail = {}, errors = [])`](#322-createstandardhealthcheckresultstatus-detail---errors---) [cite: 37]
    * [3.3. Usage Guidelines & Examples](#33-usage-guidelines--examples) [cite: 38]
4.  [Component: `ErrorCodes.js` - Standardized Error Identifiers](#4-component-errorcodesjs---standardized-error-identifiers)
    * [4.1. Overview & Purpose](#41-overview--purpose) [cite: 39]
    * [4.2. Structure and Naming Convention](#42-structure-and-naming-convention)
    * [4.3. Usage Guidelines](#43-usage-guidelines) [cite: 40]
    * [4.4. Integration with `CoreError` and `ErrorSystem`](#44-integration-with-coreerror-and-errorsystem)
    * [4.5. Example Snippet](#45-example-snippet) [cite: 41]
5.  [Overall Integration and Importance](#5-overall-integration-and-importance)
6.  [Testing Strategy Notes (for Utilities)](#6-testing-strategy-notes-for-utilities)
7.  [Future Considerations](#7-future-considerations)

---

## 1. Introduction

### 1.1. Purpose of these Foundational Files [cite: 30]
The TSMIS core architecture relies on a set of foundational utility files that provide shared constants, error handling helper functions, and a centralized registry of error codes. [cite: 42] These files are essential for ensuring consistency, reducing redundancy, and promoting robust behavior across all core systems and business modules. [cite: 43] This document details these key utilities: `SystemConstants.js`, `ErrorUtils.js`, and `ErrorCodes.js`. [cite: 44]

### 1.2. Location in Architecture [cite: 31]
* `SystemConstants.js` and `ErrorUtils.js` are typically located in `src/core/common/`. [cite: 45]
* `ErrorCodes.js` is located in `src/core/errors/`. [cite: 45]
These utilities are designed to have minimal dependencies and are used extensively by higher-level core systems and application modules. [cite: 46]

---
## 2. Component: `SystemConstants.js` - Shared System Constants

### 2.1. Overview & Purpose [cite: 32]
`SystemConstants.js` is the definitive source for shared, immutable constants that govern system-wide states (like component lifecycle statuses and health statuses), standard names for lifecycle events, and default fallback values for common configuration parameters. [cite: 47] Using these centralized constants prevents "magic strings" or "magic numbers," reduces the risk of typos, and makes global adjustments to these standard values straightforward. [cite: 48]

### 2.2. Key Definitions
All constant objects in this file are frozen using `Object.freeze()` to ensure their immutability. [cite: 49]

#### 2.2.1. `SYSTEM_STATUS` [cite: 33]
* **Definition**: An object containing standardized string values that represent the operational lifecycle status of core components (systems, modules) as well as the health status reported by health checks. [cite: 50]
* **Key Values Examples**: `CREATED`, `INITIALIZING`, `RUNNING`, `SHUTTING_DOWN`, `SHUTDOWN`, `ERROR`, `HEALTHY`, `DEGRADED`, `UNHEALTHY`. [cite: 51]
* **Primary Usage**:
    * Used within the `this.state.status` property of all core systems and `CoreModule` instances. [cite: 52]
    * The health-related statuses (`HEALTHY`, `DEGRADED`, `UNHEALTHY`) are used by health check functions and the `createStandardHealthCheckResult` utility. [cite: 53]

#### 2.2.2. `LIFECYCLE_EVENTS`
* **Definition**: An object that maps standard lifecycle phases of core components to consistent, globally unique event names. [cite: 54]
* **Key Values Examples**: `INITIALIZING: 'system:initializing'`, `INITIALIZED: 'system:initialized'`, `RUNNING: 'system:running'`, `SHUTTING_DOWN: 'system:shutting_down'`, `SHUTDOWN: 'system:shutdown'`, `ERROR: 'system:error'`. [cite: 55]
* **Primary Usage**:
    * Utilized by core systems and `CoreModule` instances when they emit events related to their own lifecycle transitions (e.g., `super.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: this.constructor.name })`). [cite: 56]
    * Modules also use these to create component-name-scoped lifecycle events (e.g., by appending their name: `LIFECYCLE_EVENTS.INITIALIZED + ':' + this.constructor.name.toLowerCase()`). [cite: 57]

#### 2.2.3. `DEFAULT_CONFIG` [cite: 34]
* **Definition**: An object providing default fallback values for common configurable parameters that might be used within core systems or modules if specific configuration is not explicitly provided by the application's configuration. [cite: 58]
* **Key Values Examples**:
    * `MAX_ERROR_HISTORY: 100` (Default capacity for internal error logs within components' `this.state.errors` array). [cite: 59]
    * `DEFAULT_HEALTH_CHECK_INTERVAL: 30000` (Default interval in milliseconds for periodic health checks, e.g., in `CoreModule.startHealthChecks()`). [cite: 60]
* **Primary Usage**: Core systems and modules can refer to these constants as default values when a specific configuration is missing from `this.deps.config` or a module's `this.config`. [cite: 61]

**`SystemConstants.js`: Definitions**
```javascript
// src/core/common/SystemConstants.js (Illustrative Content)

export const SYSTEM_STATUS = Object.freeze({
  CREATED: 'created',
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  SHUTTING_DOWN: 'shutting_down',
  SHUTDOWN: 'shutdown',
  ERROR: 'error',
  DEGRADED: 'degraded', // For health checks
  HEALTHY: 'healthy',   // For health checks
  UNHEALTHY: 'unhealthy' // For health checks
});

export const LIFECYCLE_EVENTS = Object.freeze({
  INITIALIZING: 'system:initializing',
  INITIALIZED: 'system:initialized',
  RUNNING: 'system:running',
  SHUTTING_DOWN: 'system:shutting_down',
  SHUTDOWN: 'system:shutdown',
  ERROR: 'system:error'
});

// Default configuration for common system aspects
export const DEFAULT_CONFIG = Object.freeze({
  MAX_ERROR_HISTORY: 100,
  DEFAULT_HEALTH_CHECK_INTERVAL: 30000, // ms
  DEFAULT_METRIC_FLUSH_INTERVAL: 60000 // ms (if applicable for a metrics system)
});
```


### 2.3. Usage Guidelines & Example
* **Import**: Always import the required constants or the entire constant objects from `SystemConstants.js` rather than redefining similar values elsewhere. [cite: 65]
* **Immutability**: Rely on the frozen nature of these objects; do not attempt to modify them at runtime. [cite: 66]
* **Extensibility**: If new system-wide standard statuses, lifecycle event types, or common default configurations are needed, they should be added to this central file. [cite: 67]

**Example**: Usage of SystemConstants.js
```javascript
// Example usage within a hypothetical core system component:
// import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from './src/core/common/SystemConstants.js'; // Adjust path

// class MySystem {
//   constructor(deps) {
//     this.deps = deps;
//     this.state = {
//       status: SYSTEM_STATUS.CREATED, // Using a constant for initial status
//       errors: [],
//       // ... other state properties
//     };
//     // Using a constant for a default configuration value
//     this.maxErrors = this.deps.config?.mySystem?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY;
//   }

//   async initialize() {
//     if (this.state.status === SYSTEM_STATUS.RUNNING) return; // Comparing with a constant
//     this.state.status = SYSTEM_STATUS.INITIALIZING; // Setting status with a constant
//
//     // Emitting a standardized lifecycle event
//     // if (this.emit) { // Assuming 'this' is an EventEmitter
//     //   this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: this.constructor.name });
//     // }

//     // ... initialization logic ...

//     this.state.status = SYSTEM_STATUS.RUNNING;
//     // if (this.emit) {
//     //   this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: this.constructor.name });
//     //   this.emit(LIFECYCLE_EVENTS.RUNNING, { system: this.constructor.name });
//     // }
//   }

//   // ... other methods
// }
```

---
## 3. Component: `ErrorUtils.js` - Error Handling and Health Utilities

### 3.1. Overview & Purpose [cite: 35]
`ErrorUtils.js` centralizes critical utility functions that support the standardized error handling and health reporting mechanisms of the TSMIS architecture. [cite: 79] These utilities ensure consistency and robustness in these cross-cutting concerns. [cite: 80]

### 3.2. Key Functions

#### 3.2.1. `async safeHandleError(errorSystem, error, context = {})` [cite: 36]
* **Purpose**: To provide a resilient and safe way to report errors to the application's central `ErrorSystem`. [cite: 81] Its primary safety feature is a fallback mechanism: if the provided `errorSystem` instance is unavailable, invalid, or if the `errorSystem.handleError()` call itself fails, `safeHandleError` guarantees that the error is still captured by logging it directly to `console.error` with comprehensive details. [cite: 82] This prevents critical errors from being silently lost. [cite: 83]
* **Parameters**:
    * `errorSystem: object | null | undefined`: An instance of the `ErrorSystem`. [cite: 84]
    * `error: Error`: The error object to handle (ideally a `CoreError` instance). [cite: 84]
    * `context: object` (optional, default: `{}`): Contextual information about the error (e.g., `source` component, operation name). [cite: 85]
* **Returns**: `Promise<void>`. [cite: 85]

#### 3.2.2. `createStandardHealthCheckResult(status, detail = {}, errors = [])` [cite: 37]
* **Purpose**: A factory function used to construct standardized health check result objects. [cite: 86] This ensures that all individual health checks throughout the application (whether in core systems or business modules) return their status information in a uniform structure. [cite: 87] This uniformity is vital for consistent aggregation, monitoring, and automated processing of health data. [cite: 88]
* **Parameters**:
    * `status: string`: The health status (must be one of `SYSTEM_STATUS.HEALTHY`, `SYSTEM_STATUS.UNHEALTHY`, `SYSTEM_STATUS.DEGRADED`). [cite: 89]
    * `detail: object` (optional, default: `{}`): Specific, arbitrary details relevant to the health check performed. [cite: 90]
    * `errors: Array<Error>` (optional, default: `[]`): An array of `Error` objects (preferably `CoreError` instances) encountered during the check that contributed to its status. [cite: 91] The utility formats these into a serializable `ErrorSummary` structure. [cite: 92]
* **Returns**: `object` - A health check result object: `{ status: string, detail: object, errors: Array<ErrorSummary> }`. [cite: 92]

**`ErrorUtils.js`: Key Function Definitions**
```javascript
// src/core/common/ErrorUtils.js (Illustrative Content of the functions)

/**
 * Safely handles an error by attempting to forward it to the ErrorSystem.
 * If ErrorSystem is unavailable or fails, it logs the error to the console.
 */
export async function safeHandleError(errorSystem, error, context = {}) {
  const source = context.source || 'UnknownSystem';
  if (!errorSystem || typeof errorSystem.handleError !== 'function') {
    console.error(
      `[${new Date().toISOString()}] Unhandled error in ${source} (ErrorSystem unavailable/invalid):`,
      {
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        errorCause: error.cause,
        context,
        stack: error.stack
      }
    );
    return;
  }

  try {
    await errorSystem.handleError(error, context);
  } catch (forwardingError) {
    console.error(
      `[${new Date().toISOString()}] Failed to forward error from ${source} to ErrorSystem:`,
      {
        originalErrorCode: error.code,
        originalErrorMessage: error.message,
        forwardingErrorCode: forwardingError.code,
        forwardingErrorMessage: forwardingError.message,
        context,
        originalErrorStack: error.stack,
        forwardingErrorStack: forwardingError.stack
      }
    );
  }
}

/**
 * Creates a standardized health check result object.
 */
export function createStandardHealthCheckResult(status, detail = {}, errors = []) {
  return {
    status,
    detail,
    errors: errors.map(err => ({ // Store a serializable summary of the error
      name: err.name,
      message: err.message,
      code: err.code,
      details: err.details,
      cause: err.cause ? { name: err.cause.name, message: err.cause.message, code: err.cause.code } : undefined
    }))
  };
}
```

### 3.3. Usage Guidelines & Examples [cite: 38]
* **`safeHandleError` Usage**: This should be the standard method by which core systems and `CoreModule` derivatives (typically within their `_handleInternalError` or public `handleError` methods) report errors to the central `ErrorSystem`. [cite: 101] Always provide meaningful `context`. [cite: 102]
* **`createStandardHealthCheckResult` Usage**: All individual health check functions (the `checkFn` passed to `registerHealthCheck`) must use this utility to format their return value. [cite: 102]

**`ErrorUtils.js`: Functions Usage**
```javascript
// Example usage within a hypothetical core system or module:
// import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js'; // Adjust path
// import { SYSTEM_STATUS } from '../common/SystemConstants.js'; // Adjust path
// import { CoreError } from '../errors/CoreError.js'; // Adjust path
// import { ErrorCodes } from '../errors/ErrorCodes.js'; // Adjust path
// import { ServiceError } from '../errors/types/ServiceError.js'; // Adjust path

// class MyComponent {
//   constructor(deps) {
//     this.deps = deps; // Should include errorSystem, logger, etc.
//     this.state = { errors: [] }; // Simplified state for example
//   }

//   async _handleInternalError(error, context = {}) { // Example internal error handler
//       const internalError = !(error instanceof CoreError)
//         ? new CoreError(ErrorCodes.CORE.INTERNAL_ERROR, error.message, context, { cause: error }) // Using a CORE prefixed code
//         : error;
//       // this.state.errors.push({ error: internalError, timestamp: new Date().toISOString(), context });
//       // ... (error array capping logic) ...
//       // this.recordMetric('mycomponent.errors.internal', 1, { errorName: internalError.name });
//       await safeHandleError(this.deps.errorSystem, internalError, { source: this.constructor.name, ...context });
//   }

//   async checkMySpecificFeature() { // Example health check function
//     let isFeatureHealthy = true;
//     let featureDetails = { status: 'online', version: '1.2.3' };
//     let encounteredErrors = [];

//     try {
//       // if (await this.someDependency.isUnresponsive()) {
//       //   isFeatureHealthy = false;
//       //   featureDetails.status = 'dependency_issue';
//       //   encounteredErrors.push(new ServiceError(
//       //       ErrorCodes.SERVICE.UNAVAILABLE, // This is now an unprefixed code, e.g., 'UNAVAILABLE'
//       //       'Dependency X is unresponsive.'
//       //   )); // ServiceError constructor will prepend 'SERVICE_'
//       // }
//     } catch (error) {
//       isFeatureHealthy = false;
//       featureDetails.error = error.message;
//       encounteredErrors.push(error);
//     }

//     return createStandardHealthCheckResult(
//       isFeatureHealthy ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY,
//       featureDetails,
//       encounteredErrors
//     );
//   }
// }
```

---
## 4. Component: `ErrorCodes.js` - Standardized Error Identifiers

### 4.1. Overview & Purpose [cite: 39]
`ErrorCodes.js` (located at `src/core/errors/ErrorCodes.js`) serves as the definitive, centralized registry for all standardized error code strings used within the TSMIS application. [cite: 121] Its purpose is to provide a controlled and consistent vocabulary for uniquely identifying specific error conditions, which is fundamental for effective programmatic error handling, debugging, and monitoring. [cite: 122]

### 4.2. Structure and Naming Convention
* **Main Export**: Exports a single, deeply frozen `ErrorCodes` object. [cite: 123]
* **Domains/Categories**: Error codes are hierarchically organized under top-level keys representing major application domains or core systems (e.g., `CORE`, `CONFIG`, `MODULE`, `VALIDATION`, `EVENT`, `ROUTER`, and potentially business-module specific domains like `INVENTORY`). [cite: 124] These domain keys are conventionally `PascalCase` or `UPPER_SNAKE_CASE`. [cite: 125]
* **Specific Codes**: Within each domain, individual error identifiers are `UPPER_SNAKE_CASE` keys. [cite: 125]
* **Value Format**:
    * For codes within the generic `CORE` domain (intended for direct use with `new CoreError(...)`), the string value assigned to each error code key includes the `CORE_` prefix (e.g., `ErrorCodes.CORE.UNKNOWN_ERROR` would have the string value `'CORE_UNKNOWN_ERROR'`).
    * For codes within specific domains (e.g., `VALIDATION`, `CONFIG`, `MODULE`), the string value assigned to each error code key is the **unprefixed specific part** of the code (e.g., `ErrorCodes.VALIDATION.INVALID_INPUT` would have the string value `'INVALID_INPUT'`). [cite: 126]
* **Note on Prefixes**:
    * `CoreError` subclasses (e.g., `ValidationError`, `ModuleError`) are responsible for prepending their respective domain prefix (e.g., `VALIDATION_`, `MODULE_`) to the specific, unprefixed code part (obtained from `ErrorCodes.js`) when an error instance is created. For example, `new ValidationError(ErrorCodes.VALIDATION.INVALID_INPUT, ...)` (where `ErrorCodes.VALIDATION.INVALID_INPUT` provides `'INVALID_INPUT'`) would result in an `error.code` of `'VALIDATION_INVALID_INPUT'`. [cite: 127]
    * If a base `CoreError` is thrown directly and needs to represent a domain-specific error, the appropriate prefix must be manually prepended to the specific code part from `ErrorCodes.js` to ensure global uniqueness and clarity (e.g., `new CoreError(\`CONFIG_${ErrorCodes.CONFIG.LOAD_FAILED}\`, ...)` if `ErrorCodes.CONFIG.LOAD_FAILED` is the unprefixed `'LOAD_FAILED'`), or `ErrorSystem.createError(typeName, code, ...)` should be used, as it handles appropriate prefixing based on the `typeName`. [cite: 129]

### 4.3. Usage Guidelines [cite: 40]
* **Import & Reference**: Always import the `ErrorCodes` object and use its constants when instantiating `CoreError` or its subclasses. [cite: 132] This prevents typos and ensures use of defined codes. [cite: 133]
* **Adding New Codes**: When a new distinct error condition is identified:
    1.  Determine the appropriate domain/category within `ErrorCodes.js`. [cite: 133] Create a new domain object if necessary. [cite: 134]
    2.  Add a new, descriptive `UPPER_SNAKE_CASE` key for the error within its domain. [cite: 134]
    3.  Assign it an unprefixed string value (typically matching the key) if it's for a specific domain whose errors are thrown via a `CoreError` subclass. For `CORE` domain errors, assign the fully prefixed string value. [cite: 135]
    4.  Ensure all nested objects within `ErrorCodes` remain frozen with `Object.freeze()`. [cite: 136]

### 4.4. Integration with `CoreError` and `ErrorSystem`
* **`CoreError` Subclasses**: Constructors of specialized error types (e.g., `ValidationError`) use a specific, unprefixed code from `ErrorCodes.DOMAIN.CODE_NAME` (e.g., `ErrorCodes.VALIDATION.INVALID_INPUT` which is `'INVALID_INPUT'`) and prepend their domain (e.g., `VALIDATION_`) to form the final `error.code`. [cite: 137]
* **`ErrorSystem`**:
    * The `createError(typeName, code, ...)` method expects the specific (unprefixed) `code` from `ErrorCodes.js` for domain-specific errors and uses the `typeName` to find the correct `CoreError` subclass (which then adds its domain prefix). If `typeName` is `'CoreError'`, the `code` argument should be the fully prefixed code (e.g., from `ErrorCodes.CORE`). [cite: 138]
    * Custom handlers registered with `ErrorSystem.registerHandler()` can switch on the full, prefixed `error.code` (e.g., `'VALIDATION_INVALID_INPUT'`) to implement specific logic. [cite: 139]
    * Framework integrations often map external error states to these internal `ErrorCodes` (passing the unprefixed specific code to `ErrorSystem.createError` or the appropriate subclass constructor) when creating `CoreError` instances. [cite: 140]

### 4.5. Example Snippet [cite: 41]
**Example**: Snippet from `ErrorCodes.js` Structure (Illustrative)
```javascript
// src/core/errors/ErrorCodes.js (Illustrative Snippet - showing new unprefixed style for domains)

// export const ErrorCodes = Object.freeze({
//   CORE: Object.freeze({ // Values are fully prefixed
//     UNKNOWN_ERROR: 'CORE_UNKNOWN_ERROR',
//     INTERNAL_ERROR: 'CORE_INTERNAL_ERROR',
//     NOT_IMPLEMENTED: 'CORE_NOT_IMPLEMENTED',
//     // ...
//   }),
//   CONFIG: Object.freeze({ // Values are unprefixed specific parts
//     LOAD_FAILED: 'LOAD_FAILED',
//     VALIDATION_FAILED: 'VALIDATION_FAILED',
//     MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
//     // ...
//   }),
//   VALIDATION: Object.freeze({ // Values are unprefixed specific parts for ValidationError instances
//     INVALID_INPUT: 'INVALID_INPUT',
//     SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
//     REQUIRED_FIELD: 'REQUIRED_FIELD',
//     // ...
//   }),
//   // ... other domains like MODULE, EVENT, ROUTER, SERVICE, NETWORK, AUTH, ACCESS ...
//   // e.g., SERVICE: Object.freeze({ OPERATION_FAILED: 'OPERATION_FAILED', UNAVAILABLE: 'UNAVAILABLE' })
// });
```

---
## 5. Overall Integration and Importance
These common utilities (`SystemConstants.js`, `ErrorUtils.js`) and definitions (`ErrorCodes.js`) are not standalone systems but rather foundational building blocks. [cite: 141]
* They are imported and used by all core systems (`ContainerSystem`, `ErrorSystem`, `EventBusSystem`, `ModuleSystem`, `RouterSystem`) and the base classes (`CoreModule`, `CoreError`). [cite: 142]
* Their consistent use enforces the standardization pillars of the architecture, particularly around lifecycle management, error handling, and health monitoring. [cite: 143]
* They contribute significantly to reducing boilerplate, improving code clarity, and enhancing the overall robustness and maintainability of TSMIS. [cite: 144]

---
## 6. Testing Strategy Notes (for Utilities)
* **`SystemConstants.js`**:
    * Verify that the exported objects (`SYSTEM_STATUS`, `LIFECYCLE_EVENTS`, `DEFAULT_CONFIG`) are deeply frozen to ensure immutability. [cite: 145]
    * Check that key constant values are correct and present. [cite: 146]
* **`ErrorUtils.js`**:
    * **`safeHandleError`**: Test thoroughly with:
        * A valid, working `ErrorSystem` instance (ensure `errorSystem.handleError` is called). [cite: 147]
        * A `null` or `undefined` `errorSystem` instance (ensure `console.error` is called with correct details). [cite: 148]
        * An `errorSystem` instance where `handleError` itself throws an error (ensure `console.error` is called with both original and forwarding error details). [cite: 149]
    * **`createStandardHealthCheckResult`**: Test that it produces objects with the correct structure (`{ status, detail, errors }`) and that the `errors` array contains correctly summarized error information. [cite: 150]
* **`ErrorCodes.js`**:
    * Verify that the main `ErrorCodes` object and its nested domain objects are deeply frozen. [cite: 151]
    * Check for uniqueness of error code string values (if feasible with tooling, otherwise by convention and review). [cite: 152]
    * Ensure the structure is as expected. [cite: 153]

---
## 7. Future Considerations
* **`ErrorCodes.js` Linting/Validation**: Implement automated checks to ensure uniqueness of error codes and adherence to naming conventions. [cite: 153]
* **`SystemConstants.js` Expansion**: As new common states or event types emerge across multiple systems, they should be added here. [cite: 154]
* **`ErrorUtils.js` Further Utilities**: Potentially add more error-related helper functions if common patterns emerge (e.g., more sophisticated error wrapping or formatting utilities, though much of this is handled by `CoreError` itself). [cite: 155]