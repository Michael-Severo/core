/**
 * @file IFrameworkIntegration.js
 * @description Defines the interface for framework-specific error handling integrations
 * that work with the ErrorSystem.
 */

import { CoreError } from '../CoreError.js'; // For type hinting and potential use in implementations

/**
 * @interface IFrameworkIntegration
 * @description Interface that framework-specific error handling integrations must implement.
 * These integrations bridge the ErrorSystem with HTTP frameworks like Fastify or Express.
 */
export class IFrameworkIntegration {
  /**
   * Initializes the integration with the specific web framework instance.
   * This method should set up global error handlers for the framework.
   *
   * @param {object} framework - The instance of the web framework (e.g., Fastify app, Express app).
   * @param {object} [options={}] - Integration-specific options. May include a reference to ErrorSystem.
   * @param {ErrorSystem} [options.errorSystem] - An instance of the ErrorSystem for centralized error processing.
   * @param {object} [options.logger] - A logger instance.
   * @returns {Promise<void>|void}
   * @throws {Error} If initialization fails or framework instance is invalid.
   */
  async initialize(framework, options = {}) { // [cite: 337]
    throw new Error('IFrameworkIntegration.initialize() must be implemented by subclass.');
  }

  /**
   * Maps a raw error (often framework-specific or a native JavaScript Error)
   * to a standardized CoreError instance or one of its subclasses.
   *
   * @param {Error} frameworkError - The raw error object caught by the framework.
   * @param {object} [requestContext={}] - Optional context from the request (e.g., request.id, url, method).
   * @returns {CoreError} An instance of CoreError or its subclass.
   * @throws {Error} If mapping fails.
   */
  mapError(frameworkError, requestContext = {}) { // [cite: 339]
    throw new Error('IFrameworkIntegration.mapError() must be implemented by subclass.');
  }

  /**
   * Serializes a CoreError instance into a format suitable for an HTTP response body.
   *
   * @param {CoreError} coreError - The CoreError instance to serialize.
   * @param {object} [requestContext={}] - Optional context from the request.
   * @returns {object} A plain object representing the error response payload.
   * @throws {Error} If serialization fails.
   */
  serializeError(coreError, requestContext = {}) { // [cite: 338]
    throw new Error('IFrameworkIntegration.serializeError() must be implemented by subclass.');
  }

  /**
   * Optional method for integrations to perform cleanup during ErrorSystem shutdown.
   * @returns {Promise<void>|void}
   */
  async shutdown() {
    // Optional: Subclasses can implement this if they need to clean up resources.
  }
}

// For clarity, an interface is often not exported as default if it's truly just a contract.
// However, if it's used as a base class from which others must inherit (as in JS), default export is fine.
// export default IFrameworkIntegration;