/**
 * @file ContainerSystem.js
 * @description Dependency Injection (DI) and Inversion of Control (IoC) container.
 * Manages component lifecycles, dependencies, and system initialization.
 */

import { EventEmitter } from 'events';
import { ConfigError, ServiceError } from '../errors/index.js'; // Assuming errors/index.js exports these
import { ErrorCodes } from '../errors/ErrorCodes.js'; // Assuming ErrorCodes are in their own file
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

// Node.js built-in modules for discovery
import { readdir, stat } from 'fs/promises'; // For scanDirectory
import { join, dirname, basename } from 'path'; // For scanDirectory and loadConfig
import { existsSync } from 'fs'; // For loadConfig

export class ContainerSystem extends EventEmitter {
  static dependencies = ['config', 'errorSystem']; // For its own config and error handling
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new ContainerSystem instance.
   * @param {object} [deps={}] - Dependencies for the ContainerSystem.
   * @param {object} [deps.config={}] - Configuration object for the container itself.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance for centralized error reporting.
   */
  constructor(deps = {}) {
    super();
    this.deps = {
      config: deps.config || {},
      errorSystem: deps.errorSystem, // errorSystem might be a component it manages
                                     // so internal errors might need careful handling if errorSystem isn't resolved yet.
                                     // Using console for very early errors is an option.
    };

    this.components = new Map();
    this.instances = new Map();
    this.dependencies = new Map();
    this.manifests = new Map();
    // this.initialized is now driven by this.state.status

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of ContainerSystem
      metrics: new Map(),
      healthChecks: new Map(),
    };

