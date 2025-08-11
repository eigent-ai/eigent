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

// src/components/credential-sign-up.tsx
var credential_sign_up_exports = {};
__export(credential_sign_up_exports, {
  CredentialSignUp: () => CredentialSignUp
});
module.exports = __toCommonJS(credential_sign_up_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_password = require("@stackframe/stack-shared/dist/helpers/password");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var yup = __toESM(require("yup"));
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_form_warning = require("./elements/form-warning");
var import_jsx_runtime = require("react/jsx-runtime");
function CredentialSignUp(props) {
  const { t } = (0, import_translations.useTranslation)();
  const schema = (0, import_schema_fields.yupObject)({
    email: (0, import_schema_fields.strictEmailSchema)(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email")),
    password: import_schema_fields.passwordSchema.defined().nonEmpty(t("Please enter your password")).test({
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
    ...!props.noPasswordRepeat && {
      passwordRepeat: import_schema_fields.passwordSchema.nullable().oneOf([yup.ref("password"), "", null], t("Passwords do not match")).nonEmpty(t("Please repeat your password"))
    }
  });
  const { register, handleSubmit, setError, formState: { errors }, clearErrors } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(schema)
  });
  const app = (0, import__.useStackApp)();
  const [loading, setLoading] = (0, import_react.useState)(false);
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const { email, password } = data;
      const result = await app.signUpWithCredential({ email, password });
      if (result.status === "error") {
        setError("email", { type: "manual", message: result.error.message });
      }
    } finally {
      setLoading(false);
    }
  };
  const registerPassword = register("password");
  const registerPasswordRepeat = register("passwordRepeat");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "form",
    {
      className: "flex flex-col items-stretch stack-scope",
      onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
      noValidate: true,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "email", className: "mb-1", children: t("Email") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Input, { id: "email", type: "email", autoComplete: "email", ...register("email") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.email?.message?.toString() }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "password", className: "mt-4 mb-1", children: t("Password") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.PasswordInput,
          {
            id: "password",
            autoComplete: "new-password",
            ...registerPassword,
            onChange: (e) => {
              clearErrors("password");
              clearErrors("passwordRepeat");
              (0, import_promises.runAsynchronously)(registerPassword.onChange(e));
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.password?.message?.toString() }),
        !props.noPasswordRepeat && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "repeat-password", className: "mt-4 mb-1", children: t("Repeat Password") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.PasswordInput,
            {
              id: "repeat-password",
              ...registerPasswordRepeat,
              onChange: (e) => {
                clearErrors("password");
                clearErrors("passwordRepeat");
                (0, import_promises.runAsynchronously)(registerPasswordRepeat.onChange(e));
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.passwordRepeat?.message?.toString() })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", className: "mt-6", loading, children: t("Sign Up") })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CredentialSignUp
});
//# sourceMappingURL=credential-sign-up.js.map