/**
 * @file src/core/core.manifest.js
 * @description Manifest file for defining core TSMIS systems to be bootstrapped.
 * It lists core system factories and provides default container configurations.
 */

// Import core system factory functions
import { createErrorSystem } from './errors/index.js';
import { createEventBusSystem } from './event/index.js';
import { createModuleSystem } from './module/index.js';
import { createRouterSystem } from './router/index.js';

// Note: ContainerSystem is the orchestrator itself and is created directly by CoreBootstrapper,
// so it's not typically listed in this manifest to be created by itself.

/**
 * Array of core system definitions for the CoreBootstrapper.
 * Each object in the array should define:
 * - name: (string) The name under which the system will be registered in the container.
 * - factory: (Function) The factory function used to create an instance of the system.
 * * The factory functions are expected to have a 'dependencies' static-like property
 * (e.g., createErrorSystem.dependencies = ErrorSystem.dependencies) which the
 * ContainerSystem will use to resolve and inject dependencies.
 */
export const coreSystemsManifest = Object.freeze([
  {
    name: 'errorSystem',
    factory: createErrorSystem,
    // No need to list dependencies here; they should be on the factory function itself.
  },
  {
    name: 'eventBusSystem',
    factory: createEventBusSystem,
  },
  {
    name: 'moduleSystem',
    factory: createModuleSystem,
  },
  {
    name: 'routerSystem',
    factory: createRouterSystem,
  }
  // Future core infrastructure services (e.g., MetricsSystem, CacheManager)
  // could be added to this manifest for automatic registration.
]);

/**
 * Default initialization order preference for key core systems.
 * This order is used by CoreBootstrapper to configure the ContainerSystem.
 * 'appConfig', 'logger', and 'containerSystem' (self-registration) are typically
 * handled as prerequisites by the CoreBootstrapper before systems in this list.
 */
export const coreSystemInitOrder = Object.freeze([
  'errorSystem',    // Error handling should be up very early.
  'eventBusSystem', // Eventing often used by other systems.
  'moduleSystem',   // Manages business modules, which might depend on above.
  'routerSystem',   // Manages routing, often one of the last core pieces.
]);

/**
 * Default base configuration for the root ContainerSystem when bootstrapping core systems.
 * Application-specific configuration can merge with or override these defaults.
 */
export const defaultCoreContainerConfig = Object.freeze({
  // initOrder: Will be constructed by CoreBootstrapper, typically prepending
  // 'appConfig', 'logger', 'containerSystem' to the coreSystemInitOrder.
  maxErrorHistory: 25, // Default max internal errors for the ContainerSystem itself.
  // Other container-specific settings can be defined here.
});