    this.registerHealthCheck('container.state', this.checkSystemState.bind(this));
    this.registerHealthCheck('container.components', this.checkComponentStatus.bind(this));
  }

  /**
   * Handles internal operational errors of the ContainerSystem.
   * Logs the error to internal state and forwards to ErrorSystem if available.
   * @private
   * @param {Error} error - The error object.
   * @param {object} [context={}] - Additional context.
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof ConfigError || error instanceof ServiceError)
      ? new ServiceError(ErrorCodes.CORE.INTERNAL, error.message, context, { cause: error })
      : error;

    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.container?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('container.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });

    // Use safeHandleError, which will use console if errorSystem is not ready/available
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'ContainerSystem', ...context });
  }

  /**
   * Register a component manifest.
   * @param {string} type - Component type.
   * @param {object} manifest - Component manifest.
   */
  registerManifest(type, manifest) {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
        const err = new ConfigError(ErrorCodes.CORE.INVALID_OPERATION, `Cannot register manifest on a shutdown container: ${type}`);
        this._handleInternalError(err, { type }); // Log, but rethrow as it's a programming error
        throw err;
    }
    if (this.manifests.has(type)) {
      throw new ConfigError( // This is an immediate operational error, throw directly
        ErrorCodes.CONFIG.DUPLICATE_MANIFEST, // Assuming an appropriate code
        `Manifest already registered for type: ${type}`
      );
    }
    this.manifests.set(type, manifest);
    this.recordMetric('container.manifests.registered', 1, { type });
    this.emit('manifest:registered', { type, manifest });
  }

  /**
   * Register a component with the container.
   * @param {string} name - Component name.
   * @param {Function|object} Component - Component constructor, factory function, or instance.
   * @param {object} [options={}] - Registration options (e.g., singleton: true).
   * @returns {ContainerSystem} This instance for chaining.
   */
  register(name, Component, options = {}) {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
        const err = new ConfigError(ErrorCodes.CORE.INVALID_OPERATION, `Cannot register component on a shutdown container: ${name}`);
        this._handleInternalError(err, { name });
        throw err;
    }
    if (this.components.has(name)) {
      throw new ConfigError(
        ErrorCodes.CONFIG.DUPLICATE_COMPONENT, // [cite: 14]
        `Component ${name} is already registered` // [cite: 14]
      );
    }

    this.components.set(name, {
      Component,
      options: {
        singleton: true, // Default to singleton
        ...options,
      },
    });
    // Store dependencies if provided directly on the Component (static property)
    this.dependencies.set(name, Component.dependencies || []); // [cite: 16]

    this.recordMetric('container.components.registered', 1, { name });
    this.emit('component:registered', { name, Component }); // [cite: 16]
    return this;
  }

  /**
   * Discover components in a directory.
   * @param {string} type - Component type (must match a registered manifest).
   * @param {string} basePath - Base directory path to scan.
   * @returns {Promise<Map<string, object>>} A map of discovered components.
   */
  async discover(type, basePath) {
    if (!this.manifests.has(type)) {
      throw new ConfigError( // [cite: 17]
        ErrorCodes.CONFIG.INVALID_TYPE, // Assuming an appropriate code
        `No manifest registered for type: ${type}` // [cite: 17]
      );
    }

    this.recordMetric('container.discovery.started', 1, { type, basePath });
    try {
      const manifest = this.manifests.get(type);
      const componentPaths = await this.scanDirectory(basePath); // [cite: 18]
      const discoveredComponents = new Map(); // [cite: 19]

      for (const path of componentPaths) {
        try {
          const component = await this.loadComponent(path, manifest); // [cite: 19]
          if (component) { // [cite: 20]
            discoveredComponents.set(component.name, component); // [cite: 20]
          }
        } catch (error) {
          // Log individual component load errors but continue discovery
          const discoveryError = new ServiceError(
            ErrorCodes.SERVICE.LOAD_FAILED, // Assuming an appropriate code
            `Error loading component during discovery from ${path}`,
            { path, type, originalMessage: error.message },
            { cause: error }
          );
          await this._handleInternalError(discoveryError, { phase: 'discovery-load', path });
          this.emit('discovery:error', { path, error: discoveryError }); // [cite: 21]
        }
      }

      this.emit('discovery:completed', { type, components: discoveredComponents }); // [cite: 22]
      this.recordMetric('container.discovery.completed', 1, { type, count: discoveredComponents.size });
      return discoveredComponents;
    } catch (error) {
      const discoveryFailedError = new ServiceError(
        ErrorCodes.SERVICE.DISCOVERY_FAILED, // [cite: 23]
        `Failed to discover ${type} components from ${basePath}`, // [cite: 23]
        { type, basePath, originalMessage: error.message },
        { cause: error }
      );
      await this._handleInternalError(discoveryFailedError, { phase: 'discovery', type });
      this.recordMetric('container.discovery.failed', 1, { type });
      throw discoveryFailedError; // [cite: 24]
    }
  }

  /**
   * Load a component from a file path based on a manifest.
   * @private
   * @param {string} path - Path to the component file.
   * @param {object} manifest - The manifest for this component type.
   * @returns {Promise<object|null>} The loaded component or null if disabled/invalid.
   */
  async loadComponent(path, manifest) {
    try {
      const config = await this.loadConfig(path); // [cite: 24]
      if (config.enabled === false) return null; // [cite: 25]

      if (manifest.configSchema) {
        await this.validateConfig(config, manifest.configSchema); // [cite: 25]
      }
      const implementation = await this.loadImplementation(path); // [cite: 25]
      return { // [cite: 26]
        name: config.name,
        config,
        implementation,
      };
    } catch (error) {
      // Let discover method handle logging this error via _handleInternalError
      throw new ConfigError( // [cite: 27]
        ErrorCodes.CONFIG.LOAD_FAILED, // [cite: 27]
        `Failed to load component from ${path}`, // [cite: 27]
        { path, originalMessage: error.message },
        { cause: error } // [cite: 28]
      );
    }
  }

  /**
   * Get an instance of a component.
   * @param {string} name - Component name.
   * @param {object} [parentDepsStack=[]] - Used internally to detect circular dependencies.
   * @returns {Promise<any>} The resolved component instance.
   */
  async resolve(name, parentDepsStack = []) {
    if (!this.components.has(name)) {
      throw new ServiceError( // [cite: 28]
        ErrorCodes.SERVICE.UNKNOWN_COMPONENT, // [cite: 28]
        `Component ${name} is not registered.` // [cite: 29]
      );
    }

    if (parentDepsStack.includes(name)) {
        throw new ConfigError(
            ErrorCodes.CONFIG.CIRCULAR_DEPENDENCY,
            `Circular dependency detected: ${parentDepsStack.join(' -> ')} -> ${name}`
        );
    }

    const { Component, options } = this.components.get(name); // [cite: 29]

    if (options.singleton && this.instances.has(name)) { // [cite: 30]
      return this.instances.get(name); // [cite: 30]
    }

    const currentDepsStack = [...parentDepsStack, name];
    const componentDepsList = this.dependencies.get(name) || []; // [cite: 31]
    const resolvedDeps = {}; // [cite: 32]

    for (const dep of componentDepsList) {
      if (!this.components.has(dep)) {
        throw new ConfigError(
            ErrorCodes.CONFIG.MISSING_DEPENDENCY,
            `Dependency '${dep}' required by '${name}' is not registered.`
        );
      }
      resolvedDeps[dep] = await this.resolve(dep, currentDepsStack); // [cite: 32]
    }

    let instance;
    if (typeof Component === 'function') { // [cite: 34]
      // Check if it's a class constructor (has a prototype and is not an arrow function)
      if (Component.prototype && typeof Component.prototype.constructor === 'function') { // [cite: 34]
        instance = new Component(resolvedDeps); // [cite: 34]
      } else { // Factory function
        instance = await Promise.resolve(Component(resolvedDeps)); // [cite: 35]
      }
    } else { // Pre-resolved instance
      instance = Component; // [cite: 36]
    }

    // If container is already initialized and instance has an initialize method, call it.
    // This handles components resolved after global initialization.
    if (this.state.status === SYSTEM_STATUS.RUNNING && typeof instance.initialize === 'function') { // [cite: 37]
      await instance.initialize(); // [cite: 38]
    }

    if (options.singleton) {
      this.instances.set(name, instance); // [cite: 38]
    }

    this.recordMetric('container.components.resolved', 1, { name, singleton: !!options.singleton });
    this.emit('component:resolved', { name, instance }); // [cite: 39]
    return instance; // [cite: 40]
  }

  /**
   * Initialize all registered components in dependency order.
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new ServiceError(ErrorCodes.SERVICE.ALREADY_INITIALIZED, 'ContainerSystem is already initialized or initializing.'); // [cite: 40]
      await this._handleInternalError(err);
      // Depending on strictness, you might re-throw or just return
      return;
    }

    this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'ContainerSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    const initStartTime = Date.now();
    this.state.startTime = initStartTime; // Mark start of initialization process

    try {
      const order = this.resolveDependencyOrder(); // [cite: 41]
      for (const name of order) { // [cite: 42]
        const instance = await this.resolve(name); // [cite: 42]
        // The initialize call during resolve handles already-initialized container state.
        // However, for the main init loop, we ensure it's called if not already.
        if (this.state.status !== SYSTEM_STATUS.RUNNING && typeof instance.initialize === 'function') { // [cite: 43]
          // Check instance.initialized or similar if components track their own init state
          // to avoid double initialization if resolve already did it.
          // For now, we assume resolve's initialize is for post-container-init resolutions.
          await instance.initialize(); // [cite: 43]
        }
      }

      //this.initialized = true; // Deprecated, use state.status
      this.state.status = SYSTEM_STATUS.RUNNING;
      const initTime = Date.now() - initStartTime;
      this.recordMetric('container.initialization.time', initTime);
      this.recordMetric('container.initialization.success', 1);
      this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'ContainerSystem', durationMs: initTime, timestamp: new Date().toISOString() }); // [cite: 44]
      this.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'ContainerSystem', timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('container.initialization.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'initialization' });
      throw error instanceof ServiceError || error instanceof ConfigError ? error : new ServiceError(
        ErrorCodes.SERVICE.INITIALIZATION_FAILED, // Generic initialization failure code
        'ContainerSystem failed to initialize.',
        { originalMessage: error.message },
        { cause: error }
      );
    }
  }

  /**
   * Resolve dependency order for initialization using topological sort.
   * @private
   * @returns {Array<string>} Ordered list of component names.
   */
  resolveDependencyOrder() {
    const visited = new Set(); // [cite: 45]
    const visiting = new Set(); // To detect circular dependencies [cite: 46]
    const order = []; // [cite: 46]

    const visit = (name) => {
      if (visited.has(name)) return; // [cite: 46]
      if (visiting.has(name)) { // [cite: 47]
        throw new ConfigError( // [cite: 47]
          ErrorCodes.CONFIG.CIRCULAR_DEPENDENCY, // [cite: 47]
          `Circular dependency detected involving: ${name}. Path: ${Array.from(visiting).join(' -> ')} -> ${name}` // [cite: 48]
        );
      }

      visiting.add(name); // [cite: 48]
      const componentDefinition = this.components.get(name);
      if (!componentDefinition) { // Should not happen if called after registration
          visiting.delete(name);
          throw new ConfigError(ErrorCodes.SERVICE.UNKNOWN_COMPONENT, `Component ${name} definition not found while resolving dependency order.`);
      }

      const deps = this.dependencies.get(name) || []; // [cite: 48]
      for (const dep of deps) { // [cite: 49]
        if (!this.components.has(dep)) { // [cite: 49]
          throw new ConfigError( // [cite: 49]
            ErrorCodes.CONFIG.MISSING_DEPENDENCY, // [cite: 49]
            `Dependency ${dep} required by ${name} is not registered.` // [cite: 50]
          );
        }
        visit(dep); // [cite: 50]
      }

      visiting.delete(name); // [cite: 51]
      visited.add(name); // [cite: 51]
      order.push(name); // [cite: 51]
    };

    // Prioritize specific core systems if they are present
    // This is a common pattern but can be made more dynamic if needed
    const prioritizedOrder = this.deps.config?.container?.initOrder || [ // [cite: 51]
      'errorSystem', // Error system should ideally be first
      'config',      // Config service if it's a component
      'eventBusSystem',
      'moduleSystem',
      'routerSystem'
      // other essential systems
    ];

    for (const name of prioritizedOrder) {
      if (this.components.has(name) && !visited.has(name)) { // [cite: 52]
        visit(name); // [cite: 53]
      }
    }

    // Visit any remaining components
    for (const name of this.components.keys()) { // [cite: 53]
      if (!visited.has(name)) { // Check !visited instead of !order.includes
        visit(name); // [cite: 54]
      }
    }
    return order; // [cite: 55]
  }

  /**
   * Shut down all initialized components in reverse dependency order.
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) {
      return;
    }
    this.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'ContainerSystem' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN;
    const shutdownStartTime = Date.now();

    try {
      // Resolve order again in case components were added/removed, though ideally not after init.
      // It's safer to use the order from last successful initialization if available and unchanged.
      // For simplicity, we re-resolve. Or, store the init order.
      const order = this.resolveDependencyOrder().reverse(); // [cite: 55]

      for (const name of order) { // [cite: 56]
        const instance = this.instances.get(name); // [cite: 56]
        if (instance && typeof instance.shutdown === 'function') { // [cite: 57]
          try {
            await instance.shutdown(); // [cite: 57]
          } catch (error) {
            const shutdownError = new ServiceError(
                ErrorCodes.SERVICE.SHUTDOWN_FAILED, // Assuming an appropriate code
                `Error shutting down component ${name}`,
                { component: name, originalMessage: error.message },
                { cause: error }
            );
            await this._handleInternalError(shutdownError, { phase: 'shutdown-component', component: name });
            this.emit('shutdown:error', { component: name, error: shutdownError }); // [cite: 58]
            // Continue shutting down other components
          }
        }
      }

      this.instances.clear(); // [cite: 59]
      // this.components.clear(); // Typically components are not cleared on shutdown, only instances.
      // this.dependencies.clear();
      // this.manifests.clear();
      // this.initialized = false; // Deprecated
      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.state.startTime = null; // Clear start time as it's no longer running
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('container.shutdown.time', shutdownTime);
      this.recordMetric('container.shutdown.success', 1);
      this.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'ContainerSystem', durationMs: shutdownTime, timestamp: new Date().toISOString() }); // [cite: 60]

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('container.shutdown.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'shutdown' });
      throw error instanceof ServiceError || error instanceof ConfigError ? error : new ServiceError(
        ErrorCodes.SERVICE.SHUTDOWN_FAILED,
        'ContainerSystem failed to shutdown.',
        { originalMessage: error.message },
        { cause: error }
      );
    }
  }

  // --- Discovery and Loading Methods (largely from original, with minor error handling adjustments) ---

  /**
   * Scan a directory for component files.
   * @private
   */
  async scanDirectory(basePath) { // [cite: 60]
    try {
      const entries = await readdir(basePath, { withFileTypes: true }); // [cite: 61]
      const files = []; // [cite: 62]

      for (const entry of entries) { // [cite: 62]
        const fullPath = join(basePath, entry.name); // [cite: 62]
        if (entry.isDirectory()) { // [cite: 63]
          files.push(...await this.scanDirectory(fullPath)); // [cite: 64]
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs'))) { // [cite: 64]
          files.push(fullPath); // [cite: 65]
        }
      }
      return files; // [cite: 66]
    } catch (error) {
      throw new ServiceError( // [cite: 66]
        ErrorCodes.SERVICE.DIRECTORY_SCAN_FAILED, // [cite: 66]
        `Failed to scan directory: ${basePath}`, // [cite: 67]
        { basePath, originalMessage: error.message },
        { cause: error } // [cite: 67]
      );
    }
  }

  /**
   * Load component configuration from a file path or embedded in component.
   * @private
   */
  async loadConfig(path) { // [cite: 67]
    try {
      const dir = dirname(path); // [cite: 68]
      const filename = basename(path, '.js'); // Assuming .js, adjust if other extensions are primary [cite: 68]
      // Consider .mjs, .cjs too if `filename` is used for more than just config name
      const configPathJs = join(dir, `${filename}.config.js`); // [cite: 69]
      // Add checks for .mjs, .cjs config files if needed
      // const configPathMjs = join(dir, `${filename}.config.mjs`);
      // const configPathCjs = join(dir, `${filename}.config.cjs`);

      let actualConfigPath;
      if (existsSync(configPathJs)) actualConfigPath = configPathJs;
      // else if (existsSync(configPathMjs)) actualConfigPath = configPathMjs;
      // else if (existsSync(configPathCjs)) actualConfigPath = configPathCjs;

      if (actualConfigPath) { // [cite: 69]
        const configModule = await import(actualConfigPath); // [cite: 69]
        return configModule.default || configModule; // [cite: 70]
      }

      // Fallback: try to extract config from the component file itself
      const componentModule = await import(path); // [cite: 70]
      if (componentModule.config) { // [cite: 71]
        return typeof componentModule.config === 'function'
          ? await Promise.resolve(componentModule.config()) // Handle async config functions [cite: 71]
          : componentModule.config; // [cite: 72]
      }

      return { name: filename, enabled: true }; // Default config [cite: 73]
    } catch (error) {
      throw new ConfigError( // [cite: 74]
        ErrorCodes.CONFIG.LOAD_FAILED, // [cite: 74]
        `Failed to load configuration from/for ${path}`, // [cite: 75]
        { path, originalMessage: error.message },
        { cause: error } // [cite: 75]
      );
    }
  }

  /**
   * Validate component configuration against a schema.
   * @private
   */
  async validateConfig(config, schema) { // [cite: 75]
    if (!schema) return true; // [cite: 75]

    try {
      if (!config || typeof config !== 'object') { // [cite: 76]
        throw new ConfigError(ErrorCodes.CONFIG.INVALID_CONFIG, 'Configuration must be an object.'); // [cite: 77]
      }

      for (const [key, fieldSchema] of Object.entries(schema)) { // [cite: 77]
        if (fieldSchema.required && (config[key] === undefined || config[key] === null)) { // [cite: 77]
          throw new ConfigError(ErrorCodes.CONFIG.MISSING_REQUIRED_FIELD, `Required field '${key}' is missing.`, { field: key }); // [cite: 78]
        }
        if (config[key] === undefined) continue; // [cite: 79]

        if (fieldSchema.type && typeof config[key] !== fieldSchema.type) { // [cite: 79]
          throw new ConfigError(ErrorCodes.CONFIG.INVALID_FIELD_TYPE, `Field '${key}' expects type '${fieldSchema.type}', got '${typeof config[key]}'.`, { field: key, expected: fieldSchema.type, actual: typeof config[key] }); // [cite: 80]
        }
        if (fieldSchema.enum && !fieldSchema.enum.includes(config[key])) { // [cite: 80]
          throw new ConfigError(ErrorCodes.CONFIG.INVALID_ENUM_VALUE, `Field '${key}' value '${config[key]}' not in enum [${fieldSchema.enum.join(', ')}].`, { field: key, expected: fieldSchema.enum, actual: config[key] }); // [cite: 81]
        }
        if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(config[key])) { // [cite: 81]
          throw new ConfigError(ErrorCodes.CONFIG.PATTERN_MISMATCH, `Field '${key}' does not match pattern '${fieldSchema.pattern}'.`, { field: key, pattern: fieldSchema.pattern, value: config[key] }); // [cite: 82]
        }
      }

      if (typeof schema._validate === 'function') { // [cite: 82]
        await schema._validate(config); // [cite: 83]
      }
      return true; // [cite: 84]
    } catch (error) {
      if (error instanceof ConfigError) throw error; // [cite: 84]
      throw new ConfigError( // [cite: 85]
        ErrorCodes.CONFIG.VALIDATION_FAILED, // [cite: 86]
        'Configuration validation failed.',
        { config, schemaExcerpt: Object.keys(schema), originalMessage: error.message },
        { cause: error } // [cite: 86]
      );
    }
  }

  /**
   * Load component implementation from a file path.
   * @private
   */
  async loadImplementation(path) { // [cite: 86]
    try {
      const module = await import(path); // [cite: 87]
      const filename = basename(path, '.js'); // [cite: 87] // Consider other extensions if needed

      if (module.default) return module.default; // [cite: 89]
      if (module[filename]) return module[filename]; // [cite: 90]

      for (const exportValue of Object.values(module)) { // Iterate values for broader check
        if (typeof exportValue === 'function') {
          // Prioritize classes or well-named factory functions
          if (exportValue.prototype || exportValue.name?.startsWith('create')) { // [cite: 91]
            return exportValue;
          }
        }
      }
      // If no clear main export, and only one export exists, return that.
      const exports = Object.values(module);
      if (exports.length === 1) return exports[0];

      return module; // Fallback to the whole module object [cite: 93]
    } catch (error) {
      throw new ServiceError( // [cite: 93]
        ErrorCodes.SERVICE.IMPLEMENTATION_LOAD_FAILED, // [cite: 94]
        `Failed to load implementation from ${path}`, // [cite: 94]
        { path, originalMessage: error.message },
        { cause: error } // [cite: 94]
      );
    }
  }

  // --- State, Health, Metrics Methods ---
  recordMetric(name, value, tags = {}) {
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags });
  }

  getMetrics() {
    const metrics = {};
    for (const [name, data] of this.state.metrics) {
      metrics[name] = data;
    }
    return metrics;
  }

  registerHealthCheck(name, checkFn) {
    if (typeof checkFn !== 'function') {
        const err = new ConfigError(ErrorCodes.CORE.INVALID_HANDLER, `Health check '${name}' must be a function.`);
        this._handleInternalError(err); // Log, but rethrow as it's a programming error
        throw err;
    }
    this.state.healthChecks.set(name, checkFn);
  }

  async checkHealth() {
    const results = {};
    let overallStatus = SYSTEM_STATUS.HEALTHY;

    for (const [name, checkFn] of this.state.healthChecks) {
      try {
        const checkResult = await checkFn();
        results[name] = checkResult;
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) {
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY) ? SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY;
          if (checkResult.status === SYSTEM_STATUS.UNHEALTHY) overallStatus = SYSTEM_STATUS.UNHEALTHY;
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]);
        overallStatus = SYSTEM_STATUS.UNHEALTHY;
      }
    }
    return {
      name: this.constructor.name,
      version: ContainerSystem.version,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      errorCount: this.state.errors.length,
      checks: results,
    };
  }

  async checkSystemState() {
    return createStandardHealthCheckResult(
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY,
      {
        currentStatus: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        internalErrorCount: this.state.errors.length
      }
    );
  }

  async checkComponentStatus() {
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, {
      registeredComponentCount: this.components.size,
      resolvedInstanceCount: this.instances.size,
      manifestCount: this.manifests.size,
      // Optionally list names if not too verbose for health check
      // registeredComponents: Array.from(this.components.keys()),
    });
  }

  getSystemStatus() {
    return {
        name: this.constructor.name,
        version: ContainerSystem.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString()
    };
  }
}

/**
 * Factory function for creating a ContainerSystem instance.
 * @param {object} [deps={}] - Dependencies for the ContainerSystem.
 * @returns {ContainerSystem}
 */
export function createContainerSystem(deps = {}) {
  return new ContainerSystem(deps);
}