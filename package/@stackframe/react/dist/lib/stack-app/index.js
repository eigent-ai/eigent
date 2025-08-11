"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/stack-app/index.ts
var stack_app_exports = {};
__export(stack_app_exports, {
  StackAdminApp: () => import_apps.StackAdminApp,
  StackClientApp: () => import_apps.StackClientApp,
  StackServerApp: () => import_apps.StackServerApp,
  stackAppInternalsSymbol: () => import_common.stackAppInternalsSymbol
});
module.exports = __toCommonJS(stack_app_exports);
var import_apps = require("./apps");
var import_common = require("./common");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StackAdminApp,
  StackClientApp,
  StackServerApp,
  stackAppInternalsSymbol
});
//# sourceMappingURL=index.js.map