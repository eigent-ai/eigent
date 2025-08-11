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

// src/components-page/error-page.tsx
var error_page_exports = {};
__export(error_page_exports, {
  ErrorPage: () => ErrorPage
});
module.exports = __toCommonJS(error_page_exports);
var import_stack_shared = require("@stackframe/stack-shared");
var import_stack_ui = require("@stackframe/stack-ui");
var import__ = require("..");
var import_known_error_message_card = require("../components/message-cards/known-error-message-card");
var import_message_card = require("../components/message-cards/message-card");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function ErrorPage(props) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const errorCode = props.searchParams.errorCode;
  const message = props.searchParams.message;
  const details = props.searchParams.details;
  const unknownErrorCard = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "unknownError", fullPage: !!props.fullPage });
  if (!errorCode || !message) {
    return unknownErrorCard;
  }
  let error;
  try {
    const detailJson = details ? JSON.parse(details) : {};
    error = import_stack_shared.KnownError.fromJson({ code: errorCode, message, details: detailJson });
  } catch (e) {
    return unknownErrorCard;
  }
  if (import_stack_shared.KnownErrors.OAuthConnectionAlreadyConnectedToAnotherUser.isInstance(error)) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("Failed to connect account"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Go Home"),
        primaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("This account is already connected to another user. Please connect a different account.") })
      }
    );
  }
  if (import_stack_shared.KnownErrors.UserAlreadyConnectedToAnotherOAuthConnection.isInstance(error)) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("Failed to connect account"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Go Home"),
        primaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("The user is already connected to another OAuth account. Did you maybe selected the wrong account on the OAuth provider page?") })
      }
    );
  }
  if (import_stack_shared.KnownErrors.OAuthProviderAccessDenied.isInstance(error)) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("OAuth provider access denied"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Sign in again"),
        primaryAction: () => stackApp.redirectToSignIn(),
        secondaryButtonText: t("Go Home"),
        secondaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("The sign-in operation has been cancelled. Please try again. [access_denied]") })
      }
    );
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_known_error_message_card.KnownErrorMessageCard, { error, fullPage: !!props.fullPage });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ErrorPage
});
//# sourceMappingURL=error-page.js.map