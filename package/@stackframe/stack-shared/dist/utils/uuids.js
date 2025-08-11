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

// src/utils/uuids.tsx
var uuids_exports = {};
__export(uuids_exports, {
  generateUuid: () => generateUuid,
  isUuid: () => isUuid
});
module.exports = __toCommonJS(uuids_exports);
var import_crypto = require("./crypto");
function generateUuid() {
  return "10000000-1000-4000-8000-100000000000".replace(
    /[018]/g,
    (c) => (+c ^ (0, import_crypto.generateRandomValues)(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}
function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  generateUuid,
  isUuid
});
//# sourceMappingURL=uuids.js.map