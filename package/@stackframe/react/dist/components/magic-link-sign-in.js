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

// src/components/magic-link-sign-in.tsx
var magic_link_sign_in_exports = {};
__export(magic_link_sign_in_exports, {
  MagicLinkSignIn: () => MagicLinkSignIn
});
module.exports = __toCommonJS(magic_link_sign_in_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_stack_shared = require("@stackframe/stack-shared");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_form_warning = require("./elements/form-warning");
var import_jsx_runtime = require("react/jsx-runtime");
function OTP(props) {
  const { t } = (0, import_translations.useTranslation)();
  const [otp, setOtp] = (0, import_react.useState)("");
  const [submitting, setSubmitting] = (0, import_react.useState)(false);
  const stackApp = (0, import__.useStackApp)();
  const [error, setError] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (otp.length === 6 && !submitting) {
      setSubmitting(true);
      stackApp.signInWithMagicLink(otp + props.nonce).then((result) => {
        if (result.status === "error") {
          if (import_stack_shared.KnownErrors.VerificationCodeError.isInstance(result.error)) {
            setError(t("Invalid code"));
          } else if (import_stack_shared.KnownErrors.InvalidTotpCode.isInstance(result.error)) {
            setError(t("Invalid TOTP code"));
          } else {
            throw result.error;
          }
        }
      }).catch((e) => console.error(e)).finally(() => {
        setSubmitting(false);
        setOtp("");
      });
    }
    if (otp.length !== 0 && otp.length !== 6) {
      setError(null);
    }
  }, [otp, submitting]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col items-stretch stack-scope", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "w-full flex flex-col items-center mb-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "mb-2", children: t("Enter the code from your email") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.InputOTP,
        {
          maxLength: 6,
          type: "text",
          inputMode: "text",
          pattern: "^[a-zA-Z0-9]+$",
          value: otp,
          onChange: (value) => setOtp(value.toUpperCase()),
          disabled: submitting,
          children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.InputOTPGroup, { children: [0, 1, 2, 3, 4, 5].map((index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.InputOTPSlot, { index, size: "lg" }, index)) })
        }
      ),
      error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: error })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { variant: "link", onClick: props.onBack, className: "underline", children: t("Cancel") })
  ] });
}
function MagicLinkSignIn() {
  const { t } = (0, import_translations.useTranslation)();
  const app = (0, import__.useStackApp)();
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [nonce, setNonce] = (0, import_react.useState)(null);
  const schema = (0, import_schema_fields.yupObject)({
    email: (0, import_schema_fields.strictEmailSchema)(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email"))
  });
  const { register, handleSubmit, setError, formState: { errors } } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(schema)
  });
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const { email } = data;
      const result = await app.sendMagicLinkEmail(email);
      if (result.status === "error") {
        setError("email", { type: "manual", message: result.error.message });
        return;
      } else {
        setNonce(result.data.nonce);
      }
    } catch (e) {
      if (import_stack_shared.KnownErrors.SignUpNotEnabled.isInstance(e)) {
        setError("email", { type: "manual", message: t("New account registration is not allowed") });
      } else {
        throw e;
      }
    } finally {
      setLoading(false);
    }
  };
  if (nonce) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OTP, { nonce, onBack: () => setNonce(null) });
  } else {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "form",
      {
        className: "flex flex-col items-stretch stack-scope",
        onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
        noValidate: true,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "email", className: "mb-1", children: t("Email") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Input,
            {
              id: "email",
              type: "email",
              autoComplete: "email",
              ...register("email")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.email?.message?.toString() }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", className: "mt-6", loading, children: t("Send email") })
        ]
      }
    );
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MagicLinkSignIn
});
//# sourceMappingURL=magic-link-sign-in.js.map