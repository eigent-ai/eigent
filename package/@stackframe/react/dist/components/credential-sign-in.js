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

// src/components/credential-sign-in.tsx
var credential_sign_in_exports = {};
__export(credential_sign_in_exports, {
  CredentialSignIn: () => CredentialSignIn
});
module.exports = __toCommonJS(credential_sign_in_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_form_warning = require("./elements/form-warning");
var import_link = require("./link");
var import_jsx_runtime = require("react/jsx-runtime");
function CredentialSignIn() {
  const { t } = (0, import_translations.useTranslation)();
  const schema = (0, import_schema_fields.yupObject)({
    email: (0, import_schema_fields.strictEmailSchema)(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email")),
    password: import_schema_fields.passwordSchema.defined().nonEmpty(t("Please enter your password"))
  });
  const { register, handleSubmit, setError, formState: { errors } } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(schema)
  });
  const app = (0, import__.useStackApp)();
  const [loading, setLoading] = (0, import_react.useState)(false);
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const { email, password } = data;
      const result = await app.signInWithCredential({
        email,
        password
      });
      if (result.status === "error") {
        setError("email", { type: "manual", message: result.error.message });
      }
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "password", className: "mt-4 mb-1", children: t("Password") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.PasswordInput,
          {
            id: "password",
            autoComplete: "current-password",
            ...register("password")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.password?.message?.toString() }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_link.StyledLink, { href: app.urls.forgotPassword, className: "mt-1 text-sm", children: t("Forgot password?") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", className: "mt-6", loading, children: t("Sign In") })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CredentialSignIn
});
//# sourceMappingURL=credential-sign-in.js.map