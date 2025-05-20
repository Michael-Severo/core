/**
 * @file ServiceError.js
 * @description Defines errors related to service-level operations.
 */

import { CoreError } from '../CoreError.js'; // [cite: 2094]

/**
 * Represents an error occurring within a service or a dependency it relies on.
 * Typically corresponds to HTTP 503 Service Unavailable. [cite: 2095]
 * @extends CoreError
 */
export class ServiceError extends CoreError {
  /**
   * Creates a new ServiceError instance.
   * The constructor will prepend "SERVICE_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.SERVICE` (e.g., 'DATABASE_UNAVAILABLE', 'EXTERNAL_API_FAILED').
   * @param {string} message - A human-readable description of the error. [cite: 2097]
   * @param {object} [details={}] - Additional details about the service error. [cite: 2098]
   * @param {object} [options={}] - Additional error options, including 'cause'. [cite: 2099]
   */
  constructor(code, message, details = {}, options = {}) {
    super(`SERVICE_${code}`, message, details, options); // [cite: 2101]
    this.name = 'ServiceError';
    this.statusCode = 503; // [cite: 2101]
  }
}