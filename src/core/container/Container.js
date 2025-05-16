// src/core/container/Container.js

import { EventEmitter } from 'events';
import { CoreError, ConfigError, ServiceError } from '../errors/index.js';
// import { ValidationService } from '../validation/ValidationService.js';

export class CoreContainer extends EventEmitter {
  constructor() {
    super();
    this.components = new Map();
    this.instances = new Map();
    this.dependencies = new Map();
    this.manifests = new Map();
    this.initialized = false;
  }

  /**
   * Register a component manifest
   * @param {string} type - Component type
   * @param {object} manifest - Component manifest
   */
  registerManifest(type, manifest) {
    if (this.manifests.has(type)) {
      throw new ConfigError(
        'DUPLICATE_MANIFEST',
        `Manifest already registered for type: ${type}`
      );
    }
    this.manifests.set(type, manifest);
    this.emit('manifest:registered', { type, manifest });
  }

  /**
   * Register a component with the container
   * @param {string} name - Component name
   * @param {Class} Component - Component constructor
   * @param {object} options - Registration options
   */
  register(name, Component, options = {}) {
    if (this.components.has(name)) {
      throw new ConfigError(
        'DUPLICATE_COMPONENT',
        `Component ${name} is already registered`
      );
    }

    // Store component definition
    this.components.set(name, {
      Component,
      options: {
        singleton: true,
        ...options
      }
    });

    // Store dependencies
    this.dependencies.set(name, Component.dependencies || []);

    this.emit('component:registered', { name, Component });
    return this;
  }

  /**
   * Discover components in a directory
   * @param {string} type - Component type
   * @param {string} basePath - Base directory path
   */
  async discover(type, basePath) {
    if (!this.manifests.has(type)) {
      throw new ConfigError(
        'INVALID_TYPE',
        `No manifest registered for type: ${type}`
      );
    }

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
          this.emit('discovery:error', { path, error });
        }
      }

      this.emit('discovery:completed', { type, components: discoveredComponents });
      return discoveredComponents;
    } catch (error) {
      throw new ServiceError(
        'DISCOVERY_FAILED',
        `Failed to discover ${type} components`,
        { originalError: error }
      );
    }
  }

  /**
   * Load a component from a path
   * @private
   */
  async loadComponent(path, manifest) {
    try {
      const config = await this.loadConfig(path);
      if (config.enabled === false) return null;

      await this.validateConfig(config, manifest.configSchema);
      const implementation = await this.loadImplementation(path);

      return {
        name: config.name,
        config,
        implementation
      };
    } catch (error) {
      throw new ConfigError(
        'LOAD_FAILED',
        `Failed to load component from ${path}`,
        { originalError: error }
      );
    }
  }

  /**
   * Get an instance of a component
   * @param {string} name - Component name
   */
  async resolve(name) {
    if (!this.components.has(name)) {
      throw new ServiceError(
        'UNKNOWN_COMPONENT',
        `Component ${name} is not registered`
      );
    }
  
    const { Component, options } = this.components.get(name);
  
    // Return existing instance for singletons
    if (options.singleton && this.instances.has(name)) {
      return this.instances.get(name);
    }
  
    // Resolve dependencies first
    const deps = this.dependencies.get(name) || [];
    const resolvedDeps = {};
  
    for (const dep of deps) {
      resolvedDeps[dep] = await this.resolve(dep);
    }
  
    // Handle different component types
    let instance;
    if (typeof Component === 'function') {
      if (Component.prototype) {
        // Class constructor
        instance = new Component(resolvedDeps);
      } else {
        // Factory function - handle both sync and async
        instance = await Promise.resolve(Component(resolvedDeps));
      }
    } else {
      instance = Component;
    }
  
    // Initialize if container is initialized
    if (this.initialized && typeof instance.initialize === 'function') {
      await instance.initialize();
    }
  
    // Cache singleton instance
    if (options.singleton) {
      this.instances.set(name, instance);
    }
  
    this.emit('component:resolved', { name, instance });
    return instance;
  }
  /**
   * Initialize all registered components
   */
  async initialize() {
    if (this.initialized) {
      throw new ServiceError(
        'ALREADY_INITIALIZED',
        'Container is already initialized'
      );
    }
    //console.log('Initializing Container...');
    const order = this.resolveDependencyOrder();

    for (const name of order) {
      //console.log(`Resolving component: ${name}`);
      const instance = await this.resolve(name);
      if (typeof instance.initialize === 'function') {
        //console.log(`Initializing component: ${name}`);
        await instance.initialize();
      }
    }

    this.initialized = true;
    this.emit('initialized');

    
  }

  /**
   * Resolve dependency order for initialization
   * @private
   */
  resolveDependencyOrder() {
    const visited = new Set();
    const visiting = new Set();
    const order = [];

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new ConfigError(
          'CIRCULAR_DEPENDENCY',
          `Circular dependency detected: ${name}`
        );
      }

      visiting.add(name);
      
      const component = this.components.get(name);
      const deps = this.dependencies.get(name) || [];
      
      for (const dep of deps) {
        if (!this.components.has(dep)) {
          throw new ConfigError(
            'MISSING_DEPENDENCY',
            `Dependency ${dep} required by ${name} is not registered`
          );
        }
        visit(dep);
      }
      
      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    // Ensure core systems are initialized first
    const initOrder = [
      'errorSystem',
      'config',
      'eventBusSystem',
      'moduleSystem'
    ];

    for (const name of initOrder) {
      if (this.components.has(name)) {
        visit(name);
      }
    }

    // Then handle any remaining components
    for (const name of this.components.keys()) {
      if (!order.includes(name)) {
        visit(name);
      }
    }

    return order;
  }

