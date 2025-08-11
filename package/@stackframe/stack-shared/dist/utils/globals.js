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

// src/utils/globals.tsx
var globals_exports = {};
__export(globals_exports, {
  createGlobal: () => createGlobal,
  globalVar: () => globalVar
});
module.exports = __toCommonJS(globals_exports);
var globalVar = typeof globalThis !== "undefined" ? globalThis : typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {};
if (typeof globalThis === "undefined") {
  globalVar.globalThis = globalVar;
}
var stackGlobalsSymbol = Symbol.for("__stack-globals");
globalVar[stackGlobalsSymbol] ??= {};
function createGlobal(key, init) {
  if (!globalVar[stackGlobalsSymbol][key]) {
    globalVar[stackGlobalsSymbol][key] = init();
  }
  return globalVar[stackGlobalsSymbol][key];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createGlobal,
  globalVar
});
//# sourceMappingURL=globals.js.map