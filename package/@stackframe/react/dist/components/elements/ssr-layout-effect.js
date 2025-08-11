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

// src/components/elements/ssr-layout-effect.tsx
var ssr_layout_effect_exports = {};
__export(ssr_layout_effect_exports, {
  SsrScript: () => SsrScript
});
module.exports = __toCommonJS(ssr_layout_effect_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function SsrScript(props) {
  (0, import_react.useLayoutEffect)(() => {
    (0, eval)(props.script);
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "script",
    {
      suppressHydrationWarning: true,
      nonce: props.nonce,
      dangerouslySetInnerHTML: { __html: props.script }
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SsrScript
});
//# sourceMappingURL=ssr-layout-effect.js.map