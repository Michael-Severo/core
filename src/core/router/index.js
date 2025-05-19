/**
 * @file src/core/router/index.js
 * @description Main public interface for the TSMIS Router System.
 * Exports CoreRouter, RouterSystem, RoutableModule, their factory functions,
 * and available framework integration adapters.
 */

import { CoreRouter } from './CoreRouter.js';
import { RouterSystem, createRouterSystem } from './RouterSystem.js';
import { RoutableModule, createRoutableModule } from './RoutableModule.js';

// Import integration components from ./integrations/index.js
// which now exports IRouterAdapter and FastifyAdapter
import {
  IRouterAdapter,
  FastifyAdapter
} from './integrations/index.js';

// Export all core router classes and their factory functions
export {
  CoreRouter,         // The core routing engine
  RouterSystem,       // The managing facade for CoreRouter
  createRouterSystem, // Factory for RouterSystem
  RoutableModule,     // Base class for modules that define routes
  createRoutableModule, // Factory for RoutableModule
};

// Export adapter interface and specific adapters
export {
  IRouterAdapter,     // Interface for all router adapters
  FastifyAdapter,     // Specific adapter for Fastify
  // ExpressAdapter, // Omitted as per user request
};

// Optional: A default export grouping the most common components,
// similar to the original structure, but adapted.
export default {
  CoreRouter,
  RouterSystem,
  createRouterSystem,
  RoutableModule,
  createRoutableModule,
  integrations: {
    IRouterAdapter,
    FastifyAdapter,
    // ExpressAdapter, // Omitted
  },
};