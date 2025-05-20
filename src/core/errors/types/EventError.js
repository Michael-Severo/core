/**
 * @file EventError.js
 * @description Defines errors related to the event system.
 */

import { CoreError } from '../CoreError.js'; // [cite: 2055]

/**
 * Represents an error occurring within the event bus or event handling system.
 * Typically corresponds to HTTP 500 Internal Server Error. [cite: 2056]
 * @extends CoreError
 */
export class EventError extends CoreError {
  /**
   * Creates a new EventError instance.
   * The constructor will prepend "EVENT_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.EVENT` (e.g., 'EMIT_FAILED', 'HANDLER_ERROR').
   * @param {string} message - A human-readable description of the error. [cite: 2059]
   * @param {object} [details={}] - Additional details about the event system error. [cite: 2060]
   * @param {object} [options={}] - Additional error options, including 'cause'. [cite: 2061]
   */
  constructor(code, message, details = {}, options = {}) {
    super(`EVENT_${code}`, message, details, options); // [cite: 2062]
    this.name = 'EventError';
    this.statusCode = 500; // [cite: 2062]
  }
}