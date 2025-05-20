/**
 * @file ModuleError.js
 * @description Defines errors related to the module system.
 */

import { CoreError } from '../CoreError.js'; // [cite: 2063]

/**
 * Represents an error occurring within a module or the module management system.
 * Typically corresponds to HTTP 500 Internal Server Error.
 * @extends CoreError
 */
export class ModuleError extends CoreError {
  /**
   * Creates a new ModuleError instance.
   * The constructor will prepend "MODULE_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.MODULE` (e.g., 'LOAD_FAILED', 'DEPENDENCY_MISSING').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the module system error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`MODULE_${code}`, message, details, options); // [cite: 2070]
    this.name = 'ModuleError';
    this.statusCode = 500; // [cite: 2070]
  }
}