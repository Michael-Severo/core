/**
 * @file src/core/router/integrations/index.js
 * @description Barrel file for exporting router integration interfaces and available adapters.
 */

import { IRouterAdapter } from './IRouterAdapter.js';
import { FastifyAdapter } from './fastify/index.js'; // Imports FastifyAdapter from its own index.js

export {
  IRouterAdapter,
  FastifyAdapter,
};

// Optional default export for grouping, if preferred:
// export default {
//   IRouterAdapter,
//   adapters: {
//     FastifyAdapter, // The only adapter currently
//   }
// };