async shutdown() {
    // Shutdown in reverse dependency order
    const order = this.resolveDependencyOrder().reverse();
  
    for (const name of order) {
      const instance = this.instances.get(name);
      if (instance && typeof instance.shutdown === 'function') {
        try {
          await instance.shutdown();
        } catch (error) {
          // Log error but continue shutdown process
          this.emit('shutdown:error', { 
            component: name, 
            error 
          });
        }
      }
    }
  
    this.instances.clear();
    this.initialized = false;
    this.emit('shutdown');
  }

/**
 * Scan a directory for component files
 * @private
 * @param {string} basePath - Directory to scan
 * @returns {Promise<Array<string>>} - Array of file paths
 */
async scanDirectory(basePath) {
  try {
    // We need to use fs promises API for async directory operations
    const { readdir, stat } = require('fs/promises');
    const { join } = require('path');
    
    // Read directory contents
    const entries = await readdir(basePath, { withFileTypes: true });
    const files = [];
    
    // Process each entry
    for (const entry of entries) {
      const fullPath = join(basePath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subDirFiles = await this.scanDirectory(fullPath);
        files.push(...subDirFiles);
      } else if (entry.isFile() && (
        entry.name.endsWith('.js') || 
        entry.name.endsWith('.mjs') || 
        entry.name.endsWith('.cjs')
      )) {
        // Add JavaScript files
        files.push(fullPath);
      }
    }
    
    return files;
  } catch (error) {
    throw new ServiceError(
      'DIRECTORY_SCAN_FAILED',
      `Failed to scan directory: ${basePath}`,
      { basePath },
      { cause: error }
    );
  }
}

/**
 * Load component configuration from a file path
 * @private
 * @param {string} path - Path to component
 * @returns {Promise<Object>} - Component configuration
 */
