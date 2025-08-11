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

// src/hooks/use-hash.tsx
var use_hash_exports = {};
__export(use_hash_exports, {
  useHash: () => useHash
});
module.exports = __toCommonJS(use_hash_exports);
var import_react = require("react");
var import_react2 = require("../utils/react");
var useHash = () => {
  (0, import_react2.suspendIfSsr)("useHash");
  return (0, import_react.useSyncExternalStore)(
    (onChange) => {
      const interval = setInterval(() => onChange(), 10);
      return () => clearInterval(interval);
    },
    () => window.location.hash.substring(1)
  );
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useHash
});
//# sourceMappingURL=use-hash.js.map