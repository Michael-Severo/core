/**
 * @file ErrorCodes.js
 * @description Standardized error codes for the TSMIS application.
 * Domain-specific codes (outside of CORE) are unprefixed here;
 * the respective CoreError subclasses will prepend the domain.
 */

export const ErrorCodes = Object.freeze({
  // --- Generic Core System Errors (values are full codes) ---
  CORE: Object.freeze({
    UNKNOWN_ERROR: 'CORE_UNKNOWN_ERROR',
    INTERNAL_ERROR: 'CORE_INTERNAL_ERROR', // For unexpected internal issues
    INITIALIZATION_FAILED: 'CORE_INITIALIZATION_FAILED',
    ALREADY_INITIALIZED: 'CORE_ALREADY_INITIALIZED',
    NOT_INITIALIZED: 'CORE_NOT_INITIALIZED',
    SHUTDOWN_FAILED: 'CORE_SHUTDOWN_FAILED',
    VALIDATION_FAILED: 'CORE_VALIDATION_FAILED', // General validation failure
    INVALID_ARGUMENT: 'CORE_INVALID_ARGUMENT', // For invalid function/method arguments
    INVALID_OPERATION: 'CORE_INVALID_OPERATION', // Operation not allowed in current state
    INVALID_TYPE: 'CORE_INVALID_TYPE', // General type mismatch
    INVALID_HANDLER: 'CORE_INVALID_HANDLER', // Handler function is not valid
    INTEGRATION_FAILED: 'CORE_INTEGRATION_FAILED', // Generic failure with an external integration
    NOT_IMPLEMENTED: 'CORE_NOT_IMPLEMENTED', // Feature or method not implemented
    DEPRECATED: 'CORE_DEPRECATED', // Feature or method is deprecated
    RESOURCE_NOT_FOUND: 'CORE_RESOURCE_NOT_FOUND', // Generic resource not found
  }),

  // --- Configuration System Errors (unprefixed values) ---
  CONFIG: Object.freeze({
    LOAD_FAILED: 'LOAD_FAILED',
    SAVE_FAILED: 'SAVE_FAILED',
    VALIDATION_FAILED: 'VALIDATION_FAILED', // Specific to config validation
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    INVALID_FIELD_TYPE: 'INVALID_FIELD_TYPE',
    INVALID_ENUM_VALUE: 'INVALID_ENUM_VALUE',
    PATTERN_MISMATCH: 'PATTERN_MISMATCH',
    INVALID_CONFIG_OBJECT: 'INVALID_CONFIG_OBJECT', // If config itself is not an object
    DUPLICATE_MANIFEST: 'DUPLICATE_MANIFEST', // Container specific
    DUPLICATE_COMPONENT: 'DUPLICATE_COMPONENT', // Container specific
    MISSING_DEPENDENCY: 'MISSING_DEPENDENCY', // Container specific: component dependency
    CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY', // Container specific
    MANIFEST_TYPE_NOT_FOUND: 'MANIFEST_TYPE_NOT_FOUND', // Container specific
  }),

  // --- Service & Component Errors (unprefixed values) ---
  SERVICE: Object.freeze({
    UNKNOWN_COMPONENT: 'UNKNOWN_COMPONENT', // Container specific
    COMPONENT_LOAD_FAILED: 'COMPONENT_LOAD_FAILED', // Container specific
    IMPLEMENTATION_LOAD_FAILED: 'IMPLEMENTATION_LOAD_FAILED', // Container specific
    DISCOVERY_FAILED: 'DISCOVERY_FAILED', // Container specific
    DIRECTORY_SCAN_FAILED: 'DIRECTORY_SCAN_FAILED', // Container specific
    OPERATION_FAILED: 'OPERATION_FAILED', // Generic service operation failure
    EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    CACHE_ERROR: 'CACHE_ERROR',
    UNAVAILABLE: 'UNAVAILABLE', // Service is not available
    // Note: Original ErrorCodes.js SERVICE had INITIALIZATION_FAILED, ALREADY_INITIALIZED, NOT_INITIALIZED, SHUTDOWN_FAILED
    // These are now primarily under CORE or specific systems (like EVENT, MODULE, ROUTER) for their own lifecycle.
    // If needed for a generic "Service" component that's not a full system, they could be added here (unprefixed).
  }),

  // --- Event System Errors (unprefixed values) ---
  EVENT: Object.freeze({
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    INITIALIZATION_FAILED: 'INITIALIZATION_FAILED', // Specific to Event system
    ALREADY_INITIALIZED: 'ALREADY_INITIALIZED', // Specific to Event system
    NOT_INITIALIZED: 'NOT_INITIALIZED', // Specific to Event system
    SHUTDOWN_FAILED: 'SHUTDOWN_FAILED', // Specific to Event system
    MISSING_DEPENDENCIES: 'MISSING_DEPENDENCIES', // For EventBus/System deps
    INVALID_DEPENDENCY: 'INVALID_DEPENDENCY', // For EventBus/System deps
    INVALID_EVENT_NAME: 'INVALID_EVENT_NAME',
    INVALID_HANDLER: 'INVALID_HANDLER', // Handler function validation
    INVALID_PATTERN: 'INVALID_PATTERN', // Subscription pattern validation
    EMISSION_FAILED: 'EMISSION_FAILED',
    SUBSCRIPTION_FAILED: 'SUBSCRIPTION_FAILED',
    HANDLER_NOT_FOUND: 'HANDLER_NOT_FOUND', // For unsubscribe if ID not found
    HANDLER_ERROR: 'HANDLER_ERROR', // Error *thrown by* an event handler
    QUEUE_OPERATION_FAILED: 'QUEUE_OPERATION_FAILED', // Generic queue add/remove issue
    QUEUE_PROCESSING_FAILED: 'QUEUE_PROCESSING_FAILED', // Error during processQueue
    LEGACY_WILDCARD_FORWARD: 'LEGACY_WILDCARD_FORWARD', // Specific internal diagnostic
  }),

  // --- Module System Errors (unprefixed values) ---
  MODULE: Object.freeze({
    INTERNAL_ERROR: 'INTERNAL_ERROR', // CoreModule internal
    SYSTEM_ERROR: 'SYSTEM_ERROR', // ModuleSystem internal
    INITIALIZATION_FAILED: 'INITIALIZATION_FAILED', // Specific to Module system/instance
    ALREADY_INITIALIZED: 'ALREADY_INITIALIZED', // Specific to Module system/instance
    NOT_INITIALIZED: 'NOT_INITIALIZED', // Specific to Module system/instance
    SHUTDOWN_FAILED: 'SHUTDOWN_FAILED', // Specific to Module system/instance
    MISSING_DEPENDENCIES: 'MISSING_DEPENDENCIES', // For Module deps
    INVALID_DEPENDENCY: 'INVALID_DEPENDENCY', // For Module deps
    DEPENDENCY_NOT_READY: 'DEPENDENCY_NOT_READY',
    DEPENDENCY_RESOLUTION_FAILED: 'DEPENDENCY_RESOLUTION_FAILED', // Added for clarity
    CONFIG_VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',
    INVALID_HEALTH_CHECK: 'INVALID_HEALTH_CHECK',
    HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED', // Error *executing* a health check
    UNHEALTHY: 'UNHEALTHY', // Module reported unhealthy status
    OPERATION_FAILED: 'OPERATION_FAILED', // Generic failure in a module's business logic
    DUPLICATE_MODULE: 'DUPLICATE_MODULE', // ModuleSystem: registration
    REGISTRATION_FAILED: 'REGISTRATION_FAILED', // ModuleSystem: registration
    UNREGISTER_FAILED: 'UNREGISTER_FAILED', // ModuleSystem: unregistration
    NOT_FOUND: 'NOT_FOUND', // ModuleSystem: resolve
    CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY', // ModuleSystem: dependency order
    INVALID_MODULE: 'INVALID_MODULE', // Added for type validation (e.g. not extending CoreModule)
  }),

  // --- Router System Errors (unprefixed values) ---
  ROUTER: Object.freeze({
    SYSTEM_INTERNAL_ERROR: 'SYSTEM_INTERNAL_ERROR', // RouterSystem internal
    INTERNAL_SYSTEM_ERROR: 'INTERNAL_SYSTEM_ERROR', // CoreRouter internal (distinguish if needed)
    INITIALIZATION_FAILED: 'INITIALIZATION_FAILED', // Specific to Router system/instance
    ALREADY_INITIALIZED: 'ALREADY_INITIALIZED', // Specific to Router system/instance
    NOT_INITIALIZED: 'NOT_INITIALIZED', // Specific to Router system/instance
    SHUTDOWN_FAILED: 'SHUTDOWN_FAILED', // Specific to Router system/instance
    CREATION_FAILED: 'CREATION_FAILED', // For factory function issues
    MISSING_DEPENDENCIES: 'MISSING_DEPENDENCIES',
    INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
    INVALID_FRAMEWORK: 'INVALID_FRAMEWORK', // Added for clarity
    INVALID_MODULE_ID: 'INVALID_MODULE_ID',
    INVALID_METHOD: 'INVALID_METHOD',
    INVALID_PATH: 'INVALID_PATH',
    INVALID_HANDLER: 'INVALID_HANDLER', // Handler function for a route
    INVALID_PAYLOAD: 'INVALID_PAYLOAD', // e.g. event payload missing data
    INVALID_API_VERSION: 'INVALID_API_VERSION',
    ROUTE_CONFLICT: 'ROUTE_CONFLICT',
    ROUTE_REGISTRATION_FAILED: 'ROUTE_REGISTRATION_FAILED',
    ROUTE_UNREGISTRATION_FAILED: 'ROUTE_UNREGISTRATION_FAILED',
    MODULE_UNREGISTRATION_FAILED: 'MODULE_UNREGISTRATION_FAILED',
    ROUTES_APPLICATION_FAILED: 'ROUTES_APPLICATION_FAILED',
    ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND',
    INVALID_ADAPTER: 'INVALID_ADAPTER',
    INVALID_ADAPTER_NAME: 'INVALID_ADAPTER_NAME',
    INVALID_MIDDLEWARE: 'INVALID_MIDDLEWARE',
    INVALID_MIDDLEWARE_NAME: 'INVALID_MIDDLEWARE_NAME',
    INVALID_HEALTH_CHECK: 'INVALID_HEALTH_CHECK', // If router system has own health checks
  }),

  // --- Specific Error Type Codes (unprefixed values, used by respective Error classes) ---
  VALIDATION: Object.freeze({ // Used by ValidationError
    INVALID_INPUT: 'INVALID_INPUT',
    SCHEMA_MISMATCH: 'SCHEMA_MISMATCH',
    REQUIRED_FIELD: 'REQUIRED_FIELD',
    TYPE_ERROR: 'TYPE_ERROR',
    ENUM_MISMATCH: 'ENUM_MISMATCH',
    PATTERN_ERROR: 'PATTERN_ERROR',
    CUSTOM_VALIDATION_FAILED: 'CUSTOM_VALIDATION_FAILED',
    FAILED: 'FAILED', // General catch-all for validation if not more specific
  }),

  NETWORK: Object.freeze({ // Used by NetworkError
    REQUEST_FAILED: 'REQUEST_FAILED',
    RESPONSE_ERROR: 'RESPONSE_ERROR',
    TIMEOUT: 'TIMEOUT',
    CONNECTION_REFUSED: 'CONNECTION_REFUSED',
    HOST_UNREACHABLE: 'HOST_UNREACHABLE',
    DNS_LOOKUP_FAILED: 'DNS_LOOKUP_FAILED',
    SSL_ERROR: 'SSL_ERROR',
    ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND', // For 404s from external calls
  }),

  AUTH: Object.freeze({ // Used by AuthError (Authentication)
    UNAUTHORIZED: 'UNAUTHORIZED',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    TOKEN_INVALID: 'TOKEN_INVALID',
    TOKEN_MISSING: 'TOKEN_MISSING',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
    MFA_REQUIRED: 'MFA_REQUIRED',
    MFA_FAILED: 'MFA_FAILED',
  }),

  ACCESS: Object.freeze({ // Used by AccessError (Authorization)
    FORBIDDEN: 'FORBIDDEN',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    RESOURCE_OWNERSHIP_REQUIRED: 'RESOURCE_OWNERSHIP_REQUIRED',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    FEATURE_NOT_ENABLED: 'FEATURE_NOT_ENABLED',
  }),
});