/**
 * @file ValidationError.js
 * @description Defines errors related to data validation.
 */

import { CoreError } from '../CoreError.js'; // [cite: 2102]

/**
 * Represents an error that occurs when input data fails validation.
 * Typically corresponds to HTTP 400 Bad Request.
 * @extends CoreError
 */
export class ValidationError extends CoreError {
  /**
   * Creates a new ValidationError instance.
   * The constructor will prepend "VALIDATION_" to the provided specific code.
   * @param {string} code - A specific, **unprefixed** error code from `ErrorCodes.VALIDATION` (e.g., 'INVALID_INPUT', 'SCHEMA_MISMATCH').
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - Additional details, expected to contain a `validationErrors` array.
   * @param {Array<object>} [details.validationErrors=[]] - An array of specific validation failure objects (e.g., { field, message }).
   * @param {object} [options={}] - Additional error options, including 'cause'.
   */
  constructor(code, message, details = {}, options = {}) {
    super(`VALIDATION_${code}`, message, details, options); // [cite: 2110]
    this.name = 'ValidationError';
    this.statusCode = 400; // [cite: 2110]
    // Ensure validationErrors is always an array, even if not provided or malformed in details.
    this.validationErrors = Array.isArray(details?.validationErrors) ? details.validationErrors : []; // [cite: 2111]
  }

  /**
   * Converts the error object to a JSON representation, including `validationErrors`.
   * @returns {object} A plain object representation of the error.
   */
  toJSON() {
    const json = super.toJSON(); //
    json.validationErrors = this.validationErrors; // [cite: 2114]
    return json;
  }

  /**
   * Creates a ValidationError instance from a JSON-like object.
   * @static
   * @param {object} data - The plain object containing error data.
   * @returns {ValidationError} An instance of ValidationError.
   */
  static fromJSON(data) {
    const errorInstance = super.fromJSON(data, ValidationError); // [cite: 2117]
    // Pass ValidationError as the type
    // Ensure validationErrors is an array after deserialization.
    errorInstance.validationErrors = Array.isArray(data?.validationErrors) ? data.validationErrors : []; // [cite: 2118]
    return errorInstance;
  }
}