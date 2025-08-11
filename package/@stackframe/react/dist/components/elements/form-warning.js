"use client";
"use strict";
"use client";
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

// src/components/elements/form-warning.tsx
var form_warning_exports = {};
__export(form_warning_exports, {
  FormWarningText: () => FormWarningText
});
module.exports = __toCommonJS(form_warning_exports);
var import_jsx_runtime = require("react/jsx-runtime");
function FormWarningText({ text }) {
  if (!text) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-red-500 text-sm mt-1", children: text });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  FormWarningText
});
//# sourceMappingURL=form-warning.js.map