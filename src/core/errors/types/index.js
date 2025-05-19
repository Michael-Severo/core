/**
 * @file src/core/errors/types/index.js
 * @description Barrel file for exporting all specific CoreError subclasses
 * and an ErrorTypes namespace object.
 */

import { AccessError } from './AccessError.js';
import { AuthError } from './AuthError.js';
import { ConfigError } from './ConfigError.js';
import { EventError } from './EventError.js';
import { ModuleError } from './ModuleError.js';
import { NetworkError } from './NetworkError.js';
import { RouterError } from './RouterError.js';
import { ServiceError } from './ServiceError.js';
import { ValidationError } from './ValidationError.js';

// Export individual error types for direct import
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
};

// Create and export the ErrorTypes namespace object
// This provides a convenient way to access error types, similar to the original.
export const ErrorTypes = Object.freeze({
  AccessError,
  AuthError,
  ConfigError,
  EventError,
  ModuleError,
  NetworkError,
  RouterError,
  ServiceError,
  ValidationError,
});

// Optionally, make ErrorTypes the default export if desired,
// though named exports are common for ES Modules.
// The original had 'export default ErrorTypes;' [cite: 400] which is also fine.
// For consistency with how we are handling other index files that export multiple things,
// sticking to named exports for `ErrorTypes` might be cleaner unless a default is strongly preferred.