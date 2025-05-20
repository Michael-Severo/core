/**
 * @file RouterError.js
 * @description Defines errors related to the routing system.
 */
import { CoreError } from '../CoreError.js';

/**
 * Represents an error occurring within the routing system (e.g., route not found, registration conflict).
 * Typically corresponds to HTTP 500 Internal Server Error for system issues, or others depending on context.
 * @extends CoreError
 */
export class RouterError extends CoreError {
  /**
   * Creates a new RouterError instance.
   * The constructor will prepend "ROUTER_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.ROUTER` (e.g., 'ROUTE_NOT_FOUND', 'INVALID_ADAPTER').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the router system error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`ROUTER_${code}`, message, details, options); // [cite: 2090]
    this.name = 'RouterError';
    this.statusCode = 500; // [cite: 2090]
  }
}