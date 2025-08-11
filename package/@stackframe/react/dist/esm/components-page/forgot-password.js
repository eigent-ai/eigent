"use client";
"use client";

// src/components-page/forgot-password.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, Typography, cn } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useStackApp, useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function ForgotPasswordForm({ onSent }) {
  const { t } = useTranslation();
  const schema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email"))
  });
  const { register, handleSubmit, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const stackApp = useStackApp();
  const [loading, setLoading] = useState(false);
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
  return /* @__PURE__ */ jsxs(
    "form",
    {
      className: "flex flex-col items-stretch stack-scope",
      onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
      noValidate: true,
      children: [
        /* @__PURE__ */ jsx(Label, { htmlFor: "email", className: "mb-1", children: t("Your Email") }),
        /* @__PURE__ */ jsx(
          Input,
          {
            id: "email",
            type: "email",
            autoComplete: "email",
            ...register("email"),
            onChange: () => clearErrors("email")
          }
        ),
        /* @__PURE__ */ jsx(FormWarningText, { text: errors.email?.message?.toString() }),
        /* @__PURE__ */ jsx(Button, { type: "submit", className: "mt-6", loading, children: t("Send Email") })
      ]
    }
  );
}
function ForgotPassword(props) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const user = useUser();
  const [sent, setSent] = useState(false);
  if (user) {
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "signedIn", fullPage: !!props.fullPage });
  }
  if (sent) {
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "emailSent", fullPage: !!props.fullPage });
  }
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ jsxs("div", { className: cn(
    "stack-scope max-w-[380px] flex-basis-[380px]",
    props.fullPage ? "p-4" : "p-0"
  ), children: [
    /* @__PURE__ */ jsxs("div", { className: "text-center", children: [
      /* @__PURE__ */ jsx(Typography, { type: "h2", children: t("Reset Your Password") }),
      /* @__PURE__ */ jsxs(Typography, { children: [
        t("Don't need to reset?"),
        " ",
        /* @__PURE__ */ jsx(StyledLink, { href: stackApp.urls["signIn"], children: t("Sign in") })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "mt-6", children: /* @__PURE__ */ jsx(ForgotPasswordForm, { onSent: () => setSent(true) }) })
  ] }) });
}
export {
  ForgotPassword,
  ForgotPasswordForm
};
//# sourceMappingURL=forgot-password.js.map