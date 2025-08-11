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

// src/utils/html.tsx
var html_exports = {};
__export(html_exports, {
  escapeHtml: () => escapeHtml,
  html: () => html
});
module.exports = __toCommonJS(html_exports);
var import_strings = require("./strings");
function escapeHtml(unsafe) {
  return `${unsafe}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function html(strings, ...values) {
  return (0, import_strings.templateIdentity)(strings, ...values.map((v) => escapeHtml(`${v}`)));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  escapeHtml,
  html
});
//# sourceMappingURL=html.js.map