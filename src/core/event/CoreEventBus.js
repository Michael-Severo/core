/**
 * @file CoreEventBus.js
 * @description Centralized event bus for robust event management, queuing, and history.
 */

import { EventEmitter } from 'events'; // Node.js built-in
import { EventError } from '../errors/index.js'; // Assuming errors/index.js exports EventError
import { ErrorCodes } from '../errors/ErrorCodes.js';
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

// Assuming crypto.randomUUID is available (Node.js 15.6.0+, or use a polyfill/library for broader compatibility)
// For older Node or browsers, you might need a library like 'uuid'.
// const { v4: uuidv4 } = require('uuid'); // Example if using uuid library

export class CoreEventBus extends EventEmitter {
  static dependencies = ['errorSystem', 'config']; // [cite: 2135]
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new CoreEventBus instance.
   * @param {object} [deps={}] - Dependencies for the CoreEventBus.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance.
   * @param {object} [deps.config={}] - Configuration object.
   */
  constructor(deps = {}) { // [cite: 2138]
    super();
    this.deps = {
      errorSystem: deps.errorSystem,
      config: deps.config || {}, // [cite: 2139]
    };

    this.queues = new Map(); // [cite: 2140]
    this.subscriptions = new Map(); // [cite: 2140]
    this.history = new Map(); // [cite: 2140]
    this.maxHistorySize = this.deps.config?.eventBus?.maxHistorySize || // [cite: 2141] Adjusted config path
                          this.deps.config?.eventHistory?.maxSize || // [cite: 2142] Kept original for compatibility
                          DEFAULT_CONFIG.MAX_ERROR_HISTORY; // [cite: 2142] Default if none specified
    // this.initialized is now driven by this.state.status

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of CoreEventBus
      metrics: new Map(),
      healthChecks: new Map(),
    }; // [cite: 2144]

    this._originalEmit = null; // For wildcard forwarding
    this._processingNewListener = false; // [cite: 2145] Guard for newListener recursion

