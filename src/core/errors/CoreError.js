/**
 * @file CoreError.js
 * @description Universal base error class for the application.
 */

import { SYSTEM_STATUS } from '../common/SystemConstants.js'; // Optional: if used for env checks

export class CoreError extends Error {
  /**
   * Creates a new CoreError instance.
   * @param {string} code - A unique error code, typically UPPER_SNAKE_CASE.
   * @param {string} message - A human-readable description of the error.
   * @param {object} [details={}] - An object containing additional error-specific information.
   * @param {object} [options={}] - Additional options.
   * @param {Error} [options.cause] - The original error that caused this error.
   */
  constructor(code, message, details = {}, options = {}) {
    super(message); // Pass message to the native Error class

    // Standard error properties
    this.name = this.constructor.name; // E.g., "CoreError", "ValidationError"
    this.code = code; // E.g., "VALIDATION_FAILED"
    this.details = this.sanitizeDetails(details); // Ensure details are serializable
    this.timestamp = new Date().toISOString();

    // Store the original cause of the error, if provided
    if (options.cause) {
      this.initCause(options.cause);
    }

    // Improve stack trace (if supported by the environment)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Standard V8 property to control stack trace formatting (optional)
    // Error.prepareStackTrace = (error, structuredStackTrace) => { /* custom formatting */ };

    // Ensure 'instanceof' works correctly after extending native Error
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Initializes the error cause, ensuring it's a proper Error instance.
   * @private
   * @param {Error|object|string} cause - The potential cause of the error.
   */
  initCause(cause) {
    const ensureValidName = (errorInstance) => {
      if (!errorInstance.name || !String(errorInstance.name).trim()) {
        errorInstance.name = 'Error'; // Default if name is missing or empty
      }
      return errorInstance;
    };

    if (cause instanceof Error) {
      this.cause = ensureValidName(cause); // [cite: 198]
    } else if (cause && typeof cause === 'object' && cause !== null) {
      const err = new Error(cause.message || JSON.stringify(cause)); // [cite: 199]
      if (cause.name && typeof cause.name === 'string' && cause.name.trim()) {
        err.name = cause.name; // [cite: 200]
      }
      if (cause.stack) {
        err.stack = cause.stack;
      }
      this.cause = err;
    } else if (typeof cause === 'string') {
      this.cause = new Error(cause); // [cite: 201]
    }
  }

  /**
   * Sanitizes error details to ensure they are serializable and prevent sensitive data leakage.
   * @private
   * @param {object} details - The original details object.
   * @returns {object} The sanitized details object.
   */
  sanitizeDetails(details) {
    if (typeof details !== 'object' || details === null) {
      return {};
    }
    try {
      // Attempt to serialize to catch non-serializable values like functions or complex objects
      JSON.stringify(details); // [cite: 202]
      // In a real application, you might want to filter out sensitive keys here
      return details;
    } catch (error) {
      // If serialization fails, return a safe representation
      return { // [cite: 203]
        error: 'Details contained non-serializable or circular values.',
        originalDetailsType: typeof details,
        safeDetailsRepresentation: String(details).substring(0, 256) // Truncate potentially large strings
      };
    }
  }

  /**
   * Determines if the current environment is considered 'development' or 'test'.
   * This can influence aspects like stack trace inclusion in toJSON().
   * @private
   * @returns {boolean}
   */
  isDevEnvironment() {
    if (typeof process !== 'undefined' && process.env) {
      return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'; // [cite: 207]
    }
    // Basic client-side check (can be expanded)
    if (typeof window !== 'undefined') {
      // You might have a global ENV variable set during build
      return window.ENV === 'development' || window.location.hostname === 'localhost'; // [cite: 208]
    }
    return false; // Default to false if environment cannot be determined
  }

  /**
   * Converts the error object to a JSON representation.
   * Stack trace is typically included only in development environments.
   * @returns {object} A plain object representation of the error.
   */
  toJSON() {
    const jsonError = {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    }; // [cite: 209]

    if (this.cause) {
      jsonError.cause = {
        name: this.cause.name || 'Error', // [cite: 211]
        message: this.cause.message,
        // Optionally include code and details from the cause if they exist
        ...(this.cause.code && { code: this.cause.code }),
        ...(this.cause.details && { details: this.cause.details }),
      };
      if (this.isDevEnvironment() && this.cause.stack) {
        jsonError.cause.stack = this.cause.stack.split('\n'); // [cite: 212]
      }
    }

    if (this.isDevEnvironment() && this.stack) {
      jsonError.stack = this.stack.split('\n'); // [cite: 210]
    }

    return jsonError; // [cite: 213]
  }

  /**
   * Creates a CoreError (or a subclass) instance from a JSON-like object.
   * Useful for deserializing errors, e.g., from an API response.
   * @static
   * @param {object} data - The plain object containing error data.
   * @param {typeof CoreError} [ErrorType=CoreError] - The specific error class to instantiate. Defaults to CoreError.
   * @returns {CoreError} An instance of CoreError or its subclass.
   */
  static fromJSON(data, ErrorType = CoreError) {
    if (!data || typeof data !== 'object') {
      return new ErrorType(
        'DESERIALIZATION_FAILED',
        'Invalid data provided for error deserialization.',
        { providedData: data }
      );
    }

    const { code, message, details, cause: causeData, name } = data;
    const options = {};

    if (causeData) {
      if (typeof causeData === 'string') {
        options.cause = new Error(causeData); // [cite: 215]
      } else if (typeof causeData === 'object' && causeData !== null) {
        const reconstructedCause = new Error(causeData.message || 'Caused by an unspecified error.');
        reconstructedCause.name = causeData.name || 'Error'; // [cite: 216]
        if (causeData.code) reconstructedCause.code = causeData.code;
        // Note: Cause's own 'details' and 'stack' are not typically reconstructed deeply here
        // to avoid complexity, but could be if needed.
        options.cause = reconstructedCause;
      }
    }

    const errorInstance = new ErrorType(
      code || 'UNKNOWN_ERROR',
      message || 'An unspecified error occurred.',
      details || {},
      options
    ); // [cite: 217]

    // Restore original name if it was different (e.g. "ValidationError" from data)
    // and the ErrorType is the generic CoreError.
    if (name && ErrorType === CoreError && errorInstance.name !== name) {
        errorInstance.name = name;
    }

    return errorInstance;
  }
}