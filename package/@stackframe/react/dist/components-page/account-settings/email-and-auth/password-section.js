"use strict";
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

// src/components-page/account-settings/email-and-auth/password-section.tsx
var password_section_exports = {};
__export(password_section_exports, {
  PasswordSection: () => PasswordSection
});
module.exports = __toCommonJS(password_section_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_password = require("@stackframe/stack-shared/dist/helpers/password");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var yup = __toESM(require("yup"));
var import__ = require("../../..");
var import_form_warning = require("../../../components/elements/form-warning");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function PasswordSection() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "throw" });
  const contactChannels = user.useContactChannels();
  const [changingPassword, setChangingPassword] = (0, import_react.useState)(false);
  const [loading, setLoading] = (0, import_react.useState)(false);
  const project = (0, import__.useStackApp)().useProject();
  const passwordSchema = (0, import_schema_fields.yupObject)({
    oldPassword: user.hasPassword ? import_schema_fields.passwordSchema.defined().nonEmpty(t("Please enter your old password")) : (0, import_schema_fields.yupString)(),
    newPassword: import_schema_fields.passwordSchema.defined().nonEmpty(t("Please enter your password")).test({
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
    newPasswordRepeat: (0, import_schema_fields.yupString)().nullable().oneOf([yup.ref("newPassword"), "", null], t("Passwords do not match")).defined().nonEmpty(t("Please repeat your password"))
  });
  const { register, handleSubmit, setError, formState: { errors }, clearErrors, reset } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(passwordSchema)
  });
  const hasValidEmail = contactChannels.filter((x) => x.type === "email" && x.usedForAuth).length > 0;
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const { oldPassword, newPassword } = data;
      const error = user.hasPassword ? await user.updatePassword({ oldPassword, newPassword }) : await user.setPassword({ password: newPassword });
      if (error) {
        setError("oldPassword", { type: "manual", message: t("Incorrect password") });
      } else {
        reset();
        setChangingPassword(false);
      }
    } finally {
      setLoading(false);
    }
  };
  const registerPassword = register("newPassword");
  const registerPasswordRepeat = register("newPasswordRepeat");
  if (!project.config.credentialEnabled) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_section.Section,
    {
      title: t("Password"),
      description: user.hasPassword ? t("Update your password") : t("Set a password for your account"),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex flex-col gap-4", children: !changingPassword ? hasValidEmail ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "secondary",
          onClick: () => setChangingPassword(true),
          children: user.hasPassword ? t("Update password") : t("Set password")
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: t("To set a password, please add a sign-in email.") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "form",
        {
          onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
          noValidate: true,
          children: [
            user.hasPassword && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "old-password", className: "mb-1", children: t("Old password") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_stack_ui.Input,
                {
                  id: "old-password",
                  type: "password",
                  autoComplete: "current-password",
                  ...register("oldPassword")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.oldPassword?.message?.toString() })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "new-password", className: "mt-4 mb-1", children: t("New password") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_stack_ui.PasswordInput,
              {
                id: "new-password",
                autoComplete: "new-password",
                ...registerPassword,
                onChange: (e) => {
                  clearErrors("newPassword");
                  clearErrors("newPasswordRepeat");
                  (0, import_promises.runAsynchronously)(registerPassword.onChange(e));
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.newPassword?.message?.toString() }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "repeat-password", className: "mt-4 mb-1", children: t("Repeat new password") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_stack_ui.PasswordInput,
              {
                id: "repeat-password",
                autoComplete: "new-password",
                ...registerPasswordRepeat,
                onChange: (e) => {
                  clearErrors("newPassword");
                  clearErrors("newPasswordRepeat");
                  (0, import_promises.runAsynchronously)(registerPasswordRepeat.onChange(e));
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.newPasswordRepeat?.message?.toString() }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mt-6 flex gap-4", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", loading, children: user.hasPassword ? t("Update Password") : t("Set Password") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_stack_ui.Button,
                {
                  variant: "secondary",
                  onClick: () => {
                    setChangingPassword(false);
                    reset();
                  },
                  children: t("Cancel")
                }
              )
            ] })
          ]
        }
      ) })
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PasswordSection
});
//# sourceMappingURL=password-section.js.map