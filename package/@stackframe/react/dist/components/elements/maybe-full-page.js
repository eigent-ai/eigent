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

// src/components/elements/maybe-full-page.tsx
var maybe_full_page_exports = {};
__export(maybe_full_page_exports, {
  MaybeFullPage: () => MaybeFullPage
});
module.exports = __toCommonJS(maybe_full_page_exports);
var import_react = require("react");
var import_ssr_layout_effect = require("./ssr-layout-effect");
var import_jsx_runtime = require("react/jsx-runtime");
function MaybeFullPage({
  children,
  fullPage
}) {
  const uniqueId = (0, import_react.useId)();
  const id = `stack-full-page-container-${uniqueId}`;
  const scriptString = `(([id]) => {
    const el = document.getElementById(id);
    if (!el) {
      // component is not full page
      return;
    }
    const offset = el.getBoundingClientRect().top + document.documentElement.scrollTop;
    el.style.minHeight = \`calc(100vh - \${offset}px)\`;
  })(${JSON.stringify([id])})`;
  if (fullPage) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "div",
        {
          suppressHydrationWarning: true,
          id,
          style: {
            minHeight: "100vh",
            alignSelf: "stretch",
            flexGrow: 1,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          },
          className: "stack-scope",
          children
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_ssr_layout_effect.SsrScript, { script: scriptString })
    ] });
  } else {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MaybeFullPage
});
//# sourceMappingURL=maybe-full-page.js.map