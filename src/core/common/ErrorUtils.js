/**
 * @file ErrorUtils.js
 * @description Shared utility functions for error handling.
 */

/**
 * Safely handles an error by attempting to forward it to the ErrorSystem.
 * If ErrorSystem is unavailable or fails, it logs the error to the console.
 *
 * @param {object|null|undefined} errorSystem - The ErrorSystem instance.
 * @param {Error} error - The error object to handle.
 * @param {object} [context={}] - Additional context for the error.
 * @returns {Promise<void>}
 */
export async function safeHandleError(errorSystem, error, context = {}) {
  const source = context.source || 'UnknownSystem';

  if (!errorSystem || typeof errorSystem.handleError !== 'function') {
    console.error(
      `[${new Date().toISOString()}] Unhandled error in ${source} (ErrorSystem unavailable/invalid):`,
      {
        errorCode: error.code,
        errorMessage: error.message,
        errorDetails: error.details,
        errorCause: error.cause,
        context,
        stack: error.stack
      }
    );
    return;
  }

  try {
    await errorSystem.handleError(error, context);
  } catch (forwardingError) {
    console.error(
      `[${new Date().toISOString()}] Failed to forward error from ${source} to ErrorSystem:`,
      {
        originalErrorCode: error.code,
        originalErrorMessage: error.message,
        forwardingErrorCode: forwardingError.code,
        forwardingErrorMessage: forwardingError.message,
        context,
        originalErrorStack: error.stack,
        forwardingErrorStack: forwardingError.stack
      }
    );
  }
}

/**
 * Creates a standardized health check result object.
 *
 * @param {string} status - The health status (e.g., SYSTEM_STATUS.HEALTHY).
 * @param {object} [detail={}] - Specific details for this health check.
 * @param {Array<Error>} [errors=[]] - Any errors encountered during the health check.
 * @returns {{status: string, detail: object, errors: Array<Error>}}
 */
export function createStandardHealthCheckResult(status, detail = {}, errors = []) {
  return {
    status,
    detail,
    errors: errors.map(err => ({ // Store a serializable summary of the error
      name: err.name,
      message: err.message,
      code: err.code,
      details: err.details,
      cause: err.cause ? { name: err.cause.name, message: err.cause.message, code: err.cause.code } : undefined
    }))
  };
}