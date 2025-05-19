/**
 * @file EventError.js
 * @description Defines errors related to the event system.
 */

import { CoreError } from '../CoreError.js'; // [cite: 379]

/**
 * Represents an error occurring within the event bus or event handling system.
 * Typically corresponds to HTTP 500 Internal Server Error.
 * @extends CoreError
 */
export class EventError extends CoreError {
  /**
   * Creates a new EventError instance.
   * @param {string} code - A specific error code for the event system issue (e.g., 'EMIT_FAILED', 'HANDLER_EXCEPTION').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details about the event system error.
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`EVENT_${code}`, message, details, options); // [cite: 380]
    this.statusCode = 500; // [cite: 380]
  }
}