"use client";
"use client";

// src/providers/theme-provider.tsx
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import Color from "color";
import { globalCSS } from "../generated/global-css";
import { BrowserScript } from "../utils/browser-script";
import { DEFAULT_THEME } from "../utils/constants";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function convertColorToCSSVars(obj) {
  return Object.fromEntries(Object.entries(obj).map(([key, value]) => {
    const color = Color(value).hsl().array();
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
  return deindent`
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
    ...DEFAULT_THEME,
    ...theme,
    dark: { ...DEFAULT_THEME.dark, ...theme?.dark },
    light: { ...DEFAULT_THEME.light, ...theme?.light }
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(BrowserScript, { nonce }),
    /* @__PURE__ */ jsx(
      "style",
      {
        suppressHydrationWarning: true,
        nonce,
        dangerouslySetInnerHTML: {
          __html: globalCSS + "\n" + convertColorsToCSS(themeValue)
        }
      }
    ),
    children
  ] });
}
export {
  StackTheme
};
//# sourceMappingURL=theme-provider.js.map