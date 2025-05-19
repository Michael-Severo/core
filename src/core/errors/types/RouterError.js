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
   * @param {string} code - A specific error code for the router system issue (e.g., 'ROUTE_NOT_FOUND', 'INVALID_ADAPTER').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the router system error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`ROUTER_${code}`, message, details, options); // [cite: 386]
    this.statusCode = 500; // [cite: 386]
  }
}

// The original file also had 'export default RouterError;' which is fine if only this class is in the file.
// For consistency with other error types, a named export is sufficient if it's part of an index.js barrel file.