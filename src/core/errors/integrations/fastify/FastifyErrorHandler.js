/**
 * @file FastifyErrorHandler.js
 * @description Implements IFrameworkIntegration for Fastify, providing standardized
 * error handling, mapping, and serialization for Fastify applications.
 */

import { IFrameworkIntegration } from '../IFrameworkIntegration.js';
import { CoreError } from '../../CoreError.js';
import { ErrorCodes } from '../../ErrorCodes.js';
import { ValidationError, NetworkError } from '../../types/index.js'; // Ensure types index exports these

export class FastifyErrorHandler extends IFrameworkIntegration {
  /**
   * @type {ErrorSystem | null}
   */
  errorSystem = null;
  /**
   * @type {object}
   */
  logger = console;
  /**
   * @type {boolean}
   */
  initialized = false;

  constructor() {
    super();
    // Dependencies like errorSystem and logger will be passed via options in initialize
  }

  /**
   * Initializes the Fastify error handling integration.
   * Sets up Fastify's global error handler and an onRequest hook for error context.
   * @param {object} fastify - The Fastify framework instance.
   * @param {object} [options={}] - Integration options.
   * @param {ErrorSystem} [options.errorSystem] - The ErrorSystem instance for processing errors.
   * @param {object} [options.logger] - A logger instance.
   * @override
   */
  async initialize(fastify, options = {}) {
    if (this.initialized) {
      this.logger.warn('[FastifyErrorHandler] Already initialized.');
      return;
    }
    if (!fastify || typeof fastify.setErrorHandler !== 'function' || typeof fastify.addHook !== 'function') {
      throw new CoreError(ErrorCodes.CORE.INVALID_ARGUMENT, 'Invalid Fastify instance provided to FastifyErrorHandler.');
    }

    this.errorSystem = options.errorSystem;
    this.logger = options.logger || this.logger;

    // Add error context to request
    fastify.addHook('onRequest', async (request, reply) => {
      // Create a basic error context on the request object
      // This can be enriched by other middleware or route handlers
      request.errorContext = {
        requestId: request.id,
        url: request.raw?.url || request.url, // Prefer raw.url if available
        method: request.raw?.method || request.method,
        ip: request.ip,
        timestamp: new Date().toISOString(),
      };
    });

    // Set Fastify's global error handler
    fastify.setErrorHandler(async (error, request, reply) => {
      const requestContext = { // Augment context from request if available
        ...(request.errorContext || {}), // Base context from onRequest hook
        params: request.params,
        query: request.query,
        // Avoid logging full body by default unless configured, can be large/sensitive
        // bodySummary: request.body ? { keys: Object.keys(request.body) } : undefined,
      };

      // 1. Map the raw Fastify error to a CoreError instance
      const mappedCoreError = this.mapError(error, requestContext);

      // 2. Process with ErrorSystem (logging, custom handlers, metrics, etc.)
      if (this.errorSystem && typeof this.errorSystem.handleError === 'function') {
        await this.errorSystem.handleError(mappedCoreError, requestContext);
      } else {
        // Fallback logging if ErrorSystem is not available
        this.logger.error('[FastifyErrorHandler] ErrorSystem not available. Logging raw mapped error:', {
          error: mappedCoreError.toJSON ? mappedCoreError.toJSON() : mappedCoreError,
          context: requestContext,
        });
      }

      // 3. Serialize the CoreError for the HTTP response
      const responsePayload = this.serializeError(mappedCoreError, requestContext);

      // 4. Send the HTTP response
      // Ensure status code is a number and in valid HTTP range
      let statusCode = mappedCoreError.statusCode || 500;
      if (typeof statusCode !== 'number' || statusCode < 100 || statusCode > 599) {
          this.logger.warn(`[FastifyErrorHandler] Invalid statusCode ${statusCode} from error ${mappedCoreError.code}. Defaulting to 500.`);
          statusCode = 500;
      }
      reply.status(statusCode).send(responsePayload);
    });

    this.initialized = true;
    this.logger.info('[FastifyErrorHandler] Initialized and Fastify error handler set.');
  }

