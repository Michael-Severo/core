/**
 * @file src/core/errors/index.js
 * @description Main public interface for the TSMIS Error System.
 * Exports CoreError, ErrorSystem, factory functions, all specific error types,
 * standardized error codes, and framework integration components.
 */

import { CoreError } from './CoreError.js';
import { ErrorSystem, createErrorSystem } from './ErrorSystem.js';
import { ErrorCodes } from './ErrorCodes.js';

// Import all specific error types and the ErrorTypes namespace from ./types/index.js
// Individual error types (AccessError, AuthError, etc.) are named exports from ./types/index.js
// The ErrorTypes namespace is also a named export from ./types/index.js
import * as SpecificErrorTypes from './types/index.js';

// Import integration components from ./integrations/index.js
// IFrameworkIntegration, FastifyErrorHandler, etc. are named exports from ./integrations/index.js
import * as Integrations from './integrations/index.js';

// Export the main classes and factory
export {
  CoreError,
  ErrorSystem,
  createErrorSystem,
  ErrorCodes,
};

// Export all specific error types individually for direct consumption
// These are re-exported directly by their names from './types/index.js'
export {
  AccessError,
  AuthError,
  ConfigError,
  EventError,
  ModuleError,
  NetworkError,
  RouterError,
  ServiceError,
  ValidationError,
} from './types/index.js'; // CORRECTED: Removed "SpecificErrorTypes_" prefix

// Export the ErrorTypes namespace object that was created in ./types/index.js
// SpecificErrorTypes.ErrorTypes is the object we want to export as 'ErrorTypes'
export const ErrorTypes = SpecificErrorTypes.ErrorTypes;

// Export integration-related components
// These are re-exported directly by their names from './integrations/index.js'
export {
  IFrameworkIntegration,
  FastifyErrorHandler, // The class itself
  createFastifyLoggerErrorSerializer, // The utility function
} from './integrations/index.js'; // CORRECTED: Removed "Integrations_" prefix

/**
 * Utility function to create a CoreError (or subclass) from an HTTP-like response object.
 *
 * @param {object} response - The response object, expected to have properties like
 * `data.name`, `data.code`, `data.message`, `data.details`.
 * If `data` is not present, it will look at the root of `response`.
 * @param {string} [defaultMessage='Unknown error occurred'] - Default message if not found in response.
 * @returns {CoreError} An instance of CoreError or its determined subclass.
 */
export function createErrorFromResponse(response, defaultMessage = 'Unknown error occurred') {
  const errorData = response?.data || response || {};
  let message = errorData.message || defaultMessage;
  let code = errorData.code || ErrorCodes.CORE.UNKNOWN_ERROR;
  let details = errorData.details || {};
  let cause = errorData.cause;

  const ErrorConstructor = SpecificErrorTypes.ErrorTypes[errorData.name] || CoreError;

  if (ErrorConstructor !== CoreError && typeof code === 'string') {
    const expectedDomainPrefix = ErrorConstructor.name.replace('Error', '').toUpperCase() + '_';
    if (code.startsWith(expectedDomainPrefix)) {
      code = code.substring(expectedDomainPrefix.length);
    }
  }

  const errorInstance = new ErrorConstructor(
    code,
    message,
    details,
    { cause: cause || response }
  );

  if (errorData.name && ErrorConstructor === CoreError && errorInstance.name !== errorData.name) {
      errorInstance.name = errorData.name;
  }

  if (errorInstance instanceof SpecificErrorTypes.ValidationError && Array.isArray(details.validationErrors)) {
    errorInstance.validationErrors = details.validationErrors;
  }

  return errorInstance;
}

export default {
  CoreError,
  ErrorSystem,
  createErrorSystem,
  ErrorCodes,
  ErrorTypes: SpecificErrorTypes.ErrorTypes,
  createErrorFromResponse,
  IFrameworkIntegration: Integrations.IFrameworkIntegration,
  FastifyErrorHandler: Integrations.FastifyErrorHandler,
  createFastifyLoggerErrorSerializer: Integrations.createFastifyLoggerErrorSerializer,
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