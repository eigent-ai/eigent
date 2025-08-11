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

// src/lib/hooks.tsx
var hooks_exports = {};
__export(hooks_exports, {
  useStackApp: () => useStackApp,
  useUser: () => useUser
});
module.exports = __toCommonJS(hooks_exports);
var import_react = require("react");
var import_stack_provider_client = require("../providers/stack-provider-client");
function useUser(options = {}) {
  const stackApp = useStackApp(options);
  if (options.projectIdMustMatch && stackApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useStackApp: " + stackApp.projectId);
  }
  if (options.projectIdMustMatch === "internal") {
    return stackApp.useUser(options);
  } else {
    return stackApp.useUser(options);
  }
}
function useStackApp(options = {}) {
  const context = (0, import_react.useContext)(import_stack_provider_client.StackContext);
  if (context === null) {
    throw new Error("useStackApp must be used within a StackProvider");
  }
  const stackApp = context.app;
  if (options.projectIdMustMatch && stackApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useStackApp: " + stackApp.projectId);
  }
  return stackApp;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useStackApp,
  useUser
});
//# sourceMappingURL=hooks.js.map