/**
 * @file AccessError.js
 * @description Defines errors related to authorization and access control.
 */

import { CoreError } from '../CoreError.js';

/**
 * Represents an error where access to a resource or operation is denied.
 * Typically corresponds to HTTP 403 Forbidden.
 * @extends CoreError
 */
export class AccessError extends CoreError {
  /**
   * Creates a new AccessError instance.
   * The constructor will prepend "ACCESS_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.ACCESS` (e.g., 'INSUFFICIENT_PERMISSIONS').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the access error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`ACCESS_${code}`, message, details, options); // [cite: 2038]
    this.name = 'AccessError';
    this.statusCode = 403; // [cite: 2038]
  }
}