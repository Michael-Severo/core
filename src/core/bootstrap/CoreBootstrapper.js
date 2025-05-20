/**
 * @file src/core/bootstrap/CoreBootstrapper.js
 * @description Handles the bootstrapping of TSMIS core systems and optionally
 * registers application-specific modules before full initialization.
 */

import { createContainerSystem } from '../container/index.js';
import { coreSystemsManifest, defaultCoreContainerConfig, coreSystemInitOrder } from '../core.manifest.js';
import { CoreError, ErrorCodes } from '../errors/index.js';
import { SYSTEM_STATUS, DEFAULT_CONFIG } from '../common/SystemConstants.js';

export class CoreBootstrapper {
  /**
   * @param {object} appConfig - The global application configuration.
   * @param {object} logger - The application logger instance.
   * @param {Array<object>} [applicationModules=[]] - An array of application-specific module definitions
   * to be registered before core initialization. Each definition: { name, Class, config }.
   */
  constructor(appConfig, logger, applicationModules = []) {
    this.appConfig = appConfig || {};
    this.logger = logger || console;
    this.applicationModules = applicationModules || []; // Store app modules to be registered
    this.container = null;
  }

  /**
   * Bootstraps the core TSMIS systems and application-specific modules.
   * 1. Creates a root ContainerSystem.
   * 2. Registers essential services (appConfig, logger, containerSystem self-registration).
   * 3. Registers core systems defined in core.manifest.js.
   * 4. Registers application-specific modules provided during construction.
   * 5. Initializes the ContainerSystem, which in turn initializes all registered components.
   * @returns {Promise<ContainerSystem>} The initialized root container instance.
   * @throws {CoreError} If core bootstrapping fails.
   */
  async bootstrapCore() {
    this.logger.info('[CoreBootstrapper] Starting TSMIS core systems bootstrap...');

    const appContainerConfigOverrides = this.appConfig.core?.containerSystem || this.appConfig.core?.container || {};
    
    // Construct a deterministic initialization order
    // Start with essentials, then core manifest order, then any app-specific additions not already included.
    let finalInitOrder = [
        'config', // Renamed from appConfig for consistency with system dependencies
        'logger',
        'containerSystem', // Self-reference
        ...coreSystemInitOrder, // From core.manifest.js
    ];
    // Add any app-specific initOrder items not already present
    if (appContainerConfigOverrides.initOrder && Array.isArray(appContainerConfigOverrides.initOrder)) {
        appContainerConfigOverrides.initOrder.forEach(item => {
            if (!finalInitOrder.includes(item)) {
                finalInitOrder.push(item);
            }
        });
    }
    // Ensure uniqueness
    finalInitOrder = [...new Set(finalInitOrder)];

    const containerConfigForBootstrap = {
      ...defaultCoreContainerConfig, // Defaults from core.manifest.js
      ...appContainerConfigOverrides, // App-specific overrides for container
      initOrder: finalInitOrder,      // Set the carefully constructed initOrder
      maxErrorHistory: appContainerConfigOverrides.maxErrorHistory || defaultCoreContainerConfig.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY,
    };

    this.container = createContainerSystem({
      config: { // Config for the ContainerSystem component itself
        container: containerConfigForBootstrap
      },
      // Pass logger to container's constructor if ContainerSystem is designed to use it for pre-init logging
      // logger: this.logger 
    });
    this.logger.info('[CoreBootstrapper] Root ContainerSystem created.');

    // Register fundamental components
    this.container.register('config', () => this.appConfig); // Register as 'config'
    this.container.register('logger', () => this.logger);
    this.container.register('containerSystem', () => this.container); // Self-registration
    this.logger.info('[CoreBootstrapper] config, logger, and containerSystem (self) registered.');

    // Register core systems from the manifest
    this.logger.info('[CoreBootstrapper] Registering core systems from manifest...');
    for (const systemDef of coreSystemsManifest) {
      if (!systemDef.name || !systemDef.factory) {
        this.logger.warn(`[CoreBootstrapper] Invalid core system definition in manifest, skipping: ${JSON.stringify(systemDef)}`);
        continue;
      }
      this.container.register(systemDef.name, systemDef.factory);
      this.logger.info(`[CoreBootstrapper] Core system '${systemDef.name}' registered.`);
    }
    this.logger.info('[CoreBootstrapper] All core systems from manifest registered.');

    // Register application-specific modules (if any were provided)
    // This happens *before* container.initialize() so they are part of the main init wave.
    if (this.applicationModules && this.applicationModules.length > 0) {
        this.logger.info('[CoreBootstrapper] Registering application-specific modules...');
        const moduleSystem = await this.container.resolve('moduleSystem'); // Resolve ModuleSystem first
        if (!moduleSystem) {
            const error = new CoreError(ErrorCodes.CORE.INTERNAL_ERROR, "ModuleSystem could not be resolved by CoreBootstrapper to register application modules.");
            this.logger.error(error.message, error.toJSON());
            throw error;
        }
        for (const modDef of this.applicationModules) {
            if (modDef.name && modDef.Class) {
                try {
                    await moduleSystem.register(modDef.name, modDef.Class, modDef.config || this.appConfig[modDef.name] || {});
                    this.logger.info(`[CoreBootstrapper] Application module '${modDef.name}' registered.`);
                } catch (moduleRegError) {
                    const error = new CoreError(
                        ErrorCodes.CORE.INITIALIZATION_FAILED,
                        `CoreBootstrapper failed to register application module '${modDef.name}': ${moduleRegError.message}`,
                        { phase: 'app-module-registration', moduleName: modDef.name, originalErrorName: moduleRegError.name },
                        { cause: moduleRegError }
                    );
                    this.logger.error(error.message, error.toJSON());
                    // Decide if this should be a fatal error for the entire bootstrap
                    throw error; 
                }
            } else {
                this.logger.warn(`[CoreBootstrapper] Invalid application module definition provided, skipping: ${JSON.stringify(modDef)}`);
            }
        }
        this.logger.info('[CoreBootstrapper] Application-specific modules registered.');
    }


    try {
      this.logger.info('[CoreBootstrapper] Initializing ContainerSystem and all registered components (core and application)...');
      await this.container.initialize();
      this.logger.info(`[CoreBootstrapper] All systems and modules initialized successfully. Container status: ${this.container.getSystemStatus().status}`);
      return this.container;
    } catch (error) {
      // If error is already CoreError, use its details, otherwise wrap
      const bootstrapError = !(error instanceof CoreError)
        ? new CoreError(
            ErrorCodes.CORE.INITIALIZATION_FAILED, // Using a CORE prefixed code
            `CoreBootstrapper failed during final container initialization: ${error.message}`,
            { phase: 'core-bootstrap-final-init', originalErrorName: error.name },
            { cause: error }
          )
        : error;

      this.logger.error(`[CoreBootstrapper] CRITICAL FAILURE during final system initialization: ${bootstrapError.message}`, bootstrapError.toJSON ? bootstrapError.toJSON() : bootstrapError);
      
      if (this.container && 
          this.container.state && // Check if state exists
          this.container.state.status !== SYSTEM_STATUS.SHUTDOWN && 
          this.container.state.status !== SYSTEM_STATUS.CREATED) {
          this.logger.info('[CoreBootstrapper] Attempting to shutdown container due to core bootstrap failure...');
          await this.container.shutdown().catch(shutdownError => {
              this.logger.error('[CoreBootstrapper] Error during container shutdown after core bootstrap failure:', shutdownError);
          });
      }
      throw bootstrapError; 
    }
  }
}

/**
 * Factory function for creating a CoreBootstrapper instance.
 * @param {object} appConfig - The global application configuration.
 * @param {object} logger - The application logger instance.
 * @param {Array<object>} [applicationModules=[]] - Application-specific modules to register.
 * @returns {CoreBootstrapper}
 */
export function createCoreBootstrapper(appConfig, logger, applicationModules = []) {
  return new CoreBootstrapper(appConfig, logger, applicationModules);
}