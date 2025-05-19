/**
 * @file src/core/container/index.js
 * @description Barrel file for exporting the ContainerSystem and its factory.
 */

import { ContainerSystem, createContainerSystem } from './ContainerSystem.js';

export {
  ContainerSystem,
  createContainerSystem,
};

// Optional default export if preferred for commonJS-style imports or specific bundling strategies
// export default {
//   ContainerSystem,
//   createContainerSystem,
// };