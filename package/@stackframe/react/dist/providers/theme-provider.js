"use client";
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/providers/theme-provider.tsx
var theme_provider_exports = {};
__export(theme_provider_exports, {
  StackTheme: () => StackTheme
});
module.exports = __toCommonJS(theme_provider_exports);
var import_strings = require("@stackframe/stack-shared/dist/utils/strings");
var import_color = __toESM(require("color"));
var import_global_css = require("../generated/global-css");
var import_browser_script = require("../utils/browser-script");
var import_constants = require("../utils/constants");
var import_jsx_runtime = require("react/jsx-runtime");
function convertColorToCSSVars(obj) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => {
    const color = (0, import_color.default)(value).hsl().array();
    return [
      // Convert camelCase key to dash-case
      key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      // Convert color to CSS HSL string
      `${color[0]} ${color[1]}% ${color[2]}%`
    ];
  }));
}
function convertColorsToCSS(theme) {
  const { dark, light, ...rest } = theme;
  const colors = {
    light: { ...convertColorToCSSVars(light), ...rest },
    dark: convertColorToCSSVars(dark)
  };
  function colorsToCSSVars(colors2) {
    return Object.entries(colors2).map((params) => {
      return `--${params[0]}: ${params[1]};
`;
    }).join("");
  }
  return import_strings.deindent`
  .stack-scope {
  ${colorsToCSSVars(colors.light)}
  }
  html:has(head > [data-stack-theme="dark"]) .stack-scope {
  ${colorsToCSSVars(colors.dark)}
  }`;
}
function StackTheme({
  theme,
  children,
  nonce
}) {
  const themeValue = {
    ...import_constants.DEFAULT_THEME,
    ...theme,
    dark: { ...import_constants.DEFAULT_THEME.dark, ...theme?.dark },
    light: { ...import_constants.DEFAULT_THEME.light, ...theme?.light }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_browser_script.BrowserScript, { nonce }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "style",
      {
        suppressHydrationWarning: true,
        nonce,
        dangerouslySetInnerHTML: {
          __html: import_global_css.globalCSS + "\n" + convertColorsToCSS(themeValue)
        }
      }
    ),
    children
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StackTheme
});
//# sourceMappingURL=theme-provider.js.map