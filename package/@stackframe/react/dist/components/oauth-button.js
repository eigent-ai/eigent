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

// src/components/oauth-button.tsx
var oauth_button_exports = {};
__export(oauth_button_exports, {
  OAuthButton: () => OAuthButton
});
module.exports = __toCommonJS(oauth_button_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_color = __toESM(require("color"));
var import_react = require("react");
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
var iconSize = 22;
var changeColor = (c, value) => {
  if (c.isLight()) {
    value = -value;
  }
  return c.hsl(c.hue(), c.saturationl(), c.lightness() + value).toString();
};
function OAuthButton({
  provider,
  type,
  isMock = false
}) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const styleId = (0, import_react.useId)().replaceAll(":", "-");
  const [lastUsed, setLastUsed] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    setLastUsed(localStorage.getItem("_STACK_AUTH.lastUsed"));
  }, []);
  let style;
  switch (provider) {
    case "google": {
      style = {
        backgroundColor: "#fff",
        textColor: "#000",
        name: "Google",
        border: "1px solid #ddd",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Google, { iconSize })
      };
      break;
    }
    case "github": {
      style = {
        backgroundColor: "#111",
        textColor: "#fff",
        border: "1px solid #333",
        name: "GitHub",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.GitHub, { iconSize })
      };
      break;
    }
    case "facebook": {
      style = {
        backgroundColor: "#1877F2",
        textColor: "#fff",
        name: "Facebook",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Facebook, { iconSize })
      };
      break;
    }
    case "microsoft": {
      style = {
        backgroundColor: "#2f2f2f",
        textColor: "#fff",
        name: "Microsoft",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Microsoft, { iconSize })
      };
      break;
    }
    case "spotify": {
      style = {
        backgroundColor: "#1DB954",
        textColor: "#fff",
        name: "Spotify",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Spotify, { iconSize })
      };
      break;
    }
    case "discord": {
      style = {
        backgroundColor: "#5865F2",
        textColor: "#fff",
        name: "Discord",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Discord, { iconSize })
      };
      break;
    }
    case "gitlab": {
      style = {
        backgroundColor: "#111",
        textColor: "#fff",
        border: "1px solid #333",
        name: "Gitlab",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Gitlab, { iconSize })
      };
      break;
    }
    case "apple": {
      style = {
        backgroundColor: "#000",
        textColor: "#fff",
        border: "1px solid #333",
        name: "Apple",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Apple, { iconSize })
      };
      break;
    }
    case "bitbucket": {
      style = {
        backgroundColor: "#fff",
        textColor: "#000",
        border: "1px solid #ddd",
        name: "Bitbucket",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.Bitbucket, { iconSize })
      };
      break;
    }
    case "linkedin": {
      style = {
        backgroundColor: "#0073b1",
        textColor: "#fff",
        name: "LinkedIn",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.LinkedIn, { iconSize })
      };
      break;
    }
    case "x": {
      style = {
        backgroundColor: "#000",
        textColor: "#fff",
        name: "X",
        icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.BrandIcons.X, { iconSize })
      };
      break;
    }
    default: {
      style = {
        name: provider,
        icon: null
      };
    }
  }
  const styleSheet = `
    .stack-oauth-button-${styleId} {
      background-color: ${style.backgroundColor} !important;
      color: ${style.textColor} !important;
      border: ${style.border} !important;
    }
    .stack-oauth-button-${styleId}:hover {
      background-color: ${changeColor((0, import_color.default)(style.backgroundColor), 10)} !important;
    }
  `;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: styleSheet }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      import_stack_ui.Button,
      {
        onClick: async () => {
          localStorage.setItem("_STACK_AUTH.lastUsed", provider);
          await stackApp.signInWithOAuth(provider);
        },
        className: `stack-oauth-button-${styleId} stack-scope relative`,
        children: [
          !isMock && lastUsed === provider && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-md", children: "last" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center w-full gap-4", children: [
            style.icon,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "flex-1", children: type === "sign-up" ? t("Sign up with {provider}", { provider: style.name }) : t("Sign in with {provider}", { provider: style.name }) })
          ] })
        ]
      }
    )
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OAuthButton
});
//# sourceMappingURL=oauth-button.js.map