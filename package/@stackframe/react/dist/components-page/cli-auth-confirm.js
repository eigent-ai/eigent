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

// src/components-page/cli-auth-confirm.tsx
var cli_auth_confirm_exports = {};
__export(cli_auth_confirm_exports, {
  CliAuthConfirmation: () => CliAuthConfirmation
});
module.exports = __toCommonJS(cli_auth_confirm_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import__ = require("..");
var import_message_card = require("../components/message-cards/message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function CliAuthConfirmation({ fullPage = true }) {
  const { t } = (0, import_translations.useTranslation)();
  const app = (0, import__.useStackApp)();
  const [authorizing, setAuthorizing] = (0, import_react.useState)(false);
  const [success, setSuccess] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const user = app.useUser({ or: "redirect" });
  const handleAuthorize = async () => {
    if (authorizing) return;
    setAuthorizing(true);
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const loginCode = urlParams.get("login_code");
      if (!loginCode) {
        throw new Error("Missing login code in URL parameters");
      }
      const refreshToken = (await user.currentSession.getTokens()).refreshToken;
      if (!refreshToken) {
        throw new Error("You must be logged in to authorize CLI access");
      }
      const result = await app[import__.stackAppInternalsSymbol].sendRequest("/auth/cli/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: (await user.currentSession.getTokens()).refreshToken
        })
      });
      if (!result.ok) {
        throw new Error(`Authorization failed: ${result.status} ${await result.text()}`);
      }
      setSuccess(true);
    } catch (err) {
      setError(err);
    } finally {
      setAuthorizing(false);
    }
  };
  if (success) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("CLI Authorization Successful"),
        fullPage,
        primaryButtonText: t("Close"),
        primaryAction: () => window.close(),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("The CLI application has been authorized successfully. You can now close this window and return to the command line.") })
      }
    );
  }
  if (error) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      import_message_card.MessageCard,
      {
        title: t("Authorization Failed"),
        fullPage,
        primaryButtonText: t("Try Again"),
        primaryAction: () => setError(null),
        secondaryButtonText: t("Cancel"),
        secondaryAction: () => window.close(),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "text-red-600", children: t("Failed to authorize the CLI application:") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "text-red-600", children: error.message })
        ]
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_message_card.MessageCard,
    {
      title: t("Authorize CLI Application"),
      fullPage,
      primaryButtonText: authorizing ? t("Authorizing...") : t("Authorize"),
      primaryAction: handleAuthorize,
      secondaryButtonText: t("Cancel"),
      secondaryAction: () => window.close(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("A command line application is requesting access to your account. Click the button below to authorize it.") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", children: t("WARNING: Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, you can close this page and ignore it. We will never send you this link via email or any other means.") })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CliAuthConfirmation
});
//# sourceMappingURL=cli-auth-confirm.js.map