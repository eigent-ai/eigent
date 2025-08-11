"use client";
"use client";

// src/components-page/password-reset.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { passwordSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { cacheFunction } from "@stackframe/stack-shared/dist/utils/caches";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Label, PasswordInput, Typography, cn } from "@stackframe/stack-ui";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { MessageCard } from "../components/message-cards/message-card";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function PasswordResetForm(props) {
  const { t } = useTranslation();
  const schema = yupObject({
    password: passwordSchema.defined(t("Please enter your password")).nonEmpty(t("Please enter your password")).test({
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
    passwordRepeat: yupString().nullable().oneOf([yup.ref("password"), null], t("Passwords do not match")).defined().nonEmpty(t("Please repeat your password"))
  });
  const { register, handleSubmit, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const stackApp = useStackApp();
  const [finished, setFinished] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [loading, setLoading] = useState(false);
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
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "passwordReset", fullPage: !!props.fullPage });
  }
  if (resetError) {
    return /* @__PURE__ */ jsx(MessageCard, { title: t("Failed to reset password"), fullPage: !!props.fullPage, children: t("Failed to reset password. Please request a new password reset link") });
  }
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ jsxs("div", { className: cn(
    "flex flex-col items-stretch max-w-[380px] flex-basis-[380px]",
    props.fullPage ? "p-4" : "p-0"
  ), children: [
    /* @__PURE__ */ jsx("div", { className: "text-center mb-6", children: /* @__PURE__ */ jsx(Typography, { type: "h2", children: t("Reset Your Password") }) }),
    /* @__PURE__ */ jsxs(
      "form",
      {
        className: "flex flex-col items-stretch",
        onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
        noValidate: true,
        children: [
          /* @__PURE__ */ jsx(Label, { htmlFor: "password", className: "mb-1", children: t("New Password") }),
          /* @__PURE__ */ jsx(
            PasswordInput,
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
          /* @__PURE__ */ jsx(FormWarningText, { text: errors.password?.message?.toString() }),
          /* @__PURE__ */ jsx(Label, { htmlFor: "repeat-password", className: "mt-4 mb-1", children: t("Repeat New Password") }),
          /* @__PURE__ */ jsx(
            PasswordInput,
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
          /* @__PURE__ */ jsx(FormWarningText, { text: errors.passwordRepeat?.message?.toString() }),
          /* @__PURE__ */ jsx(Button, { type: "submit", className: "mt-6", loading, children: t("Reset Password") })
        ]
      }
    )
  ] }) });
}
var cachedVerifyPasswordResetCode = cacheFunction(async (stackApp, code) => {
  return await stackApp.verifyPasswordResetCode(code);
});
function PasswordReset({
  searchParams,
  fullPage = false
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const invalidJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Invalid Password Reset Link"), fullPage, children: /* @__PURE__ */ jsx(Typography, { children: t("Please double check if you have the correct password reset link.") }) });
  const expiredJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Expired Password Reset Link"), fullPage, children: /* @__PURE__ */ jsx(Typography, { children: t("Your password reset link has expired. Please request a new password reset link from the login page.") }) });
  const usedJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Used Password Reset Link"), fullPage, children: /* @__PURE__ */ jsx(Typography, { children: t("This password reset link has already been used. If you need to reset your password again, please request a new password reset link from the login page.") }) });
  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }
  const result = React.use(cachedVerifyPasswordResetCode(stackApp, code));
  if (result.status === "error") {
    if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalidJsx;
    } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return expiredJsx;
    } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return usedJsx;
    } else {
      throw result.error;
    }
  }
  return /* @__PURE__ */ jsx(PasswordResetForm, { code, fullPage });
}
export {
  PasswordReset,
  PasswordResetForm as default
};
//# sourceMappingURL=password-reset.js.map