async loadConfig(path) {
  try {
    // First check for dedicated config file
    const { existsSync } = require('fs');
    const { dirname, basename, join } = require('path');
    
    const dir = dirname(path);
    const name = basename(path, '.js');
    const configPath = join(dir, `${name}.config.js`);
    
    // If dedicated config file exists, load it
    if (existsSync(configPath)) {
      const config = await import(configPath);
      return config.default || config;
    }
    
    // Otherwise, try to extract config from the component file
    const component = await import(path);
    
    // Check for config property or method
    if (component.config) {
      return typeof component.config === 'function' 
        ? component.config() 
        : component.config;
    }
    
    // Use default component name if no config found
    return {
      name: name,
      enabled: true
    };
  } catch (error) {
    throw new ConfigError(
      'CONFIG_LOAD_FAILED',
      `Failed to load configuration from ${path}`,
      { path },
      { cause: error }
    );
  }
}

/**
 * Validate component configuration against schema
 * @private
 * @param {Object} config - Component configuration
 * @param {Object} schema - Configuration schema
 * @returns {Promise<boolean>} - Validation result
 */
async validateConfig(config, schema) {
  // If no schema is provided, assume valid
  if (!schema) return true;
  
  try {
    // Basic validation
    if (!config || typeof config !== 'object') {
      throw new ConfigError(
        'INVALID_CONFIG',
        'Configuration must be an object'
      );
    }
    
    // Check required fields
    for (const [key, field] of Object.entries(schema)) {
      if (field.required && (config[key] === undefined || config[key] === null)) {
        throw new ConfigError(
          'MISSING_REQUIRED_FIELD',
          `Required field '${key}' is missing in configuration`,
          { field: key }
        );
      }
      
      // Skip validation for undefined optional fields
      if (config[key] === undefined) continue;
      
      // Type validation
      if (field.type && typeof config[key] !== field.type) {
        throw new ConfigError(
          'INVALID_FIELD_TYPE',
          `Field '${key}' should be of type '${field.type}', got '${typeof config[key]}'`,
          { field: key, expected: field.type, actual: typeof config[key] }
        );
      }
      
      // Enum validation
      if (field.enum && !field.enum.includes(config[key])) {
        throw new ConfigError(
          'INVALID_ENUM_VALUE',
          `Field '${key}' should be one of [${field.enum.join(', ')}], got '${config[key]}'`,
          { field: key, expected: field.enum, actual: config[key] }
        );
      }
      
      // Pattern validation
      if (field.pattern && !new RegExp(field.pattern).test(config[key])) {
        throw new ConfigError(
          'PATTERN_MISMATCH',
          `Field '${key}' does not match pattern '${field.pattern}'`,
          { field: key, pattern: field.pattern, value: config[key] }
        );
      }
    }
    
    // If a custom validate function is provided, use it for advanced validation
    if (schema._validate && typeof schema._validate === 'function') {
      await schema._validate(config);
    }
    
    return true;
  } catch (error) {
    if (error instanceof ConfigError) {
      throw error;
    }
    
    throw new ConfigError(
      'CONFIG_VALIDATION_FAILED',
      'Failed to validate configuration',
      { config, schema },
      { cause: error }
    );
  }
}

/**
 * Load component implementation from a file path
 * @private
 * @param {string} path - Path to component
 * @returns {Promise<Function|Class|Object>} - Component implementation
 */
async loadImplementation(path) {
  try {
    // Import the module
    const module = await import(path);
    
    // Look for default export or a named export matching the filename
    const { basename } = require('path');
    const name = basename(path, '.js');
    
    // Prioritize default export
    if (module.default) {
      return module.default;
    }
    
    // Then try named export matching filename
    if (module[name]) {
      return module[name];
    }
    
    // Then try to find a function or class that seems to be the main export
    for (const [exportName, exportValue] of Object.entries(module)) {
      // Look for create* factory functions
      if (exportName.startsWith('create') && typeof exportValue === 'function') {
        return exportValue;
      }
      
      // Look for classes
      if (typeof exportValue === 'function' && exportValue.prototype) {
        return exportValue;
      }
    }
    
    // If no suitable implementation found, return the whole module
    return module;
  } catch (error) {
    throw new ServiceError(
      'IMPLEMENTATION_LOAD_FAILED',
      `Failed to load implementation from ${path}`,
      { path },
      { cause: error }
    );
  }
}  
}