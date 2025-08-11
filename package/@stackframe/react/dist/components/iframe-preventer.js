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

// src/components/iframe-preventer.tsx
var iframe_preventer_exports = {};
__export(iframe_preventer_exports, {
  IframePreventer: () => IframePreventer
});
module.exports = __toCommonJS(iframe_preventer_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function IframePreventer({ children }) {
  const [isIframe, setIsIframe] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    if (window.self !== window.top) {
      setIsIframe(true);
    }
  }, []);
  if (isIframe) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      "Stack Auth components may not run in an ",
      "<",
      "iframe",
      ">",
      "."
    ] });
  }
  return children;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IframePreventer
});
//# sourceMappingURL=iframe-preventer.js.map