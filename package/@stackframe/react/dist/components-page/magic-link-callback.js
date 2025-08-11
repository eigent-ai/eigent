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

// src/components-page/magic-link-callback.tsx
var magic_link_callback_exports = {};
__export(magic_link_callback_exports, {
  MagicLinkCallback: () => MagicLinkCallback
});
module.exports = __toCommonJS(magic_link_callback_exports);
var import_stack_shared = require("@stackframe/stack-shared");
var import_caches = require("@stackframe/stack-shared/dist/utils/caches");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_react = __toESM(require("react"));
var import__ = require("..");
var import_message_card = require("../components/message-cards/message-card");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
var cacheSignInWithMagicLink = (0, import_caches.cacheFunction)(async (stackApp, code) => {
  return await stackApp.signInWithMagicLink(code);
});
function MagicLinkCallback(props) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const user = (0, import__.useUser)();
  const [result, setResult] = import_react.default.useState(null);
  if (user) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "signedIn", fullPage: !!props.fullPage });
  }
  const invalidJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Invalid Magic Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("Please check if you have the correct link. If you continue to have issues, please contact support.") }) });
  const expiredJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Expired Magic Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("Your magic link has expired. Please request a new magic link if you need to sign-in.") }) });
  const alreadyUsedJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Magic Link Already Used"), fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("The magic link has already been used. The link can only be used once. Please request a new magic link if you need to sign-in again.") }) });
  if (!props.searchParams?.code) {
    return invalidJsx;
  }
  if (!result) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("Do you want to sign in?"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Sign in"),
        primaryAction: async () => {
          const result2 = await stackApp.signInWithMagicLink(props.searchParams?.code || (0, import_errors.throwErr)("No magic link provided"));
          setResult(result2);
        },
        secondaryButtonText: t("Cancel"),
        secondaryAction: async () => {
          await stackApp.redirectToHome();
        }
      }
    );
  } else {
    if (result.status === "error") {
      if (import_stack_shared.KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
        return invalidJsx;
      } else if (import_stack_shared.KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
        return expiredJsx;
      } else if (import_stack_shared.KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
        return alreadyUsedJsx;
      } else {
        throw result.error;
      }
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("Signed in successfully!"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Go home"),
        primaryAction: async () => {
          await stackApp.redirectToHome();
        }
      }
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MagicLinkCallback
});
//# sourceMappingURL=magic-link-callback.js.map