"use client";
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/providers/stack-provider-client.tsx
var stack_provider_client_exports = {};
__export(stack_provider_client_exports, {
  StackContext: () => StackContext,
  StackProviderClient: () => StackProviderClient,
  UserSetter: () => UserSetter
});
module.exports = __toCommonJS(stack_provider_client_exports);
var import_globals = require("@stackframe/stack-shared/dist/utils/globals");
var import_react = __toESM(require("react"));
var import__ = require("..");
var import_stack_app = require("../lib/stack-app");
var import_jsx_runtime = require("react/jsx-runtime");
var StackContext = import_react.default.createContext(null);
function StackProviderClient(props) {
  const app = props.serialized ? import_stack_app.StackClientApp[import_stack_app.stackAppInternalsSymbol].fromClientJson(props.app) : props.app;
  import_globals.globalVar.__STACK_AUTH__ = { app };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StackContext.Provider, { value: { app }, children: props.children });
}
function UserSetter(props) {
  const app = (0, import__.useStackApp)();
  (0, import_react.useEffect)(() => {
    const promise = (async () => await props.userJsonPromise)();
    app[import_stack_app.stackAppInternalsSymbol].setCurrentUser(promise);
  }, []);
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StackContext,
  StackProviderClient,
  UserSetter
});
//# sourceMappingURL=stack-provider-client.js.map