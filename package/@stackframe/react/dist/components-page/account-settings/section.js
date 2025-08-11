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

// src/components-page/account-settings/section.tsx
var section_exports = {};
__export(section_exports, {
  Section: () => Section
});
module.exports = __toCommonJS(section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_jsx_runtime = require("react/jsx-runtime");
function Section(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Separator, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col sm:flex-row gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "sm:flex-1 flex flex-col justify-center", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "font-medium", children: props.title }),
        props.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "footnote", children: props.description })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "sm:flex-1 sm:items-end flex flex-col gap-2 ", children: props.children })
    ] })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Section
});
//# sourceMappingURL=section.js.map