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

// src/utils/json.tsx
var json_exports = {};
__export(json_exports, {
  isJson: () => isJson,
  parseJson: () => parseJson,
  stringifyJson: () => stringifyJson
});
module.exports = __toCommonJS(json_exports);
var import_results = require("./results");
function isJson(value) {
  switch (typeof value) {
    case "object": {
      if (value === null) return true;
      if (Array.isArray(value)) return value.every(isJson);
      return Object.keys(value).every((k) => typeof k === "string") && Object.values(value).every(isJson);
    }
    case "string":
    case "number":
    case "boolean": {
      return true;
    }
    default: {
      return false;
    }
  }
}
function parseJson(json) {
  return import_results.Result.fromThrowing(() => JSON.parse(json));
}
function stringifyJson(json) {
  return import_results.Result.fromThrowing(() => JSON.stringify(json));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  isJson,
  parseJson,
  stringifyJson
});
//# sourceMappingURL=json.js.map