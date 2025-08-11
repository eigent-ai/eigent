// src/components-page/account-settings/email-and-auth/password-section.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { passwordSchema as schemaFieldsPasswordSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "../../..";
import { FormWarningText } from "../../../components/elements/form-warning";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function PasswordSection() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });
  const contactChannels = user.useContactChannels();
  const [changingPassword, setChangingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const project = useStackApp().useProject();
  const passwordSchema = yupObject({
    oldPassword: user.hasPassword ? schemaFieldsPasswordSchema.defined().nonEmpty(t("Please enter your old password")) : yupString(),
    newPassword: schemaFieldsPasswordSchema.defined().nonEmpty(t("Please enter your password")).test({
      name: "is-valid-password",
      test: (value, ctx) => {
        const error = getPasswordError(value);
        if (error) {
          return ctx.createError({ message: error.message });
        } else {
          return true;
        }
      }
    }),
    newPasswordRepeat: yupString().nullable().oneOf([yup.ref("newPassword"), "", null], t("Passwords do not match")).defined().nonEmpty(t("Please repeat your password"))
  });
  const { register, handleSubmit, setError, formState: { errors }, clearErrors, reset } = useForm({
    resolver: yupResolver(passwordSchema)
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
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Password"),
      description: user.hasPassword ? t("Update your password") : t("Set a password for your account"),
      children: /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-4", children: !changingPassword ? hasValidEmail ? /* @__PURE__ */ jsx(
        Button,
        {
          variant: "secondary",
          onClick: () => setChangingPassword(true),
          children: user.hasPassword ? t("Update password") : t("Set password")
        }
      ) : /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: t("To set a password, please add a sign-in email.") }) : /* @__PURE__ */ jsxs(
        "form",
        {
          onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
          noValidate: true,
          children: [
            user.hasPassword && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsx(Label, { htmlFor: "old-password", className: "mb-1", children: t("Old password") }),
              /* @__PURE__ */ jsx(
                Input,
                {
                  id: "old-password",
                  type: "password",
                  autoComplete: "current-password",
                  ...register("oldPassword")
                }
              ),
              /* @__PURE__ */ jsx(FormWarningText, { text: errors.oldPassword?.message?.toString() })
            ] }),
            /* @__PURE__ */ jsx(Label, { htmlFor: "new-password", className: "mt-4 mb-1", children: t("New password") }),
            /* @__PURE__ */ jsx(
              PasswordInput,
              {
                id: "new-password",
                autoComplete: "new-password",
                ...registerPassword,
                onChange: (e) => {
                  clearErrors("newPassword");
                  clearErrors("newPasswordRepeat");
                  runAsynchronously(registerPassword.onChange(e));
                }
              }
            ),
            /* @__PURE__ */ jsx(FormWarningText, { text: errors.newPassword?.message?.toString() }),
            /* @__PURE__ */ jsx(Label, { htmlFor: "repeat-password", className: "mt-4 mb-1", children: t("Repeat new password") }),
            /* @__PURE__ */ jsx(
              PasswordInput,
              {
                id: "repeat-password",
                autoComplete: "new-password",
                ...registerPasswordRepeat,
                onChange: (e) => {
                  clearErrors("newPassword");
                  clearErrors("newPasswordRepeat");
                  runAsynchronously(registerPasswordRepeat.onChange(e));
                }
              }
            ),
            /* @__PURE__ */ jsx(FormWarningText, { text: errors.newPasswordRepeat?.message?.toString() }),
            /* @__PURE__ */ jsxs("div", { className: "mt-6 flex gap-4", children: [
              /* @__PURE__ */ jsx(Button, { type: "submit", loading, children: user.hasPassword ? t("Update Password") : t("Set Password") }),
              /* @__PURE__ */ jsx(
                Button,
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
export {
  PasswordSection
};
//# sourceMappingURL=password-section.js.map