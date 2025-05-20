/**
 * @file ContainerSystem.js
 * @description Dependency Injection (DI) and Inversion of Control (IoC) container.
 * Manages component lifecycles, dependencies, and system initialization.
 */

import { EventEmitter } from 'events';
import { CoreError } from '../errors/CoreError.js'; // Added for direct CoreError usage
import { ConfigError, ServiceError } from '../errors/index.js'; // Assuming errors/index.js exports these
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

// Node.js built-in modules for discovery
import { readdir } from 'fs/promises'; // Removed 'stat' as it's not used in scanDirectory
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
    // If error is already a ConfigError or ServiceError, use it as is.
    // Otherwise, wrap it in a ServiceError, indicating a general operational failure within the container.
    const errorToLog = (error instanceof ConfigError || error instanceof ServiceError)
      ? error
      : new ServiceError(
          ErrorCodes.SERVICE.OPERATION_FAILED, // Using unprefixed service code
          `Container internal operation failed: ${error.message}`,
          context,
          { cause: error }
        );

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
        const err = new ConfigError(
            ErrorCodes.CONFIG.VALIDATION_FAILED, // Using unprefixed config code
            `Cannot register manifest on a shutdown container: ${type}`
        );
        this._handleInternalError(err, { type }); // Log, but rethrow as it's a programming error
        throw err;
    }
    if (this.manifests.has(type)) {
      throw new ConfigError( // This is an immediate operational error, throw directly
        ErrorCodes.CONFIG.DUPLICATE_MANIFEST, // Using unprefixed config code
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
        const err = new ConfigError(
            ErrorCodes.CONFIG.VALIDATION_FAILED, // Using unprefixed config code
            `Cannot register component on a shutdown container: ${name}`
        );
        this._handleInternalError(err, { name });
        throw err;
    }
    if (this.components.has(name)) {
      throw new ConfigError(
        ErrorCodes.CONFIG.DUPLICATE_COMPONENT, // Using unprefixed config code
        `Component ${name} is already registered`
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
    this.dependencies.set(name, Component.dependencies || []);

    this.recordMetric('container.components.registered', 1, { name });
    this.emit('component:registered', { name, Component });
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
      throw new ConfigError(
        ErrorCodes.CONFIG.MANIFEST_TYPE_NOT_FOUND, // Using unprefixed config code
        `No manifest registered for type: ${type}`
      );
    }

    this.recordMetric('container.discovery.started', 1, { type, basePath });
    try {
      const manifest = this.manifests.get(type);
      const componentPaths = await this.scanDirectory(basePath);
      const discoveredComponents = new Map();

      for (const path of componentPaths) {
        try {
          const component = await this.loadComponent(path, manifest);
          if (component) {
            discoveredComponents.set(component.name, component);
          }
        } catch (error) {
          // Log individual component load errors but continue discovery
          const discoveryError = new ServiceError(
            ErrorCodes.SERVICE.COMPONENT_LOAD_FAILED, // Using unprefixed service code
            `Error loading component during discovery from ${path}`,
            { path, type, originalMessage: error.message },
            { cause: error }
          );
          await this._handleInternalError(discoveryError, { phase: 'discovery-load', path });
          this.emit('discovery:error', { path, error: discoveryError });
        }
      }

      this.emit('discovery:completed', { type, components: discoveredComponents });
      this.recordMetric('container.discovery.completed', 1, { type, count: discoveredComponents.size });
      return discoveredComponents;
    } catch (error) {
      const discoveryFailedError = new ServiceError(
        ErrorCodes.SERVICE.DISCOVERY_FAILED, // Using unprefixed service code
        `Failed to discover ${type} components from ${basePath}`,
        { type, basePath, originalMessage: error.message },
        { cause: error }
      );
      await this._handleInternalError(discoveryFailedError, { phase: 'discovery', type });
      this.recordMetric('container.discovery.failed', 1, { type });
      throw discoveryFailedError;
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
      const config = await this.loadConfig(path);
      if (config.enabled === false) return null;

      if (manifest.configSchema) {
        await this.validateConfig(config, manifest.configSchema);
      }
      const implementation = await this.loadImplementation(path);
      return {
        name: config.name,
        config,
        implementation,
      };
    } catch (error) {
      // Let discover method handle logging this error via _handleInternalError
      // This throw should be a ConfigError if loading/validation of config part failed,
      // or ServiceError if implementation load failed.
      // Since loadConfig and validateConfig throw ConfigError, and loadImplementation throws ServiceError,
      // we can check the type of error.
      if (error instanceof ConfigError) {
          throw error; // Re-throw original ConfigError
      }
      // If it's not a ConfigError from loadConfig/validateConfig, then it might be ServiceError from loadImplementation,
      // or a generic error. Wrap in ConfigError if it's related to the overall component structure/config.
      throw new ConfigError(
        ErrorCodes.CONFIG.LOAD_FAILED, // Using unprefixed config code
        `Failed to load component from ${path}`,
        { path, originalMessage: error.message },
        { cause: error }
      );
    }
  }

  /**
   * Get an instance of a component.
   * @param {string} name - Component name.
   * @param {Array<string>} [parentDepsStack=[]] - Used internally to detect circular dependencies.
   * @returns {Promise<any>} The resolved component instance.
   */
  async resolve(name, parentDepsStack = []) {
    if (!this.components.has(name)) {
      throw new ServiceError(
        ErrorCodes.SERVICE.UNKNOWN_COMPONENT, // Using unprefixed service code
        `Component ${name} is not registered.`
      );
    }

    if (parentDepsStack.includes(name)) {
        throw new ConfigError(
            ErrorCodes.CONFIG.CIRCULAR_DEPENDENCY, // Using unprefixed config code
            `Circular dependency detected: ${parentDepsStack.join(' -> ')} -> ${name}`
        );
    }

    const { Component, options } = this.components.get(name);

    if (options.singleton && this.instances.has(name)) {
      return this.instances.get(name);
    }

    const currentDepsStack = [...parentDepsStack, name];
    const componentDepsList = this.dependencies.get(name) || [];
    const resolvedDeps = {};

    for (const dep of componentDepsList) {
      if (!this.components.has(dep)) {
        throw new ConfigError(
            ErrorCodes.CONFIG.MISSING_DEPENDENCY, // Using unprefixed config code
            `Dependency '${dep}' required by '${name}' is not registered.`
        );
      }
      resolvedDeps[dep] = await this.resolve(dep, currentDepsStack);
    }

    let instance;
    if (typeof Component === 'function') {
      if (Component.prototype && typeof Component.prototype.constructor === 'function') {
        instance = new Component(resolvedDeps);
      } else { // Factory function
        instance = await Promise.resolve(Component(resolvedDeps));
      }
    } else { // Pre-resolved instance
      instance = Component;
    }

    if (this.state.status === SYSTEM_STATUS.RUNNING && typeof instance.initialize === 'function') {
      await instance.initialize();
    }

    if (options.singleton) {
      this.instances.set(name, instance);
    }

    this.recordMetric('container.components.resolved', 1, { name, singleton: !!options.singleton });
    this.emit('component:resolved', { name, instance });
    return instance;
  }

  /**
   * Initialize all registered components in dependency order.
   * @returns {Promise<void>}
   */
  async initialize() {
    // Check 1: Guard against re-initialization (THIS IS LINE 313 from the error)
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new CoreError(ErrorCodes.CORE.ALREADY_INITIALIZED, 'ContainerSystem is already initialized or initializing.');
      await this._handleInternalError(err);
      return; // Exit early
    }

    this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'ContainerSystem' });
    this.state.status = SYSTEM_STATUS.INITIALIZING;
    const initStartTime = Date.now();
    this.state.startTime = initStartTime;

    try {
      const order = this.resolveDependencyOrder();
      for (const name of order) {
        const instance = await this.resolve(name); // This resolves & caches instance

        if (name === 'errorSystem' && instance && !this.deps.errorSystem) {
          this.deps.errorSystem = instance;
          (this.deps.logger || console).info('[ContainerSystem] Self-assigned ErrorSystem instance for internal use.');
        }

        // >>> START FIX FOR RECURSION <<<
        // Call initialize on the component instance, but NOT if the instance is the ContainerSystem itself
        if (instance !== this && typeof instance.initialize === 'function') {
        // >>> END FIX FOR RECURSION <<<
          // Prevent double initialization for already resolved & initialized singletons
          if (!instance.state || instance.state.status !== SYSTEM_STATUS.RUNNING) { 
             await instance.initialize();
          }
        }
      }

      if (!this.deps.errorSystem && this.components.has('errorSystem')) {
          const esInstance = await this.resolve('errorSystem'); 
          if (esInstance && !this.deps.errorSystem) { 
              this.deps.errorSystem = esInstance;
              (this.deps.logger || console).info('[ContainerSystem] Late self-assigned ErrorSystem instance for internal use.');
          }
      }

      this.state.status = SYSTEM_STATUS.RUNNING;
      const initTime = Date.now() - initStartTime;
      this.recordMetric('container.initialization.time', initTime);
      this.recordMetric('container.initialization.success', 1);
      this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'ContainerSystem', durationMs: initTime, timestamp: new Date().toISOString() });
      this.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'ContainerSystem', timestamp: new Date().toISOString() });
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('container.initialization.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'initialization' });
      throw error instanceof ServiceError || error instanceof ConfigError ?
      error : new ServiceError(
        ErrorCodes.SERVICE.OPERATION_FAILED,
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
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new ConfigError(
          ErrorCodes.CONFIG.CIRCULAR_DEPENDENCY, // Using unprefixed config code
          `Circular dependency detected involving: ${name}. Path: ${Array.from(visiting).join(' -> ')} -> ${name}`
        );
      }

      visiting.add(name);
      const componentDefinition = this.components.get(name);
      if (!componentDefinition) {
          visiting.delete(name);
          // This indicates a required dependency was not registered, which should be caught by 'resolve' or prior checks.
          // If it happens here, it means a component in this.dependencies was not in this.components.
          throw new ConfigError(
              ErrorCodes.CONFIG.MISSING_DEPENDENCY, // Using unprefixed config code
              `Component ${name} definition not found while resolving dependency order (is it registered?).`
          );
      }

      const deps = this.dependencies.get(name) || [];
      for (const dep of deps) {
        if (!this.components.has(dep)) {
          throw new ConfigError(
            ErrorCodes.CONFIG.MISSING_DEPENDENCY, // Using unprefixed config code
            `Dependency ${dep} required by ${name} is not registered.`
          );
        }
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    const prioritizedOrder = this.deps.config?.container?.initOrder || [
      'errorSystem',
      'config',
      'eventBusSystem',
      'moduleSystem',
      'routerSystem'
    ];
    for (const name of prioritizedOrder) {
      if (this.components.has(name) && !visited.has(name)) {
        visit(name);
      }
    }

    for (const name of this.components.keys()) {
      if (!visited.has(name)) {
        visit(name);
      }
    }
    return order;
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
      const order = this.resolveDependencyOrder().reverse();

      for (const name of order) {
        const instance = this.instances.get(name);
        if (instance && typeof instance.shutdown === 'function') {
          try {
            await instance.shutdown();
          } catch (error) {
            const shutdownError = new ServiceError(
                ErrorCodes.SERVICE.OPERATION_FAILED, // Using unprefixed service code
                `Error shutting down component ${name}`,
                { component: name, originalMessage: error.message },
                { cause: error }
            );
            await this._handleInternalError(shutdownError, { phase: 'shutdown-component', component: name });
            this.emit('shutdown:error', { component: name, error: shutdownError });
            // Continue shutting down other components
          }
        }
      }

      this.instances.clear();
      this.state.status = SYSTEM_STATUS.SHUTDOWN;
      this.state.startTime = null;
      const shutdownTime = Date.now() - shutdownStartTime;
      this.recordMetric('container.shutdown.time', shutdownTime);
      this.recordMetric('container.shutdown.success', 1);
      this.emit(LIFECYCLE_EVENTS.SHUTDOWN, { system: 'ContainerSystem', durationMs: shutdownTime, timestamp: new Date().toISOString() });

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR;
      this.recordMetric('container.shutdown.failure', 1, { error: error.code });
      await this._handleInternalError(error, { phase: 'shutdown' });
      throw error instanceof ServiceError || error instanceof ConfigError ?
      error : new ServiceError( // Default wrapper
        ErrorCodes.SERVICE.OPERATION_FAILED, // Using unprefixed service code
        'ContainerSystem failed to shutdown.',
        { originalMessage: error.message },
        { cause: error }
      );
    }
  }

  // --- Discovery and Loading Methods ---

  /**
   * Scan a directory for component files.
   * @private
   */
  async scanDirectory(basePath) {
    try {
      const entries = await readdir(basePath, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        const fullPath = join(basePath, entry.name);
        if (entry.isDirectory()) {
          files.push(...await this.scanDirectory(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs'))) {
          files.push(fullPath);
        }
      }
      return files;
    } catch (error) {
      throw new ServiceError(
        ErrorCodes.SERVICE.DIRECTORY_SCAN_FAILED, // Using unprefixed service code
        `Failed to scan directory: ${basePath}`,
        { basePath, originalMessage: error.message },
        { cause: error }
      );
    }
  }

  /**
   * Load component configuration from a file path or embedded in component.
   * @private
   */
  async loadConfig(path) {
    try {
      const dir = dirname(path);
      const filename = basename(path, '.js');
      const configPathJs = join(dir, `${filename}.config.js`);

      let actualConfigPath;
      if (existsSync(configPathJs)) actualConfigPath = configPathJs;

      if (actualConfigPath) {
        const configModule = await import(actualConfigPath);
        return configModule.default || configModule;
      }

      const componentModule = await import(path);
      if (componentModule.config) {
        return typeof componentModule.config === 'function'
          ? await Promise.resolve(componentModule.config())
          : componentModule.config;
      }

      return { name: filename, enabled: true }; // Default config
    } catch (error) {
      throw new ConfigError(
        ErrorCodes.CONFIG.LOAD_FAILED, // Using unprefixed config code
        `Failed to load configuration from/for ${path}`,
        { path, originalMessage: error.message },
        { cause: error }
      );
    }
  }

  /**
   * Validate component configuration against a schema.
   * @private
   */
  async validateConfig(config, schema) {
    if (!schema) return true;

    try {
      if (!config || typeof config !== 'object') {
        throw new ConfigError(ErrorCodes.CONFIG.INVALID_CONFIG_OBJECT, 'Configuration must be an object.'); // Using unprefixed
      }

      for (const [key, fieldSchema] of Object.entries(schema)) {
        if (fieldSchema.required && (config[key] === undefined || config[key] === null)) {
          throw new ConfigError(ErrorCodes.CONFIG.MISSING_REQUIRED_FIELD, `Required field '${key}' is missing.`, { field: key }); // Using unprefixed
        }
        if (config[key] === undefined) continue;

        if (fieldSchema.type && typeof config[key] !== fieldSchema.type) {
          throw new ConfigError(ErrorCodes.CONFIG.INVALID_FIELD_TYPE, `Field '${key}' expects type '${fieldSchema.type}', got '${typeof config[key]}'.`, { field: key, expected: fieldSchema.type, actual: typeof config[key] }); // Using unprefixed
        }
        if (fieldSchema.enum && !fieldSchema.enum.includes(config[key])) {
          throw new ConfigError(ErrorCodes.CONFIG.INVALID_ENUM_VALUE, `Field '${key}' value '${config[key]}' not in enum [${fieldSchema.enum.join(', ')}].`, { field: key, expected: fieldSchema.enum, actual: config[key] }); // Using unprefixed
        }
        if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(config[key])) {
          throw new ConfigError(ErrorCodes.CONFIG.PATTERN_MISMATCH, `Field '${key}' does not match pattern '${fieldSchema.pattern}'.`, { field: key, pattern: fieldSchema.pattern, value: config[key] }); // Using unprefixed
        }
      }

      if (typeof schema._validate === 'function') {
        await schema._validate(config);
      }
      return true;
    } catch (error) {
      if (error instanceof ConfigError) throw error;
      throw new ConfigError(
        ErrorCodes.CONFIG.VALIDATION_FAILED, // Using unprefixed config code
        'Configuration validation failed.',
        { config, schemaExcerpt: Object.keys(schema), originalMessage: error.message },
        { cause: error }
      );
    }
  }

  /**
   * Load component implementation from a file path.
   * @private
   */
  async loadImplementation(path) {
    try {
      const module = await import(path);
      const filename = basename(path, '.js');

      if (module.default) return module.default;
      if (module[filename]) return module[filename];

      for (const exportValue of Object.values(module)) {
        if (typeof exportValue === 'function') {
          if (exportValue.prototype || exportValue.name?.startsWith('create')) {
            return exportValue;
          }
        }
      }
      const exports = Object.values(module);
      if (exports.length === 1) return exports[0];

      return module; // Fallback to the whole module object
    } catch (error) {
      throw new ServiceError(
        ErrorCodes.SERVICE.IMPLEMENTATION_LOAD_FAILED, // Using unprefixed service code
        `Failed to load implementation from ${path}`,
        { path, originalMessage: error.message },
        { cause: error }
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
        const err = new ConfigError(
            ErrorCodes.CONFIG.VALIDATION_FAILED, // Using unprefixed config code
            `Health check '${name}' must be a function.`
        );
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
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY) ?
          SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY;
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
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : (this.state.status === SYSTEM_STATUS.CREATED || this.state.status === SYSTEM_STATUS.INITIALIZING ? SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY ),
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