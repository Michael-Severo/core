/**
 * @file src/core/event/index.js
 * @description Barrel file for exporting event system components.
 */

import { CoreEventBus, createEventBus } from './CoreEventBus.js';
import { EventBusSystem, createEventBusSystem } from './EventBusSystem.js';

export {
  CoreEventBus,
  createEventBus,
  EventBusSystem,
  createEventBusSystem,
};

// Optional default export:
// export default {
//   CoreEventBus,
//   createEventBus,
//   EventBusSystem,
//   createEventBusSystem,
// };