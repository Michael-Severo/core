/**
 * @file ConfigError.js
 * @description Defines errors related to application configuration.
 */

import { CoreError } from '../CoreError.js'; // [cite: 2047]

/**
 * Represents an error encountered during application configuration loading, validation, or access.
 * Typically corresponds to HTTP 500 Internal Server Error.
 * @extends CoreError
 */
export class ConfigError extends CoreError {
  /**
   * Creates a new ConfigError instance.
   * The constructor will prepend "CONFIG_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.CONFIG` (e.g., 'LOAD_FAILED', 'VALIDATION_FAILED').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the configuration error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`CONFIG_${code}`, message, details, options); // [cite: 2054]
    this.name = 'ConfigError';
    this.statusCode = 500; // [cite: 2054]
  }
}