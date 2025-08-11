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

// src/components/passkey-button.tsx
var passkey_button_exports = {};
__export(passkey_button_exports, {
  PasskeyButton: () => PasskeyButton
});
module.exports = __toCommonJS(passkey_button_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_lucide_react = require("lucide-react");
var import_jsx_runtime = require("react/jsx-runtime");
function PasskeyButton({
  type
}) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const styleId = (0, import_react.useId)().replaceAll(":", "-");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.Button,
    {
      onClick: async () => {
        await stackApp.signInWithPasskey();
      },
      className: `stack-oauth-button-${styleId} stack-scope`,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center w-full gap-4", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.KeyRound, {}),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "flex-1", children: type === "sign-up" ? t("Sign up with Passkey") : t("Sign in with Passkey") })
      ] })
    }
  ) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PasskeyButton
});
//# sourceMappingURL=passkey-button.js.map