  /**
   * Maps a raw Fastify error to a standardized CoreError.
   * @param {Error} frameworkError - The error object caught by Fastify.
   * @param {object} [requestContext={}] - Context from the HTTP request.
   * @returns {CoreError}
   * @override
   */
  mapError(frameworkError, requestContext = {}) { //
    if (frameworkError instanceof CoreError) {
      return frameworkError; //
    }

    // Handle Fastify's built-in validation errors (FST_ERR_VALIDATION)
    if (frameworkError.code === 'FST_ERR_VALIDATION' || frameworkError.validation) { //
      const validationDetails = frameworkError.validation?.map(vErr => ({
        field: vErr.dataPath || vErr.instancePath || 'N/A', // dataPath for ajv v6, instancePath for v7+
        message: vErr.message,
        keyword: vErr.keyword,
        params: vErr.params,
      }));
      const validationError = new ValidationError(
        ErrorCodes.VALIDATION.SCHEMA_MISMATCH || 'SCHEMA_MISMATCH', // Using a defined code
        frameworkError.message || 'Request validation failed.',
        { validationErrors: validationDetails || [], rawFastifyValidation: frameworkError.validation },
        { cause: frameworkError }
      );
      validationError.statusCode = frameworkError.statusCode || 400;
      return validationError;
    }

    // Handle Fastify's Not Found errors (FST_ERR_NOT_FOUND)
    if (frameworkError.code === 'FST_ERR_NOT_FOUND' || frameworkError.statusCode === 404) { //
      const path = requestContext?.url || 'unknown path';
      const method = requestContext?.method || 'unknown method';
      const notFoundError = new NetworkError(
        ErrorCodes.NETWORK.ROUTE_NOT_FOUND, //
        `Route ${method} ${path} not found.`,
        { method, path },
        { cause: frameworkError }
      );
      notFoundError.statusCode = 404;
      return notFoundError;
    }

    // Generic error mapping
    const message = frameworkError.message || 'An unexpected error occurred.';
    const details = {
      originalErrorName: frameworkError.name,
      // Avoid exposing raw error in production by default from generic mapping
      ...( (this.errorSystem && this.errorSystem.deps.config?.isDevEnvironment) || // Check dev env via errorSystem config
           (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test')
           ? { rawError: String(frameworkError) } : {} )
    };

    const genericError = new CoreError(
      ErrorCodes.CORE.UNKNOWN_ERROR, //
      message,
      details,
      { cause: frameworkError }
    );
    genericError.statusCode = typeof frameworkError.statusCode === 'number' ? frameworkError.statusCode : 500; //
    return genericError;
  }

  /**
   * Serializes a CoreError for an HTTP response.
   * @param {CoreError} coreError - The CoreError instance.
   * @param {object} [requestContext={}] - Context from the HTTP request.
   * @returns {object} The error payload for the HTTP response.
   * @override
   */
  serializeError(coreError, requestContext = {}) { //
    if (coreError instanceof CoreError) {
      const serialized = coreError.toJSON(); //
      // Add minimal, safe request context to the response payload if desired
      return { //
        ...serialized,
        // Only include non-sensitive parts of requestContext if needed for client
        // context: { requestId: requestContext?.requestId } // Example
      };
    }

    // Fallback for non-CoreError (should ideally be caught by mapError)
    this.logger.warn('[FastifyErrorHandler] serializeError received a non-CoreError:', coreError);
    return { //
      name: coreError.name || 'Error',
      code: ErrorCodes.CORE.UNKNOWN_ERROR, //
      message: coreError.message || 'An unexpected error occurred.',
      timestamp: new Date().toISOString(),
      // context: { requestId: requestContext?.requestId }
    };
  }

  /**
   * Optional shutdown logic for the integration.
   */
  async shutdown() {
    this.initialized = false;
    this.logger.info('[FastifyErrorHandler] Shutdown.');
    // No specific resources to release for this basic handler.
  }
}