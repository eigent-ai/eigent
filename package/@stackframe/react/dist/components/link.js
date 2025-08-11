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

// src/components/link.tsx
var link_exports = {};
__export(link_exports, {
  Link: () => Link,
  StyledLink: () => StyledLink
});
module.exports = __toCommonJS(link_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_jsx_runtime = require("react/jsx-runtime");
function Link(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "a",
    {
      href: props.href,
      target: props.target,
      className: props.className,
      onClick: props.onClick,
      children: props.children
    }
  );
}
function StyledLink(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, { ...props, className: (0, import_stack_ui.cn)("underline font-medium", props.className), children: props.children });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Link,
  StyledLink
});
//# sourceMappingURL=link.js.map