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

// src/components/message-cards/predefined-message-card.tsx
var predefined_message_card_exports = {};
__export(predefined_message_card_exports, {
  PredefinedMessageCard: () => PredefinedMessageCard
});
module.exports = __toCommonJS(predefined_message_card_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import__ = require("../..");
var import_translations = require("../../lib/translations");
var import_message_card = require("./message-card");
var import_jsx_runtime = require("react/jsx-runtime");
function PredefinedMessageCard({
  type,
  fullPage = false
}) {
  const stackApp = (0, import__.useStackApp)();
  const { t } = (0, import_translations.useTranslation)();
  let title;
  let message = null;
  let primaryButton = null;
  let secondaryButton = null;
  let primaryAction = null;
  let secondaryAction = null;
  switch (type) {
    case "signedIn": {
      title = t("You are already signed in");
      primaryAction = () => stackApp.redirectToHome();
      secondaryAction = () => stackApp.redirectToSignOut();
      primaryButton = t("Go home");
      secondaryButton = t("Sign out");
      break;
    }
    case "signedOut": {
      title = t("You are not currently signed in.");
      primaryAction = () => stackApp.redirectToSignIn();
      primaryButton = t("Sign in");
      break;
    }
    case "signUpDisabled": {
      title = t("Sign up for new users is not enabled at the moment.");
      primaryAction = () => stackApp.redirectToHome();
      secondaryAction = () => stackApp.redirectToSignIn();
      primaryButton = t("Go home");
      secondaryButton = t("Sign in");
      break;
    }
    case "emailSent": {
      title = t("Email sent!");
      message = t("If the user with this e-mail address exists, an e-mail was sent to your inbox. Make sure to check your spam folder.");
      primaryAction = () => stackApp.redirectToHome();
      primaryButton = t("Go home");
      break;
    }
    case "passwordReset": {
      title = t("Password reset successfully!");
      message = t("Your password has been reset. You can now sign in with your new password.");
      primaryAction = () => stackApp.redirectToSignIn({ noRedirectBack: true });
      primaryButton = t("Sign in");
      break;
    }
    case "unknownError": {
      title = t("An unknown error occurred");
      message = t("Please try again and if the problem persists, contact support.");
      primaryAction = () => stackApp.redirectToHome();
      primaryButton = t("Go home");
      break;
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_message_card.MessageCard,
    {
      title,
      fullPage,
      primaryButtonText: primaryButton,
      primaryAction,
      secondaryButtonText: secondaryButton || void 0,
      secondaryAction: secondaryAction || void 0,
      children: message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: message })
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PredefinedMessageCard
});
//# sourceMappingURL=predefined-message-card.js.map