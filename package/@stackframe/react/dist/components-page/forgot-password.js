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

// src/components-page/forgot-password.tsx
var forgot_password_exports = {};
__export(forgot_password_exports, {
  ForgotPassword: () => ForgotPassword,
  ForgotPasswordForm: () => ForgotPasswordForm
});
module.exports = __toCommonJS(forgot_password_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import__ = require("..");
var import_form_warning = require("../components/elements/form-warning");
var import_maybe_full_page = require("../components/elements/maybe-full-page");
var import_link = require("../components/link");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function ForgotPasswordForm({ onSent }) {
  const { t } = (0, import_translations.useTranslation)();
  const schema = (0, import_schema_fields.yupObject)({
    email: (0, import_schema_fields.strictEmailSchema)(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email"))
  });
  const { register, handleSubmit, formState: { errors }, clearErrors } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(schema)
  });
  const stackApp = (0, import__.useStackApp)();
  const [loading, setLoading] = (0, import_react.useState)(false);
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const { email } = data;
      await stackApp.sendForgotPasswordEmail(email);
      onSent?.();
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "form",
    {
      className: "flex flex-col items-stretch stack-scope",
      onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
      noValidate: true,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "email", className: "mb-1", children: t("Your Email") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Input,
          {
            id: "email",
            type: "email",
            autoComplete: "email",
            ...register("email"),
            onChange: () => clearErrors("email")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.email?.message?.toString() }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", className: "mt-6", loading, children: t("Send Email") })
      ]
    }
  );
}
function ForgotPassword(props) {
  const { t } = (0, import_translations.useTranslation)();
  const stackApp = (0, import__.useStackApp)();
  const user = (0, import__.useUser)();
  const [sent, setSent] = (0, import_react.useState)(false);
  if (user) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "signedIn", fullPage: !!props.fullPage });
  }
  if (sent) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "emailSent", fullPage: !!props.fullPage });
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: (0, import_stack_ui.cn)(
    "stack-scope max-w-[380px] flex-basis-[380px]",
    props.fullPage ? "p-4" : "p-0"
  ), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "text-center", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h2", children: t("Reset Your Password") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
        t("Don't need to reset?"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_link.StyledLink, { href: stackApp.urls["signIn"], children: t("Sign in") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-6", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ForgotPasswordForm, { onSent: () => setSent(true) }) })
  ] }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ForgotPassword,
  ForgotPasswordForm
});
//# sourceMappingURL=forgot-password.js.map