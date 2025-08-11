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

// src/components-page/password-reset.tsx
var password_reset_exports = {};
__export(password_reset_exports, {
  PasswordReset: () => PasswordReset,
  default: () => PasswordResetForm
});
module.exports = __toCommonJS(password_reset_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_stack_shared = require("@stackframe/stack-shared");
var import_password = require("@stackframe/stack-shared/dist/helpers/password");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_caches = require("@stackframe/stack-shared/dist/utils/caches");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = __toESM(require("react"));
var import_react_hook_form = require("react-hook-form");
var yup = __toESM(require("yup"));
var import__ = require("..");
var import_form_warning = require("../components/elements/form-warning");
var import_maybe_full_page = require("../components/elements/maybe-full-page");
var import_message_card = require("../components/message-cards/message-card");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function PasswordResetForm(props) {
  const { t } = (0, import_translations.useTranslation)();
  const schema = (0, import_schema_fields.yupObject)({
    password: import_schema_fields.passwordSchema.defined(t("Please enter your password")).nonEmpty(t("Please enter your password")).test({
      name: "is-valid-password",
      test: (value, ctx) => {
        const error = (0, import_password.getPasswordError)(value);
        if (error) {
          return ctx.createError({ message: error.message });
        } else {
          return true;
        }
      }
    }),
    passwordRepeat: (0, import_schema_fields.yupString)().nullable().oneOf([yup.ref("password"), null], t("Passwords do not match")).defined().nonEmpty(t("Please repeat your password"))
  });
  const { register, handleSubmit, formState: { errors }, clearErrors } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(schema)
  });
  const stackApp = (0, import__.useStackApp)();
  const [finished, setFinished] = (0, import_react.useState)(false);
  const [resetError, setResetError] = (0, import_react.useState)(false);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const { password } = data;
      const result = await stackApp.resetPassword({ password, code: props.code });
      if (result.status === "error") {
        setResetError(true);
        return;
      }
      setFinished(true);
    } finally {
      setLoading(false);
    }
  };
  if (finished) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "passwordReset", fullPage: !!props.fullPage });
  }
  if (resetError) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Failed to reset password"), fullPage: !!props.fullPage, children: t("Failed to reset password. Please request a new password reset link") });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: (0, import_stack_ui.cn)(
    "flex flex-col items-stretch max-w-[380px] flex-basis-[380px]",
    props.fullPage ? "p-4" : "p-0"
  ), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-center mb-6", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h2", children: t("Reset Your Password") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "form",
      {
        className: "flex flex-col items-stretch",
        onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
        noValidate: true,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "password", className: "mb-1", children: t("New Password") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.PasswordInput,
            {
              id: "password",
              autoComplete: "new-password",
              ...register("password"),
              onChange: () => {
                clearErrors("password");
                clearErrors("passwordRepeat");
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.password?.message?.toString() }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "repeat-password", className: "mt-4 mb-1", children: t("Repeat New Password") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.PasswordInput,
            {
              id: "repeat-password",
              autoComplete: "new-password",
              ...register("passwordRepeat"),
              onChange: () => {
                clearErrors("password");
                clearErrors("passwordRepeat");
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.passwordRepeat?.message?.toString() }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", className: "mt-6", loading, children: t("Reset Password") })
        ]
      }
    )
  ] }) });
}
var cachedVerifyPasswordResetCode = (0, import_caches.cacheFunction)(async (stackApp, code) => {
  return await stackApp.verifyPasswordResetCode(code);
});
function PasswordReset({
  searchParams,
  fullPage = false
}) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const invalidJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Invalid Password Reset Link"), fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Please double check if you have the correct password reset link.") }) });
  const expiredJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Expired Password Reset Link"), fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Your password reset link has expired. Please request a new password reset link from the login page.") }) });
  const usedJsx = /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Used Password Reset Link"), fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("This password reset link has already been used. If you need to reset your password again, please request a new password reset link from the login page.") }) });
  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }
  const result = import_react.default.use(cachedVerifyPasswordResetCode(stackApp, code));
  if (result.status === "error") {
    if (import_stack_shared.KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalidJsx;
    } else if (import_stack_shared.KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return expiredJsx;
    } else if (import_stack_shared.KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return usedJsx;
    } else {
      throw result.error;
    }
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PasswordResetForm, { code, fullPage });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PasswordReset
});
//# sourceMappingURL=password-reset.js.map