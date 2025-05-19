/**
 * @file src/core/common/index.js
 * @description Barrel file for exporting common shared utilities and constants.
 */

export {
  SYSTEM_STATUS,
  LIFECYCLE_EVENTS,
  DEFAULT_CONFIG
} from './SystemConstants.js';

export {
  safeHandleError,
  createStandardHealthCheckResult
} from './ErrorUtils.js';