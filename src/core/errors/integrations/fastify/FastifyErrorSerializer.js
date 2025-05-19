/**
 * @file FastifyErrorSerializer.js
 * @description Provides a utility for creating a Fastify logger error serializer
 * using a standardized error serialization method.
 */

/**
 * Creates a Fastify logger error serializer object.
 * This is intended to be used when configuring the Fastify logger instance.
 * The provided `serializeMethod` should be the `serializeError` method from an
 * instantiated and configured FastifyErrorHandler.
 *
 * @example
 * // In your Fastify setup:
 * // const errorSystem = await container.resolve('errorSystem');
 * // const fastifyFrameworkInstance = Fastify({ logger: true }); // example
 * // const options = { errorSystem, logger: fastifyFrameworkInstance.log };
 * // const fastifyErrorHandlerInstance = new FastifyErrorHandler(); // ErrorSystem would typically do this
 * // await fastifyErrorHandlerInstance.initialize(fastifyFrameworkInstance, options);
 * //
 * // const fastify = Fastify({
 * //   logger: {
 * //     level: 'info',
 * //     serializers: {
 * //       // Use the serializeError method from your configured FastifyErrorHandler instance
 * //       error: createFastifyLoggerErrorSerializer(fastifyErrorHandlerInstance.serializeError.bind(fastifyErrorHandlerInstance))
 * //     }
 * //   }
 * // });
 *
 * @param {Function} serializeMethod - The method to use for serializing errors.
 * This should typically be `fastifyErrorHandlerInstance.serializeError.bind(fastifyErrorHandlerInstance)`.
 * It's expected to take an error and an optional context, returning a plain object.
 * @returns {{serializer: Function}} A Fastify logger serializer object for errors.
 */
export function createFastifyLoggerErrorSerializer(serializeMethod) {
  if (typeof serializeMethod !== 'function') {
    console.warn('[FastifyErrorSerializer] serializeMethod provided is not a function. Logger might not serialize errors correctly.');
    // Fallback to a very basic serializer
    return {
      serializer: (error) => {
        return {
          message: error.message,
          stack: error.stack,
          code: error.code,
          name: error.name,
          type: Object.prototype.toString.call(error).slice(8, -1)
        };
      }
    };
  }
  return {
    // The serializer function for Fastify logger takes only the error object.
    // Our `serializeError` method takes `(coreError, requestContext = {})`.
    // For logger purposes, requestContext might not be available or relevant.
    // We pass an empty context.
    serializer: (error) => serializeMethod(error, {}),
  };
}

// Note: The original file directly imported a singleton.
// This version is a utility function because FastifyErrorHandler is no longer a singleton.
// The application setup code is responsible for instantiating FastifyErrorHandler
// (likely via ErrorSystem.registerIntegration) and then using its serializeError
// method when configuring Fastify's logger.

// If you want a more direct export similar to the original, and assuming you
// will *always* have a single, globally accessible instance of FastifyErrorHandler
// (which is less aligned with the DI pattern for ErrorSystem managing integrations),
// then that instance would need to be exported from somewhere and imported here.
// The functional approach above is more flexible.