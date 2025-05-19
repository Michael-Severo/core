/**
 * @file ServiceError.js
 * @description Defines errors related to service-level operations.
 */

import { CoreError } from '../CoreError.js'; // [cite: 387]

/**
 * Represents an error occurring within a service or a dependency it relies on.
 * Typically corresponds to HTTP 503 Service Unavailable.
 * @extends CoreError
 */
export class ServiceError extends CoreError {
  /**
   * Creates a new ServiceError instance.
   * @param {string} code - A specific error code for the service issue (e.g., 'DATABASE_UNAVAILABLE', 'EXTERNAL_API_FAILED').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the service error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`SERVICE_${code}`, message, details, options); // [cite: 388]
    this.statusCode = 503; // [cite: 388]
  }
}