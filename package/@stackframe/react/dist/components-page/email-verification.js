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

// src/components-page/email-verification.tsx
var email_verification_exports = {};
__export(email_verification_exports, {
  EmailVerification: () => EmailVerification
});
module.exports = __toCommonJS(email_verification_exports);
var import_stack_shared = require("@stackframe/stack-shared");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_react = __toESM(require("react"));
var import__ = require("..");
var import_message_card = require("../components/message-cards/message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function EmailVerification(props) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const user = (0, import__.useUser)();
  const [result, setResult] = import_react.default.useState(null);
  const invalidJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Invalid Verification Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("Please check if you have the correct link. If you continue to have issues, please contact support.") }) });
  const expiredJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Expired Verification Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("Your email verification link has expired. Please request a new verification link from your account settings.") }) });
  if (!props.searchParams?.code) {
    return invalidJsx;
  }
  if (!result) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("Do you want to verify your email?"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Verify"),
        primaryAction: async () => {
          const result2 = await stackApp.verifyEmail(props.searchParams?.code || (0, import_errors.throwErr)("No verification code provided"));
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
      } else {
        throw result.error;
      }
    }
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: t("You email has been verified!"),
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
  EmailVerification
});
//# sourceMappingURL=email-verification.js.map