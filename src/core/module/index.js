/**
 * @file src/core/module/index.js
 * @description Barrel file for exporting module system components.
 */

import { CoreModule, createModule } from './CoreModule.js';
import { ModuleSystem, createModuleSystem } from './ModuleSystem.js';

export {
  CoreModule,
  createModule,
  ModuleSystem,
  createModuleSystem,
};

// Optional default export:
// export default {
//   CoreModule,
//   createModule,
//   ModuleSystem,
//   createModuleSystem,
// };