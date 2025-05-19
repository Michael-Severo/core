/**
 * @file src/core/errors/integrations/index.js
 * @description Barrel file for exporting error handling integration interfaces and modules.
 */

import { IFrameworkIntegration } from './IFrameworkIntegration.js';
import {
  FastifyErrorHandler,
  createFastifyLoggerErrorSerializer
} from './fastify/index.js'; // Imports from the fastify integration's own index.js

// You would add other integrations here if they existed, e.g.:
// import { ExpressErrorHandler } from './express/index.js';

export {
  IFrameworkIntegration,
  FastifyErrorHandler,
  createFastifyLoggerErrorSerializer,
  // ExpressErrorHandler, // Example if it existed
};

// Optionally, provide a default export if that suits your module consumption pattern,
// though named exports are generally clear for ES Modules.
// export default {
//   IFrameworkIntegration,
//   fastify: {
//     FastifyErrorHandler,
//     createFastifyLoggerErrorSerializer,
//   },
//   // express: { ExpressErrorHandler }
// };