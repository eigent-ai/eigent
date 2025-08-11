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

// src/utils/env.tsx
var env_exports = {};
__export(env_exports, {
  getEnvVariable: () => getEnvVariable,
  getNextRuntime: () => getNextRuntime,
  getNodeEnvironment: () => getNodeEnvironment,
  isBrowserLike: () => isBrowserLike
});
module.exports = __toCommonJS(env_exports);
var import_errors = require("./errors");
var import_strings = require("./strings");
function isBrowserLike() {
  return typeof window !== "undefined" && typeof document !== "undefined" && typeof document.createElement !== "undefined";
}
var ENV_VAR_RENAME = {
  NEXT_PUBLIC_STACK_API_URL: ["STACK_BASE_URL", "NEXT_PUBLIC_STACK_URL"]
};
function getEnvVariable(name, defaultValue) {
  if (isBrowserLike()) {
    throw new Error(import_strings.deindent`
      Can't use getEnvVariable on the client because Next.js transpiles expressions of the kind process.env.XYZ at build-time on the client.
    
      Use process.env.XYZ directly instead.
    `);
  }
  if (name === "NEXT_RUNTIME") {
    throw new Error(import_strings.deindent`
      Can't use getEnvVariable to access the NEXT_RUNTIME environment variable because it's compiled into the client bundle.
    
      Use getNextRuntime() instead.
    `);
  }
  for (const [newName, oldNames] of Object.entries(ENV_VAR_RENAME)) {
    if (oldNames.includes(name)) {
      (0, import_errors.throwErr)(`Environment variable ${name} has been renamed to ${newName}. Please update your configuration to use the new name.`);
    }
  }
  let value = process.env[name];
  if (!value && ENV_VAR_RENAME[name]) {
    for (const oldName of ENV_VAR_RENAME[name]) {
      value = process.env[oldName];
      if (value) break;
    }
  }
  if (value === void 0) {
    if (defaultValue !== void 0) {
      value = defaultValue;
    } else {
      (0, import_errors.throwErr)(`Missing environment variable: ${name}`);
    }
  }
  return value;
}
function getNextRuntime() {
  return process.env.NEXT_RUNTIME || (0, import_errors.throwErr)("Missing environment variable: NEXT_RUNTIME");
}
function getNodeEnvironment() {
  return getEnvVariable("NODE_ENV", "");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getEnvVariable,
  getNextRuntime,
  getNodeEnvironment,
  isBrowserLike
});
//# sourceMappingURL=env.js.map