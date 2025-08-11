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

// src/utils/browser-compat.tsx
var browser_compat_exports = {};
__export(browser_compat_exports, {
  getBrowserCompatibilityReport: () => getBrowserCompatibilityReport
});
module.exports = __toCommonJS(browser_compat_exports);
function getBrowserCompatibilityReport() {
  const test = (snippet) => {
    try {
      (0, eval)(snippet);
      return true;
    } catch (e) {
      return `FAILED: ${e}`;
    }
  };
  return {
    optionalChaining: test("({})?.b?.c"),
    nullishCoalescing: test("0 ?? 1"),
    weakRef: test("new WeakRef({})"),
    cryptoUuid: test("crypto.randomUUID()")
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getBrowserCompatibilityReport
});
//# sourceMappingURL=browser-compat.js.map