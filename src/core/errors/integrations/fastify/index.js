/**
 * @file src/core/errors/integrations/fastify/index.js
 * @description Barrel file for exporting Fastify error integration components.
 */

import { FastifyErrorHandler } from './FastifyErrorHandler.js';
import { createFastifyLoggerErrorSerializer } from './FastifyErrorSerializer.js';

export {
  FastifyErrorHandler,
  createFastifyLoggerErrorSerializer
};

// Optional: If you want to export a pre-configured or default setup function
// similar to the original `setupErrorHandler`, you could add it here,
// but it would typically be part of application bootstrap code or a higher-level setup utility.
// For example:
//
// export function setupFastifyErrorHandling(fastifyInstance, errorSystemInstance, loggerInstance) {
//   const handler = new FastifyErrorHandler();
//   handler.initialize(fastifyInstance, { errorSystem: errorSystemInstance, logger: loggerInstance });
//
//   // To configure logger serializer (example, actual logger config is more complex):
//   // if (fastifyInstance.log && fastifyInstance.log.serializers) {
//   //   fastifyInstance.log.serializers.error = createFastifyLoggerErrorSerializer(handler.serializeError.bind(handler));
//   // }
//   return handler; // Return the instance if needed
// }

// The original file [cite: 372] exported `setupErrorHandler` from `handler.js`
// and `errorSerializer` from `serializer.js`.
// Our refactored approach exports the class `FastifyErrorHandler` and the utility
// function `createFastifyLoggerErrorSerializer`. The actual setup (instantiation
// and initialization of FastifyErrorHandler) is now handled by ErrorSystem.registerIntegration
// or directly in the application's Fastify setup code.