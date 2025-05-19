/**
 * @file CoreEventBus.js
 * @description Centralized event bus for robust event management, queuing, and history.
 */

import { EventEmitter } from 'events'; // Node.js built-in
import { EventError } from '../errors/index.js'; // Assuming errors/index.js exports EventError
import { ErrorCodes } from '../errors/ErrorCodes.js'; // Assuming ErrorCodes are in their own file
import { SYSTEM_STATUS, LIFECYCLE_EVENTS, DEFAULT_CONFIG } from '../common/SystemConstants.js';
import { safeHandleError, createStandardHealthCheckResult } from '../common/ErrorUtils.js';

// Assuming crypto.randomUUID is available (Node.js 15.6.0+, or use a polyfill/library for broader compatibility)
// For older Node or browsers, you might need a library like 'uuid'.
// const { v4: uuidv4 } = require('uuid'); // Example if using uuid library

export class CoreEventBus extends EventEmitter {
  static dependencies = ['errorSystem', 'config']; // [cite: 401]
  static version = '2.0.0'; // Example version bump

  /**
   * Creates a new CoreEventBus instance.
   * @param {object} [deps={}] - Dependencies for the CoreEventBus.
   * @param {object} [deps.errorSystem] - The ErrorSystem instance.
   * @param {object} [deps.config={}] - Configuration object.
   */
  constructor(deps = {}) { // [cite: 402]
    super();
    this.deps = {
      errorSystem: deps.errorSystem,
      config: deps.config || {},
    };

    this.queues = new Map(); // [cite: 402]
    this.subscriptions = new Map(); // [cite: 402]
    this.history = new Map(); // [cite: 403]
    this.maxHistorySize = this.deps.config?.eventBus?.maxHistorySize || // Adjusted config path
                          this.deps.config?.eventHistory?.maxSize || // Kept original for compatibility
                          DEFAULT_CONFIG.MAX_ERROR_HISTORY; // Default if none specified
    // this.initialized is now driven by this.state.status

    this.state = {
      status: SYSTEM_STATUS.CREATED,
      startTime: null,
      errors: [], // For internal errors of CoreEventBus
      metrics: new Map(),
      healthChecks: new Map(),
    }; // [cite: 404]

    this._originalEmit = null; // For wildcard forwarding
    this._processingNewListener = false; // Guard for newListener recursion

    this.setupDefaultHealthChecks(); // [cite: 405]
    this._setupInternalListeners(); // Setup newListener/removeListener logic
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
        if (eventNameStr === '*') { // [cite: 428, 429]
          this._enableWildcardForwarding(); // [cite: 429]
        }
      } finally {
        this._processingNewListener = false;
      }
    });

    this.on('removeListener', (eventName) => {
      const eventNameStr = typeof eventName === 'string' ? eventName : String(eventName);
      if (eventNameStr === '*' && this.listenerCount('*') === 0) { // [cite: 430]
        this._disableWildcardForwarding(); // [cite: 430]
      }
    });
  }

  /**
   * Handles internal operational errors of the CoreEventBus.
   * @private
   */
  async _handleInternalError(error, context = {}) {
    const errorToLog = !(error instanceof EventError)
      ? new EventError(ErrorCodes.EVENT.INTERNAL_ERROR || 'INTERNAL_ERROR', error.message, context, { cause: error })
      : error;

    this.state.errors.push({ error: errorToLog, timestamp: new Date().toISOString(), context });
    if (this.state.errors.length > (this.deps.config?.eventBus?.maxErrorHistory || DEFAULT_CONFIG.MAX_ERROR_HISTORY)) {
      this.state.errors.shift();
    }
    this.recordMetric('eventbus.errors.internal', 1, { errorName: errorToLog.name, errorCode: errorToLog.code });
    await safeHandleError(this.deps.errorSystem, errorToLog, { source: 'CoreEventBus', ...context });
  }

  /**
   * Initializes the CoreEventBus.
   * @returns {Promise<CoreEventBus>}
   */
  async initialize() {
    if (this.state.status === SYSTEM_STATUS.RUNNING || this.state.status === SYSTEM_STATUS.INITIALIZING) {
      const err = new EventError(ErrorCodes.EVENT.ALREADY_INITIALIZED, 'CoreEventBus is already initialized or initializing.'); // [cite: 425]
      await this._handleInternalError(err, { currentStatus: this.state.status });
      return this;
    }

    this.emit(LIFECYCLE_EVENTS.INITIALIZING, { system: 'CoreEventBus' });
    this.state.status = SYSTEM_STATUS.INITIALIZING; // [cite: 426]
    this.state.startTime = Date.now(); // [cite: 427]

    try {
      // Wildcard forwarding setup is now handled by newListener/removeListener
      this.state.status = SYSTEM_STATUS.RUNNING; // [cite: 431]
      this.recordMetric('eventbus.initialized.success', 1, { timestamp: Date.now() });
      // Emit system:initialized AFTER this.emit is potentially wrapped by wildcard forwarding
      // to ensure system:initialized can also be caught by a wildcard if needed.
      // However, system events are often special. The current emit logic forwards non-"*" events.
      // Let's emit system events directly using super.emit if this.emit is wrapped,
      // or ensure system events are not doubly processed by wildcard if not desired.
      // For now, standard emit:
      this.emit(LIFECYCLE_EVENTS.INITIALIZED, { system: 'CoreEventBus', timestamp: new Date().toISOString() }); // [cite: 431]
      this.emit(LIFECYCLE_EVENTS.RUNNING, { system: 'CoreEventBus', timestamp: new Date().toISOString() });


    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; // [cite: 432]
      this.recordMetric('eventbus.initialized.failure', 1, { error: error.code, timestamp: Date.now() }); // [cite: 434]
      // The original code had `await this.handleError(error)` here, which is for external errors.
      // For init errors, use _handleInternalError.
      await this._handleInternalError(error, { phase: 'initialization' }); // [cite: 434]
      throw error instanceof EventError ? error : new EventError( // [cite: 434]
        ErrorCodes.EVENT.INITIALIZATION_FAILED, // [cite: 434]
        'CoreEventBus failed to initialize.', // [cite: 434]
        { originalMessage: error.message }, // [cite: 434]
        { cause: error } // [cite: 434]
      );
    }
    return this;
  }

  /**
   * Enables wildcard event forwarding by wrapping the emit method.
   * @private
   */
  _enableWildcardForwarding() {
    if (this._originalEmit) return; // Already enabled [cite: 417]
    this._originalEmit = super.emit; // Store the original EventEmitter.emit [cite: 418]

    // Replace the emit method of this instance
    // Note: We are replacing `this.emit` which is inherited from EventEmitter's prototype.
    // This instance's `emit` will now be this new function.
    // Calls to `super.emit()` inside this new function will call the original EventEmitter.emit.
    const newEmit = (eventName, ...args) => {
      // Call original emit for the specific event
      // The first argument to `_originalEmit` should be `this` (the CoreEventBus instance)
      const result = this._originalEmit.call(this, eventName, ...args); // [cite: 419]

      // Forward to wildcard handlers ('*') if the eventName itself is not '*'
      // CRITICAL FIX: Pass the actual arguments received by this emit, not re-parsing.
      // If args[0] is the wrapped event object, that's what we forward.
      if (eventName !== '*' && this.listenerCount('*') > 0) { // [cite: 420]
          // Wildcard listeners expect the event object as their first argument.
          // And the event name as the "emitted" event for the wildcard listener.
          // So, emit the event `*` with arguments `(originalEventName, actualEventPayloadObject)`
          // OR, emit `*` with argument `(actualEventPayloadObject)` which also has `actualEventPayloadObject.name`.
          // Let's align with the latter for simplicity for the wildcard handler.
          // The actualEventPayloadObject is typically args[0] for our wrapped events.
        if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && args[0].id && args[0].name) {
            this._originalEmit.call(this, '*', args[0]); // Forward the full event object [cite: 420]
        } else {
            // This case implies a non-standard event emission not using our wrapped event object.
            // Or it's a system event not following the pattern.
            // For now, maintain previous behavior if event object isn't found.
            this._originalEmit.call(this, '*', eventName, ...args);
        }
      }
      return result;
    };
    this.emit = newEmit;

    this.recordMetric('eventbus.wildcard.enabled', 1); // [cite: 422]
  }

  /**
   * Disables wildcard event forwarding by restoring the original emit method.
   * @private
   */
  _disableWildcardForwarding() {
    if (!this._originalEmit) return; // [cite: 422]
    this.emit = this._originalEmit; // Restore original EventEmitter.emit [cite: 423]
    this._originalEmit = null; // [cite: 423]
    this.recordMetric('eventbus.wildcard.disabled', 1); // [cite: 424]
  }

  /**
   * Emits an event with queuing, history, and pattern matching.
   * @param {string} eventName - Event name.
   * @param {*} data - Event data.
   * @param {object} [options={}] - Emission options (e.g., queue, metadata).
   * @returns {Promise<boolean>} Whether the event had listeners (or was queued).
   */
  async emit(eventName, data, options = {}) { // This is the public emit, potentially wrapped
    if (typeof eventName !== 'string' || !eventName.trim()) { // [cite: 439]
      const err = new EventError(
        ErrorCodes.EVENT.INVALID_EVENT_NAME, // [cite: 440]
        'Event name must be a non-empty string.', // [cite: 440]
        { providedEventName: eventName } // [cite: 440]
      );
      await this._handleInternalError(err, { eventName, data, options });
      throw err;
    }

    const eventId = global.crypto && typeof global.crypto.randomUUID === 'function'
                    ? global.crypto.randomUUID() // For Node.js
                    : Math.random().toString(36).substring(2) + Date.now().toString(36); // Basic fallback

    const event = { // [cite: 441]
      id: eventId, // [cite: 441]
      name: eventName, // [cite: 441]
      data, // [cite: 441]
      timestamp: new Date().toISOString(), // [cite: 441]
      metadata: options.metadata || {}, // [cite: 441]
    };

    try {
      this.trackEvent(event); // [cite: 442]
      this.recordMetric('eventbus.events.emitted', 1, { eventName, queued: !!options.queue }); // [cite: 443]

      if (options.queue) { // [cite: 444]
        await this.queueEvent(event, options); // [cite: 444] Changed to await
        return true; // Event was queued
      }

      // Use super.emit (or this._originalEmit if wrapped) to call the actual EventEmitter emit
      const emitFn = this._originalEmit || super.emit;
      return emitFn.call(this, eventName, event); // Pass the wrapped event object [cite: 445]

    } catch (error) {
      // This catch is for errors during the emit process itself (e.g. history, queueing)
      // not for errors thrown by listeners (those are handled by EventEmitter).
      await this._handleInternalError(error, { eventName, eventId: event.id, options }); // [cite: 446]
      throw error instanceof EventError ? error : new EventError( // [cite: 447]
        ErrorCodes.EVENT.EMISSION_FAILED, // [cite: 447]
        `Failed to emit event: ${eventName}`, // [cite: 447]
        { eventName, eventId: event.id, options }, // [cite: 447]
        { cause: error } // [cite: 447]
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
  subscribe(pattern, handler, options = {}) { // [cite: 448]
    if (typeof pattern !== 'string' || !pattern.trim()) { // [cite: 448]
      const err = new EventError(ErrorCodes.EVENT.INVALID_PATTERN, 'Event pattern must be a non-empty string.', { pattern }); // [cite: 449]
      this._handleInternalError(err); // Log, then throw
      throw err;
    }
    if (typeof handler !== 'function') { // [cite: 450]
      const err = new EventError(ErrorCodes.EVENT.INVALID_HANDLER, 'Event handler must be a function.', { pattern }); // [cite: 450]
      this._handleInternalError(err);
      throw err;
    }

    const subscriptionId = global.crypto && typeof global.crypto.randomUUID === 'function'
                        ? global.crypto.randomUUID()
                        : Math.random().toString(36).substring(2) + Date.now().toString(36);

    const subscription = { // [cite: 451]
      id: subscriptionId, // [cite: 451]
      pattern, // [cite: 451]
      handler, // [cite: 451]
      options: options || {}, // [cite: 451]
      created: new Date().toISOString(), // [cite: 451]
      // internalHandler will store the actual function passed to EventEmitter.on
    }; //

    try {
      if (pattern === '*') { // [cite: 453]
        // Wildcard handler receives the full event object as its first argument
        subscription.internalHandler = (event) => handler(event); // [cite: 453]
        super.on('*', subscription.internalHandler); // [cite: 454]
      } else if (pattern.includes('*')) {
        const regexPattern = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'); // More robust regex
        // Pattern handlers also receive the full event object
        subscription.internalHandler = (event) => { // [cite: 455]
          // The event argument here comes from the wildcard emit: emit('*', fullEventObject)
          if (event && typeof event.name === 'string' && regexPattern.test(event.name)) { // [cite: 455]
            handler(event); // [cite: 456]
          }
        };
        super.on('*', subscription.internalHandler); // Listen on wildcard, filter by name [cite: 456]
      } else {
        // Direct match, handler receives the full event object
        subscription.internalHandler = (event) => handler(event);
        super.on(pattern, subscription.internalHandler); // [cite: 452]
      }

      this.subscriptions.set(subscription.id, subscription); //
      this.recordMetric('eventbus.subscriptions.added', 1, { pattern }); // [cite: 457]
      return subscription.id; // [cite: 458]
    } catch (error) {
      // Use _handleInternalError for subscription setup issues
      await this._handleInternalError(error, { phase: 'subscribe', pattern }); // [cite: 458]
      throw error instanceof EventError ? error : new EventError( // [cite: 459]
        ErrorCodes.EVENT.SUBSCRIPTION_FAILED, // [cite: 459]
        `Failed to subscribe to pattern: ${pattern}`, // [cite: 459]
        { pattern }, // [cite: 459]
        { cause: error } // [cite: 459]
      );
    }
  }

  /**
   * Unsubscribes from events.
   * @param {string} subscriptionId - The ID returned by subscribe.
   * @returns {boolean} True if unsubscribed, false otherwise.
   */
  unsubscribe(subscriptionId) { // [cite: 460]
    const subscription = this.subscriptions.get(subscriptionId); // [cite: 460]
    if (!subscription) { // [cite: 461]
      // Don't throw if not found, just return false or log a warning
      this.deps.logger?.warn(`[CoreEventBus] Unsubscribe failed: Subscription ID '${subscriptionId}' not found.`);
      return false;
    }

    try {
      const { pattern, internalHandler } = subscription; // [cite: 462]
      if (pattern.includes('*')) { // [cite: 464, 465, 468]
        super.removeListener('*', internalHandler); // [cite: 465, 466, 468]
      } else {
        super.removeListener(pattern, internalHandler); // [cite: 463, 467]
      }

      this.subscriptions.delete(subscriptionId); // [cite: 469]
      this.recordMetric('eventbus.subscriptions.removed', 1, { pattern: subscription.pattern }); // [cite: 470]
      return true; // [cite: 471]
    } catch (error) {
      await this._handleInternalError(error, { phase: 'unsubscribe', subscriptionId }); // [cite: 471]
      // We might not want to re-throw an EventError here if the primary goal (removing from map) succeeded.
      // However, if removeListener failed, it's an internal issue.
      // For now, let's not escalate to EventError unless the error is from EventEmitter itself.
      if (!(error instanceof EventError)) {
          this.deps.logger?.error(`[CoreEventBus] Error during removeListener for ${subscriptionId}: ${error.message}`);
      }
      return false; // Indicate potential issue
    }
  }

  /**
   * Adds an event to a named queue for later processing.
   * @param {object} event - The full event object.
   * @param {object} [options={}] - Queuing options (e.g., immediate).
   * @returns {Promise<boolean>} True if queued successfully.
   */
  async queueEvent(event, options = {}) { // [cite: 473]
    try {
      const queueName = event.name;
      const queue = this.queues.get(queueName) || []; // [cite: 474]
      const queueItem = { event, options, timestamp: new Date().toISOString() }; // [cite: 474]
      queue.push(queueItem); // [cite: 475]
      this.queues.set(queueName, queue); // [cite: 475]

      this.recordMetric('eventbus.events.queued', 1, { eventName: queueName, queueSize: queue.length }); // [cite: 475]

      if (options.immediate) { // [cite: 476]
        await this.processQueue(queueName); // [cite: 476]
      }
      return true; //
    } catch (error) {
      await this._handleInternalError(error, { phase: 'queueEvent', eventName: event.name }); // [cite: 477]
      throw error instanceof EventError ? error : new EventError( // [cite: 478]
        ErrorCodes.EVENT.QUEUE_OPERATION_FAILED || 'QUEUE_OPERATION_FAILED', // Assuming new code [cite: 478]
        `Failed to queue event: ${event.name}`, // [cite: 478]
        { eventName: event.name }, // [cite: 478]
        { cause: error } // [cite: 478]
      );
    }
  }

  /**
   * Processes all events in a named queue.
   * @param {string} queueName - The name of the queue to process.
   * @returns {Promise<number>} The number of events processed.
   */
  async processQueue(queueName) { // [cite: 479]
    const queue = this.queues.get(queueName) || []; // [cite: 480]
    if (queue.length === 0) return 0;

    let processedCount = 0;
    const startTime = Date.now();
    const BATCH_SIZE = this.deps.config?.eventBus?.queueBatchSize || 100; // Process in batches

    // Process only up to BATCH_SIZE to prevent blocking for too long if queue is huge
    const itemsToProcess = queue.splice(0, Math.min(queue.length, BATCH_SIZE));

    for (const { event } of itemsToProcess) { // [cite: 481]
      try {
        // Use super.emit or _originalEmit to bypass this instance's emit logic (like queuing again)
        const emitFn = this._originalEmit || super.emit;
        emitFn.call(this, event.name, event); // Emit the full event object [cite: 481]
        processedCount++; // [cite: 481]
      } catch (handlerError) {
        // Error thrown by a listener during the emit. This is an application error, not an EventBus error.
        // We should report it via the main ErrorSystem.
        const appError = new EventError(
          ErrorCodes.EVENT.HANDLER_ERROR, // [cite: 482]
          `Error in handler for event: ${event.name} (ID: ${event.id}) during queue processing.`, // [cite: 482]
          { eventName: event.name, eventId: event.id }, // [cite: 482]
          { cause: handlerError } // [cite: 482]
        );
        // Use the public handleError which forwards to ErrorSystem
        await this.handleError(appError, { phase: 'processQueue-handler', queueName, eventId: event.id });
        // Continue processing other events in the batch
      }
    }

    this.recordMetric('eventbus.queue.processed', processedCount, { queueName, processingTimeMs: Date.now() - startTime }); // [cite: 484]
    if (queue.length > 0) {
        this.recordMetric('eventbus.queue.remaining', queue.length, { queueName });
    }
    return processedCount; // [cite: 485]
  }

  /**
   * Public error handler to be used by event listeners if they want to report errors
   * through the EventBus's configured ErrorSystem.
   * @param {Error} error - The error object from the event listener.
   * @param {object} [context={}] - Context from the event listener.
   */
  async handleError(error, context = {}) { // [cite: 435]
    // This is the public method for listeners to report their errors.
    // It should use safeHandleError to forward to the configured ErrorSystem.
    this.recordMetric('eventbus.errors.reported_by_listener', 1, { errorName: error.name, errorCode: error.code });
    await safeHandleError(this.deps.errorSystem, error, { source: 'CoreEventBusListener', ...context }); // [cite: 438]
  }


  /**
   * Processes all events in all queues.
   * @returns {Promise<Object.<string, number>>} An object mapping queue names to processed counts.
   */
  async processAllQueues() { // [cite: 487]
    const results = {}; // [cite: 488]
    const queueNames = Array.from(this.queues.keys()); // [cite: 488]
    let totalProcessed = 0;

    for (const queueName of queueNames) { // [cite: 489]
      try {
        results[queueName] = await this.processQueue(queueName); // [cite: 489]
        totalProcessed += results[queueName];
      } catch (error) {
        // _handleInternalError for errors in the processQueue logic itself
        await this._handleInternalError(error, { phase: 'processAllQueues', queueName }); // [cite: 490]
        // Don't rethrow here to allow other queues to be processed. Error is logged.
        results[queueName] = 0; // Mark as 0 processed for this queue due to error
      }
    }
    this.recordMetric('eventbus.all_queues.processed_total', totalProcessed);
    return results; //
  }

  trackEvent(event) { // [cite: 491]
    const eventHistoryQueue = this.history.get(event.name) || []; // [cite: 492]
    eventHistoryQueue.unshift(event); // [cite: 492]
    if (eventHistoryQueue.length > this.maxHistorySize) { // [cite: 492]
      eventHistoryQueue.pop(); // [cite: 493]
    }
    this.history.set(event.name, eventHistoryQueue); // [cite: 493]
    this.recordMetric('eventbus.history.size', eventHistoryQueue.length, { eventName: event.name }); // [cite: 494]
  }

  getHistory(eventName, options = {}) { // [cite: 494]
    const historyQueue = this.history.get(eventName) || []; // [cite: 495]
    if (options.limit && options.limit > 0) { // [cite: 495]
      return historyQueue.slice(0, options.limit); // [cite: 496]
    }
    return [...historyQueue]; // Return a copy [cite: 496]
  }

  getAllHistory(options = {}) { // [cite: 497]
    const result = {}; // [cite: 497]
    for (const [eventName, historyQueue] of this.history) { // [cite: 497]
      result[eventName] = options.limit ? historyQueue.slice(0, options.limit) : [...historyQueue]; // [cite: 498]
    }
    return result; // [cite: 499]
  }

  async reset() { // [cite: 499]
    this.queues.clear(); // [cite: 500]
    this.history.clear(); // [cite: 500]
    // Remove only non-system listeners. Our internal 'newListener'/'removeListener' should stay.
    const eventNames = super.eventNames().filter( // [cite: 500]
      (name) => name !== 'newListener' && name !== 'removeListener' && !name.startsWith('system:')
    );
    for (const eventName of eventNames) { // [cite: 501]
      super.removeAllListeners(eventName); // [cite: 501]
    }
    this.subscriptions.clear(); // Clear our tracking of subscriptions
    this.recordMetric('eventbus.reset', 1); // [cite: 502]
    // Wildcard forwarding might need to be explicitly disabled if this.emit was wrapped
    if (this._originalEmit) {
        this._disableWildcardForwarding();
    }
  }

  async shutdown() { // [cite: 503]
    if (this.state.status === SYSTEM_STATUS.SHUTDOWN || this.state.status === SYSTEM_STATUS.SHUTTING_DOWN) { // [cite: 503]
      return;
    }
    this.emit(LIFECYCLE_EVENTS.SHUTTING_DOWN, { system: 'CoreEventBus' });
    this.state.status = SYSTEM_STATUS.SHUTTING_DOWN; // [cite: 504]

    try {
      await this.reset(); // [cite: 504]
      super.removeAllListeners(); // Remove ALL listeners, including internal ones [cite: 506]

      this.state.status = SYSTEM_STATUS.SHUTDOWN; // [cite: 504]
      this.state.startTime = null;
      this.recordMetric('eventbus.shutdown.success', 1, { timestamp: Date.now() }); // [cite: 507]
      // Cannot emit shutdown if all listeners are removed. Log instead.
      this.deps.logger?.info('[CoreEventBus] Shutdown complete.');

    } catch (error) {
      this.state.status = SYSTEM_STATUS.ERROR; // [cite: 508]
      this.recordMetric('eventbus.shutdown.failure', 1, { error: error.code, timestamp: Date.now() }); // [cite: 509]
      // Use console.error as this is a critical failure during event bus shutdown
      console.error('[CoreEventBus] Shutdown failed:', error); // [cite: 509]
      // Do not re-throw from EventBus shutdown itself unless absolutely necessary
    }
  }

  // --- Health Checks & Metrics ---
  setupDefaultHealthChecks() { // [cite: 405]
    this.registerHealthCheck('eventbus.state', this.checkSystemState.bind(this)); // [cite: 406]
    this.registerHealthCheck('eventbus.queues', this.checkQueueStatus.bind(this)); // [cite: 407]
    this.registerHealthCheck('eventbus.subscriptions', this.checkSubscriptionStatus.bind(this)); // [cite: 409]
  }

  recordMetric(name, value, tags = {}) { // [cite: 416]
    this.state.metrics.set(name, { value, timestamp: Date.now(), tags }); // [cite: 417]
  }

  getMetrics() {
    const metrics = {};
    for (const [name, data] of this.state.metrics) {
      metrics[name] = data;
    }
    return metrics;
  }

  registerHealthCheck(name, checkFn) { // [cite: 410]
    if (typeof checkFn !== 'function') {
      const err = new EventError(ErrorCodes.EVENT.INVALID_HANDLER, `Health check '${name}' must be a function.`); // [cite: 411]
      this._handleInternalError(err); // Log, but rethrow as it's a programming error
      throw err;
    }
    this.state.healthChecks.set(name, checkFn); // [cite: 411]
  }

  async checkHealth() { // [cite: 411]
    const results = {}; // [cite: 412]
    let overallStatus = SYSTEM_STATUS.HEALTHY; // [cite: 412]

    for (const [name, checkFn] of this.state.healthChecks) { // [cite: 412]
      try {
        const checkResult = await checkFn(); // Expects { status, detail, errors } [cite: 412]
        results[name] = checkResult; // [cite: 412]
        if (checkResult.status !== SYSTEM_STATUS.HEALTHY) { // [cite: 413]
          overallStatus = (overallStatus === SYSTEM_STATUS.HEALTHY) ? SYSTEM_STATUS.DEGRADED : SYSTEM_STATUS.UNHEALTHY; // [cite: 413]
          if (checkResult.status === SYSTEM_STATUS.UNHEALTHY) overallStatus = SYSTEM_STATUS.UNHEALTHY; // [cite: 414]
        }
      } catch (error) {
        results[name] = createStandardHealthCheckResult(SYSTEM_STATUS.UNHEALTHY, { error: 'Health check threw an exception' }, [error]); // [cite: 414]
        overallStatus = SYSTEM_STATUS.UNHEALTHY; // [cite: 415]
      }
    }
    return { // [cite: 415]
      name: this.constructor.name, // [cite: 415]
      version: CoreEventBus.version, // [cite: 415]
      status: overallStatus, // [cite: 415]
      timestamp: new Date().toISOString(), // [cite: 415]
      uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
      errorCount: this.state.errors.length,
      checks: results, // [cite: 415]
    };
  }

  async checkSystemState() { // [cite: 406]
    return createStandardHealthCheckResult(
      this.state.status === SYSTEM_STATUS.RUNNING ? SYSTEM_STATUS.HEALTHY : SYSTEM_STATUS.UNHEALTHY,
      { // [cite: 406]
        status: this.state.status, // [cite: 407]
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0, // [cite: 407]
        internalErrorCount: this.state.errors.length // [cite: 407]
      }
    );
  }

  async checkQueueStatus() { // [cite: 407]
    const queueCounts = {}; // [cite: 407]
    let totalQueuedEvents = 0; // [cite: 407]
    this.queues.forEach((queue, key) => { // [cite: 408]
      queueCounts[key] = queue.length; // [cite: 408]
      totalQueuedEvents += queue.length; // [cite: 408]
    });
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, { // [cite: 408]
      queueCount: this.queues.size, // [cite: 408]
      totalQueuedEvents, // [cite: 408]
      queues: queueCounts, // [cite: 408]
    });
  }

  async checkSubscriptionStatus() { // [cite: 409]
    return createStandardHealthCheckResult(SYSTEM_STATUS.HEALTHY, { // [cite: 409]
      count: this.subscriptions.size, // [cite: 409]
      patterns: Array.from(this.subscriptions.values()).map(s => s.pattern), // [cite: 409]
    });
  }

   getSystemStatus() { // For consistency
    return {
        name: this.constructor.name,
        version: CoreEventBus.version,
        status: this.state.status,
        uptime: this.state.startTime ? Date.now() - this.state.startTime : 0,
        initialized: this.state.status === SYSTEM_STATUS.RUNNING,
        errorCount: this.state.errors.length,
        timestamp: new Date().toISOString()
    };
  }
}

/**
 * Factory function for creating a CoreEventBus instance.
 * @param {object} [deps={}] - Dependencies for the CoreEventBus.
 * @returns {CoreEventBus}
 */
export function createEventBus(deps = {}) { // [cite: 510]
  return new CoreEventBus(deps); // [cite: 511]
}