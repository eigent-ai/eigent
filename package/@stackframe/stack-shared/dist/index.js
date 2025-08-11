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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  KnownError: () => import_known_errors.KnownError,
  KnownErrors: () => import_known_errors.KnownErrors,
  StackAdminInterface: () => import_adminInterface.StackAdminInterface,
  StackClientInterface: () => import_clientInterface.StackClientInterface,
  StackServerInterface: () => import_serverInterface.StackServerInterface
});
module.exports = __toCommonJS(index_exports);
var import_adminInterface = require("./interface/adminInterface");
var import_clientInterface = require("./interface/clientInterface");
var import_serverInterface = require("./interface/serverInterface");
var import_known_errors = require("./known-errors");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KnownError,
  KnownErrors,
  StackAdminInterface,
  StackClientInterface,
  StackServerInterface
});
//# sourceMappingURL=index.js.map