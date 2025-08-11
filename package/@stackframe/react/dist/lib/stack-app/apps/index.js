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

// src/lib/stack-app/apps/index.ts
var apps_exports = {};
__export(apps_exports, {
  StackAdminApp: () => import_admin_app.StackAdminApp,
  StackClientApp: () => import_client_app.StackClientApp,
  StackServerApp: () => import_server_app.StackServerApp
});
module.exports = __toCommonJS(apps_exports);
var import_client_app = require("./interfaces/client-app");
var import_server_app = require("./interfaces/server-app");
var import_admin_app = require("./interfaces/admin-app");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StackAdminApp,
  StackClientApp,
  StackServerApp
});
//# sourceMappingURL=index.js.map