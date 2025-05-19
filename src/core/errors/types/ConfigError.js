/**
 * @file ConfigError.js
 * @description Defines errors related to application configuration.
 */

import { CoreError } from '../CoreError.js'; // [cite: 377]

/**
 * Represents an error encountered during application configuration loading, validation, or access.
 * Typically corresponds to HTTP 500 Internal Server Error.
 * @extends CoreError
 */
export class ConfigError extends CoreError {
  /**
   * Creates a new ConfigError instance.
   * @param {string} code - A specific error code for the configuration issue (e.g., 'MISSING_VARIABLE', 'INVALID_FORMAT').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the configuration error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`CONFIG_${code}`, message, details, options); // [cite: 378]
    this.statusCode = 500; // [cite: 378]
  }
}