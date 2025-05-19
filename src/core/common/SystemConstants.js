/**
 * @file SystemConstants.js
 * @description Defines shared constants for system status and lifecycle.
 */

export const SYSTEM_STATUS = Object.freeze({
  CREATED: 'created',
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  SHUTTING_DOWN: 'shutting_down',
  SHUTDOWN: 'shutdown',
  ERROR: 'error',
  DEGRADED: 'degraded', // For health checks
  HEALTHY: 'healthy',   // For health checks
  UNHEALTHY: 'unhealthy' // For health checks
});

export const LIFECYCLE_EVENTS = Object.freeze({
  INITIALIZING: 'system:initializing',
  INITIALIZED: 'system:initialized', // Or 'system:running'
  RUNNING: 'system:running',
  SHUTTING_DOWN: 'system:shutting_down',
  SHUTDOWN: 'system:shutdown',
  ERROR: 'system:error'
});

// Default configuration for common system aspects
export const DEFAULT_CONFIG = Object.freeze({
  MAX_ERROR_HISTORY: 100,
  DEFAULT_HEALTH_CHECK_INTERVAL: 30000, // ms
  DEFAULT_METRIC_FLUSH_INTERVAL: 60000 // ms (if applicable)
});