    this.setupDefaultHealthChecks(); // [cite: 2145, 2312]
    this._setupInternalListeners(); // [cite: 2146] Setup newListener/removeListener logic
  }

  /**
   * Sets up internal listeners for managing wildcard forwarding.
   * @private
   */
  _setupInternalListeners() {
    this.on('newListener', (eventName, listener) => {
      if (this._processingNewListener) return;
      this._processingNewListener = true;
      try {
        const eventNameStr = typeof eventName === 'string' ? eventName : String(eventName);
        if (eventNameStr === '*') { // [cite: 2147]
          this._enableWildcardForwarding(); // [cite: 2147]
        }
      }
      finally {
        this._processingNewListener = false;
      }
    });
    this.on('removeListener', (eventName) => {
      const eventNameStr = typeof eventName === 'string' ? eventName : String(eventName);
      if (eventNameStr === '*' && this.listenerCount('*') === 0) { // [cite: 2149]
        this._disableWildcardForwarding(); // [cite: 2149]
      }
    });
  }

  /**
   * Handles internal operational errors of the CoreEventBus.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof EventError)
      ? new EventError(ErrorCodes.EVENT.INTERNAL_ERROR, error.message, context, { cause: error }) // Uses unprefixed 'INTERNAL_ERROR'
      : error;
    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.eventBus?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift(); // [cite: 2154]
    }
    this.recordMetric('eventbus.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'CoreEventBus', ...context }); // [cite: 2155]
  }

  /**
   * Initializes the CoreEventBus.
   * @returns {Promise<CoreEventBus>}
   */
  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new EventError(ErrorCodes.EVENT.ALREADY_INITIALIZED, 'CoreEventBus is already initialized or initializing.'); // [cite: 2156] Uses unprefixed
      await this._handleInternalError(err, { currentStatus: this.state.status }); // [cite: 2156]
      return this; // [cite: 2157]
    }

    this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'CoreEventBus' });
    this.state.status = SYSTEM_STATUS.INITIALIZING; // [cite: 2158]
    this.state.startTime = Date.now(); // [cite: 2158]

    try {
      // Wildcard forwarding setup is now handled by newListener/removeListener
      this.state.status = SYSTEM_STATUS.RUNNING; // [cite: 2159]
      this.recordMetric('eventbus.initialized.success', 1, { timestamp: Date.now() }); // [cite: 2160]
      this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'CoreEventBus', timestamp: new Date().toISOString() }); // [cite: 2164]
      this.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'CoreEventBus', timestamp: new Date().toISOString() }); // [cite: 2165]
    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; // [cite: 2166]
      this.recordMetric('eventbus.initialized.failure', 1, { error: error.code, timestamp: Date.now() }); // [cite: 2167]
      await this._handleInternalError(error, { phase: 'initialization' }); // [cite: 2169]
      throw error instanceof EventError ?
      error : new EventError( // [cite: 2170]
        ErrorCodes.EVENT.INITIALIZATION_FAILED, // Uses unprefixed // [cite: 2170]
        'CoreEventBus failed to initialize.', // [cite: 2170]
        { originalMessage: error.message }, // [cite: 2170]
        { cause: error } // [cite: 2170]
      );
    }
    return this;
  }

  /**
   * Enables wildcard event forwarding by wrapping the emit method.
   * @private
   */
  _enableWildcardForwarding() {
    if (this._originalEmit) return; // [cite: 2173]
    this._originalEmit = super.emit; // [cite: 2173]

    const newEmit = (eventName, ...args) => {
      const result = this._originalEmit.call(this, eventName, ...args); // [cite: 2178]

      if (eventName !== '*' && this.listenerCount('*') > 0) { // [cite: 2180]
        if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && args[0].id && args[0].name) {
            this._originalEmit.call(this, '*', args[0]); // [cite: 2186]
        } else {
            this._originalEmit.call(this, '*', eventName, ...args); // [cite: 2189]
        }
      }
      return result;
    };
    this.emit = newEmit;

    this.recordMetric('eventbus.wildcard.enabled', 1); // [cite: 2190]
  }

  /**
   * Disables wildcard event forwarding by restoring the original emit method.
   * @private
   */
  _disableWildcardForwarding() {
    if (!this._originalEmit) return; // [cite: 2192]
    this.emit = this._originalEmit; // [cite: 2192]
    this._originalEmit = null; // [cite: 2193]
    this.recordMetric('eventbus.wildcard.disabled', 1); // [cite: 2193]
  }

  /**
   * Emits an event with queuing, history, and pattern matching.
   * @param {string} eventName - Event name.
   * @param {*} data - Event data.
   * @param {object} [options={}] - Emission options (e.g., queue, metadata).
   * @returns {Promise<boolean>} Whether the event had listeners (or was queued).
   */
  async emit(eventName, data, options = {}) { // This is the public emit, potentially wrapped
    if (typeof eventName !== 'string' || !eventName.trim()) { // [cite: 2197]
      const err = new EventError(
        ErrorCodes.EVENT.INVALID_EVENT_NAME, // Uses unprefixed // [cite: 2197]
        'Event name must be a non-empty string.', // [cite: 2197]
        { providedEventName: eventName } // [cite: 2197]
      );
      await this._handleInternalError(err, { eventName, data, options });
      throw err;
    }

    const eventId = global.crypto && typeof global.crypto.randomUUID === 'function'
                    ? global.crypto.randomUUID() // [cite: 2199]
                    : Math.random().toString(36).substring(2) + Date.now().toString(36); // [cite: 2200]

    const event = { // [cite: 2200]
      id: eventId, // [cite: 2200]
      name: eventName, // [cite: 2200]
      data, // [cite: 2200]
      timestamp: new Date().toISOString(), // [cite: 2200]
      metadata: options.metadata || {}, // [cite: 2201]
    };

    try {
      this.trackEvent(event); // [cite: 2202]
      this.recordMetric('eventbus.events.emitted', 1, { eventName, queued: !!options.queue }); // [cite: 2203]

      if (options.queue) { // [cite: 2203]
        await this.queueEvent(event, options); // [cite: 2204]
        return true; // [cite: 2204]
      }

      const emitFn = this._originalEmit || super.emit; // [cite: 2206]
      return emitFn.call(this, eventName, event); // Pass the wrapped event object // [cite: 2206]

    } catch (error) {
      await this._handleInternalError(error, { eventName, eventId: event.id, options }); // [cite: 2207]
      throw error instanceof EventError ?
      error : new EventError( // [cite: 2207]
        ErrorCodes.EVENT.EMISSION_FAILED, // Uses unprefixed // [cite: 2208]
        `Failed to emit event: ${eventName}`, // [cite: 2208]
        { eventName, eventId: event.id, options }, // [cite: 2208]
        { cause: error } // [cite: 2208]
      );
    }
  }

  /**
   * Subscribes to events matching a pattern.
   * @param {string} pattern - Event pattern (e.g., 'user.created', 'item.*', '*').
   * @param {Function} handler - Async function to handle the event: async (event) => {}.
   * @param {object} [options={}] - Subscription options.
   * @returns {string} Subscription ID.
   */
  subscribe(pattern, handler, options = {}) { // [cite: 2210]
    if (typeof pattern !== 'string' || !pattern.trim()) { // [cite: 2213]
      const err = new EventError(ErrorCodes.EVENT.INVALID_PATTERN, 'Event pattern must be a non-empty string.', { pattern }); // Uses unprefixed // [cite: 2214]
      this._handleInternalError(err); // Log, then throw // [cite: 2214]
      throw err; // [cite: 2215]
    }
    if (typeof handler !== 'function') { // [cite: 2215]
      const err = new EventError(ErrorCodes.EVENT.INVALID_HANDLER, 'Event handler must be a function.', { pattern }); // Uses unprefixed // [cite: 2216]
      this._handleInternalError(err); // [cite: 2216]
      throw err; // [cite: 2217]
    }

    const subscriptionId = global.crypto && typeof global.crypto.randomUUID === 'function'
                        ? global.crypto.randomUUID() // [cite: 2218]
                        : Math.random().toString(36).substring(2) + Date.now().toString(36); // [cite: 2219]
    const subscription = { // [cite: 2219]
      id: subscriptionId, // [cite: 2219]
      pattern, // [cite: 2219]
      handler, // [cite: 2219]
      options: options || {}, // [cite: 2220]
      created: new Date().toISOString(), // [cite: 2220]
      // internalHandler will store the actual function passed to EventEmitter.on
    }; // [cite: 2221]

    try {
      if (pattern === '*') { // [cite: 2221]
        subscription.internalHandler = (event) => handler(event); // [cite: 2222]
        super.on('*', subscription.internalHandler); // [cite: 2222]
      } else if (pattern.includes('*')) {
        const regexPattern = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'); // [cite: 2224]
        subscription.internalHandler = (event) => { // [cite: 2224]
          if (event && typeof event.name === 'string' && regexPattern.test(event.name)) { // [cite: 2225]
            handler(event); // [cite: 2225]
          }
        };
        super.on('*', subscription.internalHandler); // Listen on wildcard, filter by name // [cite: 2226]
      } else {
        subscription.internalHandler = (event) => handler(event); // [cite: 2227]
        super.on(pattern, subscription.internalHandler); // [cite: 2227]
      }

      this.subscriptions.set(subscription.id, subscription); // [cite: 2228]
      this.recordMetric('eventbus.subscriptions.added', 1, { pattern }); // [cite: 2229]
      return subscription.id; // [cite: 2229]
    } catch (error) {
      // Use _handleInternalError for subscription setup issues
      this._handleInternalError(error, { phase: 'subscribe', pattern }); // This line had await, but _handleInternalError is async. Assuming the original intent.
      throw error instanceof EventError ?
      error : new EventError( // [cite: 2232]
        ErrorCodes.EVENT.SUBSCRIPTION_FAILED, // Uses unprefixed // [cite: 2232]
        `Failed to subscribe to pattern: ${pattern}`, // [cite: 2232]
        { pattern }, // [cite: 2232]
        { cause: error } // [cite: 2232]
      );
    }
  }

  /**
   * Unsubscribes from events.
   * @param {string} subscriptionId - The ID returned by subscribe.
   * @returns {boolean} True if unsubscribed, false otherwise.
   */
  unsubscribe(subscriptionId) { // [cite: 2234]
    const subscription = this.subscriptions.get(subscriptionId); // [cite: 2236]
    if (!subscription) { // [cite: 2236]
      this.deps.logger?.warn(`[CoreEventBus] Unsubscribe failed: Subscription ID '${subscriptionId}' not found.`); // [cite: 2237]
      return false; // [cite: 2237]
    }

    try {
      const { pattern, internalHandler } = subscription; // [cite: 2238]
      if (pattern.includes('*')) { // [cite: 2238]
        super.removeListener('*', internalHandler); // [cite: 2239]
      } else {
        super.removeListener(pattern, internalHandler); // [cite: 2240]
      }

      this.subscriptions.delete(subscriptionId); // [cite: 2241]
      this.recordMetric('eventbus.subscriptions.removed', 1, { pattern: subscription.pattern }); // [cite: 2242]
      return true; // [cite: 2242]
    } catch (error) {
      this._handleInternalError(error, { phase: 'unsubscribe', subscriptionId }); // This line had await.
      if (!(error instanceof EventError)) {
          this.deps.logger?.error(`[CoreEventBus] Error during removeListener for ${subscriptionId}: ${error.message}`); // [cite: 2247]
      }
      return false; // Indicate potential issue // [cite: 2247]
    }
  }

  /**
   * Adds an event to a named queue for later processing.
   * @param {object} event - The full event object.
   * @param {object} [options={}] - Queuing options (e.g., immediate).
   * @returns {Promise<boolean>} True if queued successfully.
   */
  async queueEvent(event, options = {}) { // [cite: 2248]
    try {
      const queueName = event.name; // [cite: 2250]
      const queue = this.queues.get(queueName) || []; // [cite: 2250]
      const queueItem = { event, options, timestamp: new Date().toISOString() }; // [cite: 2251]
      queue.push(queueItem); // [cite: 2251]
      this.queues.set(queueName, queue); // [cite: 2252]

      this.recordMetric('eventbus.events.queued', 1, { eventName: queueName, queueSize: queue.length }); // [cite: 2253]

      if (options.immediate) { // [cite: 2253]
        await this.processQueue(queueName); // [cite: 2254]
      }
      return true; // [cite: 2255]
    } catch (error) {
      await this._handleInternalError(error, { phase: 'queueEvent', eventName: event.name }); // [cite: 2256]
      throw error instanceof EventError ?
      error : new EventError( // [cite: 2257]
        ErrorCodes.EVENT.QUEUE_OPERATION_FAILED, // Uses unprefixed (assuming it's 'QUEUE_OPERATION_FAILED') // [cite: 2257]
        `Failed to queue event: ${event.name}`, // [cite: 2257]
        { eventName: event.name }, // [cite: 2257]
        { cause: error } // [cite: 2257]
      );
    }
  }

  /**
   * Processes all events in a named queue.
   * @param {string} queueName - The name of the queue to process.
   * @returns {Promise<number>} The number of events processed.
   */
  async processQueue(queueName) { // [cite: 2259]
    const queue = this.queues.get(queueName) || []; // [cite: 2261]
    if (queue.length === 0) return 0;

    let processedCount = 0;
    const startTime = Date.now(); // [cite: 2262]
    const BATCH_SIZE = this.deps.config?.eventBus?.queueBatchSize || 100; // Process in batches // [cite: 2262]

    const itemsToProcess = queue.splice(0, Math.min(queue.length, BATCH_SIZE)); // [cite: 2263]
    for (const { event } of itemsToProcess) { // [cite: 2263]
      try {
        const emitFn = this._originalEmit || super.emit; // [cite: 2264]
        emitFn.call(this, event.name, event); // Emit the full event object // [cite: 2264]
        processedCount++; // [cite: 2265]
      } catch (handlerError) {
        const appError = new EventError(
          ErrorCodes.EVENT.HANDLER_ERROR, // Uses unprefixed // [cite: 2267]
          `Error in handler for event: ${event.name} (ID: ${event.id}) during queue processing.`, // [cite: 2267]
          { eventName: event.name, eventId: event.id }, // [cite: 2267]
          { cause: handlerError } // [cite: 2267]
        );
        await this.handleError(appError, { phase: 'processQueue-handler', queueName, eventId: event.id }); // [cite: 2269]
      }
    }

    this.recordMetric('eventbus.queue.processed', processedCount, { queueName, processingTimeMs: Date.now() - startTime }); // [cite: 2270]
    if (queue.length > 0) {
        this.recordMetric('eventbus.queue.remaining', queue.length, { queueName }); // [cite: 2271]
    }
    return processedCount; // [cite: 2271]
  }

  /**
   * Public error handler to be used by event listeners if they want to report errors
   * through the EventBus's configured ErrorSystem.
   * @param {Error} error - The error object from the event listener.
   * @param {object} [context={}] - Context from the event listener.
   */
  async handleError(error, context = {}) { // [cite: 2272]
    this.recordMetric('eventbus.errors.reported_by_listener', 1, { errorName: error.name, errorCode: error.code }); // [cite: 2276]
    await safeHandleError(this.deps.errorSystem, error, { source: 'CoreEventBusListener', ...context }); // [cite: 2276]
  }


  /**
   * Processes all events in all queues.
   * @returns {Promise<Object.<string, number>>} An object mapping queue names to processed counts.
   */
  async processAllQueues() { // [cite: 2277]
    const results = {}; // [cite: 2279]
    const queueNames = Array.from(this.queues.keys()); // [cite: 2279]
    let totalProcessed = 0; // [cite: 2280]
    for (const queueName of queueNames) { // [cite: 2280]
      try {
        results[queueName] = await this.processQueue(queueName); // [cite: 2281]
        totalProcessed += results[queueName]; // [cite: 2282]
      } catch (error) {
        await this._handleInternalError(error, { phase: 'processAllQueues', queueName }); // [cite: 2283]
        results[queueName] = 0; // Mark as 0 processed for this queue due to error
      }
    }
    this.recordMetric('eventbus.all_queues.processed_total', totalProcessed); // [cite: 2285]
    return results; // [cite: 2285]
  }

  trackEvent(event) { // [cite: 2285]
    const eventHistoryQueue = this.history.get(event.name) || []; // [cite: 2286]
    eventHistoryQueue.unshift(event); // [cite: 2286]
    if (eventHistoryQueue.length > this.maxHistorySize) { // [cite: 2286]
      eventHistoryQueue.pop(); // [cite: 2287]
    }
    this.history.set(event.name, eventHistoryQueue); // [cite: 2288]
    this.recordMetric('eventbus.history.size', eventHistoryQueue.length, { eventName: event.name }); // [cite: 2289]
  }

  getHistory(eventName, options = {}) { // [cite: 2289]
    const historyQueue = this.history.get(eventName) || []; // [cite: 2290]
    if (options.limit && options.limit > 0) { // [cite: 2290]
      return historyQueue.slice(0, options.limit); // [cite: 2291]
    }
    return [...historyQueue]; // [cite: 2292]
  }

  getAllHistory(options = {}) { // [cite: 2292]
    const result = {}; // [cite: 2293]
    for (const [eventName, historyQueue] of this.history) { // [cite: 2293]
      result[eventName] = options.limit ? historyQueue.slice(0, options.limit) : [...historyQueue]; // [cite: 2294]
    }
    return result; // [cite: 2295]
  }

  async reset() { // [cite: 2295]
    this.queues.clear(); // [cite: 2296]
    this.history.clear(); // [cite: 2296]
    const eventNames = super.eventNames().filter( // [cite: 2297]
      (name) => name !== 'newListener' && name !== 'removeListener' && !name.startsWith('system:')
    );
    for (const eventName of eventNames) { // [cite: 2298]
      super.removeAllListeners(eventName); // [cite: 2299]
    }
    this.subscriptions.clear(); // [cite: 2300]
    this.recordMetric('eventbus.reset', 1); // [cite: 2301]
    if (this._originalEmit) {
        this._disableWildcardForwarding(); // [cite: 2302]
    }
  }

  async shutdown() { // [cite: 2302]
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { // [cite: 2303]
      return; // [cite: 2303]
    }
    this.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'CoreEventBus' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; // [cite: 2304]

    try {
      await this.reset(); // [cite: 2305]
      super.removeAllListeners(); // Remove ALL listeners, including internal ones // [cite: 2305]

      this.state.status = SYSTEM_STATUS.SHUTDOWN; // [cite: 2306]
      this.state.startTime = null;
      this.recordMetric('eventbus.shutdown.success', 1, { timestamp: Date.now() }); // [cite: 2307]
      this.deps.logger?.info('[CoreEventBus] Shutdown complete.'); // [cite: 2308]

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; // [cite: 2309]
      this.recordMetric('eventbus.shutdown.failure', 1, { error: error.code, timestamp: Date.now() }); // [cite: 2310]
      console.error('[CoreEventBus] Shutdown failed:', error); // [cite: 2311]
    }
  }

  // --- Health Checks & Metrics ---
  setupDefaultHealthChecks() { // [cite: 2312]
    this.registerHealthCheck('eventbus.state', this.checkSystemState.bind(this)); // [cite: 2312]
    this.registerHealthCheck('eventbus.queues', this.checkQueueStatus.bind(this)); // [cite: 2312]
    this.registerHealthCheck('eventbus.subscriptions', this.checkSubscriptionStatus.bind(this)); // [cite: 2313]
  }

  recordMetric(name, value, tags = {}) { // [cite: 2313]
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags }); // [cite: 2314]
  }

  getMetrics() {
    const metrics = {}; // [cite: 2315]
    for (const [name, data] of this.state.metrics) { // [cite: 2315]
      metrics[name] = data; // [cite: 2316]
    }
    return metrics;
  }

  registerHealthCheck(name, checkFn) { // [cite: 2317]
    if (typeof checkFn !== 'function') {
      const err = new EventError(ErrorCodes.EVENT.INVALID_HANDLER, `Health check '${name}' must be a function.`); // Uses unprefixed // [cite: 2317]
      this._handleInternalError(err); // Log, but rethrow as it's a programming error // [cite: 2317]
      throw err; // [cite: 2318]
    }
    this.state.healthChecks.set(name, checkFn); // [cite: 2318]
  }

  async checkHealth() { // [cite: 2318]
    const results = {}; // [cite: 2319]
    let overallStatus = SYSTEM_STATUS.HEALTHY; // [cite: 2320]

    for (const [name, checkFn] of this.state.healthChecks) { // [cite: 2320]
      try {
        const checkResult = await checkFn(); // [cite: 2321]
        results[name] = checkResult; // [cite: 2322]
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) { // [cite: 2322]
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY) ?
          SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY; // [cite: 2323]
          if (checkResult.status === SYSTEM_STATUS.UNHEALTHY) overallStatus = SYSTEM_STATUS.UNHEALTHY; // [cite: 2324]
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]); // [cite: 2325]
        overallStatus = SYSTEM_STATUS.UNHEALTHY; // [cite: 2325]
      }
    }
    return { // [cite: 2326]
      name: this.constructor.name, // [cite: 2326]
      version: CoreEventBus.version, // [cite: 2326]
      status: overallStatus, // [cite: 2326]
      timestamp: new Date().toISOString(), // [cite: 2326]
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, // [cite: 2327]
      errorCount: this.state.errors.length,
      checks: results, // [cite: 2327]
    };
  }

  async checkSystemState() { // [cite: 2328]
    return createStandardHealthCheckResult(
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY,
      { // [cite: 2328]
        status: this.state.status, // [cite: 2329]
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, // [cite: 2329]
        internalErrorCount: this.state.errors.length // [cite: 2329]
      }
    );
  }

  async checkQueueStatus() { // [cite: 2329]
    const queueCounts = {}; // [cite: 2330]
    let totalQueuedEvents = 0; // [cite: 2330]
    this.queues.forEach((queue, key) => { // [cite: 2331]
      queueCounts[key] = queue.length; // [cite: 2331]
      totalQueuedEvents += queue.length; // [cite: 2331]
    });
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, { // [cite: 2332]
      queueCount: this.queues.size, // [cite: 2332]
      totalQueuedEvents, // [cite: 2332]
      queues: queueCounts, // [cite: 2332]
    });
  }

  async checkSubscriptionStatus() { // [cite: 2333]
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, { // [cite: 2333]
      count: this.subscriptions.size, // [cite: 2333]
      patterns: Array.from(this.subscriptions.values()).map(s => s.pattern), // [cite: 2333]
    });
  }

   getSystemStatus() { // For consistency
    return {
        name: this.constructor.name,
        version: CoreEventBus.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, // [cite: 2335]
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString() // [cite: 2336]
    };
  }
}

/**
 * Factory function for creating a CoreEventBus instance.
 * @param {object} [deps={}] - Dependencies for the CoreEventBus.
 * @returns {CoreEventBus}
 */
export function createEventBus(deps = {}) { // [cite: 2337]
  return new CoreEventBus(deps); // [cite: 2338]
}