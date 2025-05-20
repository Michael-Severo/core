/**
 * @file AuthError.js
 * @description Defines errors related to authentication.
 */

import { CoreError } from '../CoreError.js'; // [cite: 375]

/**
 * Represents an error during the authentication process.
 * Typically corresponds to HTTP 401 Unauthorized.
 * @extends CoreError
 */
export class AuthError extends CoreError {
  /**
   * Creates a new AuthError instance.
   * The constructor will prepend "AUTH_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.AUTH` (e.g., 'INVALID_CREDENTIALS', 'TOKEN_EXPIRED').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the authentication error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`AUTH_${code}`, message, details, options); // [cite: 376]
    this.name = 'AuthError';
    this.statusCode = 401; // [cite: 376]
  }
}