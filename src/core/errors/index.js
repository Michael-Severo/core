/**
 * @file src/core/errors/index.js
 * @description Main public interface for the TSMIS Error System.
 * Exports CoreError, ErrorSystem, factory functions, all specific error types,
 * standardized error codes, and framework integration components.
 */

import { CoreError } from './CoreError.js';
import { ErrorSystem, createErrorSystem } from './ErrorSystem.js';
import { ErrorCodes } from './ErrorCodes.js'; // Assuming ErrorCodes.js is now a separate file

// Import all specific error types and the ErrorTypes namespace from ./types/index.js
import * as SpecificErrorTypes from './types/index.js';

// Import integration components from ./integrations/index.js
import * as Integrations from './integrations/index.js';

// Export the main classes and factory
export {
  CoreError,
  ErrorSystem,
  createErrorSystem,
  ErrorCodes,
};

// Export all specific error types individually for direct consumption
export {
  SpecificErrorTypes_ AccessError,
  SpecificErrorTypes_ AuthError,
  SpecificErrorTypes_ ConfigError,
  SpecificErrorTypes_ EventError,
  SpecificErrorTypes_ ModuleError,
  SpecificErrorTypes_ NetworkError,
  SpecificErrorTypes_ RouterError,
  SpecificErrorTypes_ ServiceError,
  SpecificErrorTypes_ ValidationError,
} from './types/index.js'; // This re-exports named exports from types/index.js

// Export the ErrorTypes namespace object
// (This is the object containing all specific error type classes, e.g., ErrorTypes.ValidationError)
export const ErrorTypes = SpecificErrorTypes.ErrorTypes;


// Export integration-related components
export {
  Integrations_ IFrameworkIntegration,
  Integrations_ FastifyErrorHandler, // The class itself
  Integrations_ createFastifyLoggerErrorSerializer, // The utility function
  // Add other specific integrations here if they are directly exported, e.g., ExpressErrorHandler
} from './integrations/index.js';


/**
 * Utility function to create a CoreError (or subclass) from an HTTP-like response object.
 * This is similar to the original `createErrorFromResponse`.
 *
 * @param {object} response - The response object, expected to have properties like
 * `data.name`, `data.code`, `data.message`, `data.details`.
 * If `data` is not present, it will look at the root of `response`.
 * @param {string} [defaultMessage='Unknown error occurred'] - Default message if not found in response.
 * @returns {CoreError} An instance of CoreError or its determined subclass.
 */
export function createErrorFromResponse(response, defaultMessage = 'Unknown error occurred') {
  const errorData = response?.data || response || {}; // [cite: 333]
  let message = errorData.message || defaultMessage; // [cite: 335]
  let code = errorData.code || ErrorCodes.CORE.UNKNOWN_ERROR; // [cite: 335]
  let details = errorData.details || {}; // [cite: 335]
  let cause = errorData.cause; // The original createErrorFromResponse passed the whole response as cause [cite: 335]

  // Determine the ErrorConstructor based on errorData.name
  // This relies on ErrorTypes namespace being available (either imported here or from SpecificErrorTypes)
  const ErrorConstructor = SpecificErrorTypes.ErrorTypes[errorData.name] || CoreError; // [cite: 334]

  // If the ErrorConstructor is a specific type (e.g., ValidationError),
  // the code passed to it should be the specific part, not the prefixed one.
  // However, errorData.code might already be the full prefixed code if coming from another TSMIS service.
  // For now, we assume errorData.code is the intended code to pass to the constructor.
  // The constructors of specific error types will add their prefixes.
  // If errorData.code ALREADY has a prefix and ErrorConstructor is specific, it might get double-prefixed.
  // This needs careful handling based on expected `errorData.code` format.
  // Let's assume `errorData.code` is the *full* code for now, and constructors are idempotent with prefixes
  // OR that `errorData.code` is the *specific* part of the code.
  // Given the refactored error constructors expect the specific part (e.g. 'INVALID_INPUT'),
  // we might need to strip a prefix from `errorData.code` if `ErrorConstructor` is not `CoreError`.

  if (ErrorConstructor !== CoreError && typeof code === 'string') {
    const prefix = `${ErrorConstructor.name.replace('Error', '').toUpperCase()}_`; // e.g., VALIDATION_
    if (code.startsWith(prefix)) {
        // Code already seems to have a prefix that matches the error type name,
        // or it's a code that the subclass constructor expects without the prefix.
        // The subclass constructors now expect the unprefixed code.
        // So, if `errorData.name` is `ValidationError` and `code` is `VALIDATION_INVALID_INPUT`,
        // we should pass `INVALID_INPUT` to `new ValidationError()`.
        code = code.substring(prefix.length);
    } else if (code.includes('_') && ErrorConstructor.name.toUpperCase().startsWith(code.split('_')[0])) {
        // Heuristic: If code is FOO_BAR and ErrorConstructor is FooError, pass BAR.
        // This is a bit fragile. Better if errorData.code is always the non-prefixed version
        // when errorData.name indicates a specific type.
        // For now, we'll pass it as is and rely on constructor logic or specific code format.
    }
  }


  const errorInstance = new ErrorConstructor(
    code,
    message,
    details,
    { cause: cause || response } // Pass original response as part of the cause if no specific cause data
  );

  // If errorData.name was present and we used CoreError as fallback, set the name.
  if (errorData.name && ErrorConstructor === CoreError && errorInstance.name !== errorData.name) {
      errorInstance.name = errorData.name;
  }

  // For ValidationError, specifically re-attach validationErrors if present in details
  if (errorInstance instanceof SpecificErrorTypes.ValidationError && Array.isArray(details.validationErrors)) {
    errorInstance.validationErrors = details.validationErrors;
  }

  return errorInstance;
}

// Default export can be the ErrorTypes namespace or the ErrorSystem class,
// depending on the most common usage.
// Your original had 'export default ErrorTypes;' [cite: 336]
// Sticking to named exports mostly, but if a default is desired:
// export default ErrorTypes;
// Or for more comprehensive default:
export default {
  CoreError,
  ErrorSystem,
  createErrorSystem,
  ErrorCodes,
  ErrorTypes: SpecificErrorTypes.ErrorTypes, // Explicitly re-exporting here too
  createErrorFromResponse,
  Integrations,
  // Individually exporting types again for convenience if default is used by consumer
  AccessError: SpecificErrorTypes.AccessError,
  AuthError: SpecificErrorTypes.AuthError,
  ConfigError: SpecificErrorTypes.ConfigError,
  EventError: SpecificErrorTypes.EventError,
  ModuleError: SpecificErrorTypes.ModuleError,
  NetworkError: SpecificErrorTypes.NetworkError,
  RouterError: SpecificErrorTypes.RouterError,
  ServiceError: SpecificErrorTypes.ServiceError,
  ValidationError: SpecificErrorTypes.ValidationError,
};