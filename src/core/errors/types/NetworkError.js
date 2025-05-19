/**
 * @file NetworkError.js
 * @description Defines errors related to network operations.
 */

import { CoreError } from '../CoreError.js'; // [cite: 383]

/**
 * Represents an error occurring during network communication (e.g., request timeouts, connection issues).
 * Default statusCode is 503 Service Unavailable, but can be overridden by details.statusCode.
 * @extends CoreError
 */
export class NetworkError extends CoreError {
  /**
   * Creates a new NetworkError instance.
   * @param {string} code - A specific error code for the network issue (e.g., 'REQUEST_TIMEOUT', 'CONNECTION_REFUSED').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the network error. Can include `details.statusCode` to override default.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`NETWORK_${code}`, message, details, options); // [cite: 384]
    // Original code allowed details.statusCode to override. We'll keep this behavior.
    this.statusCode = (details && typeof details.statusCode === 'number') ? details.statusCode : 503; // [cite: 384, 385]
  }
}