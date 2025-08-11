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

// src/lib/stack-app/apps/implementations/index.ts
var implementations_exports = {};
__export(implementations_exports, {
  _StackAdminAppImpl: () => _StackAdminAppImpl,
  _StackClientAppImpl: () => _StackClientAppImpl,
  _StackServerAppImpl: () => _StackServerAppImpl
});
module.exports = __toCommonJS(implementations_exports);
var import_compile_time = require("@stackframe/stack-shared/dist/utils/compile-time");
var import_admin_app_impl = require("./admin-app-impl");
var import_client_app_impl = require("./client-app-impl");
var import_server_app_impl = require("./server-app-impl");
function complete() {
  import_client_app_impl._StackClientAppImplIncomplete.LazyStackAdminAppImpl.value = import_admin_app_impl._StackAdminAppImplIncomplete;
  return {
    _StackAdminAppImpl: (0, import_compile_time.scrambleDuringCompileTime)(import_admin_app_impl._StackAdminAppImplIncomplete),
    _StackClientAppImpl: (0, import_compile_time.scrambleDuringCompileTime)(import_client_app_impl._StackClientAppImplIncomplete),
    _StackServerAppImpl: (0, import_compile_time.scrambleDuringCompileTime)(import_server_app_impl._StackServerAppImplIncomplete)
  };
}
var {
  _StackAdminAppImpl,
  _StackClientAppImpl,
  _StackServerAppImpl
} = complete();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  _StackAdminAppImpl,
  _StackClientAppImpl,
  _StackServerAppImpl
});
//# sourceMappingURL=index.js.map