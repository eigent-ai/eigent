"use client";
"use client";

// src/components/magic-link-sign-in.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, InputOTP, InputOTPGroup, InputOTPSlot, Label, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useStackApp } from "..";
import { useTranslation } from "../lib/translations";
import { FormWarningText } from "./elements/form-warning";
import { jsx, jsxs } from "react/jsx-runtime";
function OTP(props) {
  const { t } = useTranslation();
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const stackApp = useStackApp();
  const [error, setError] = useState(null);
  useEffect(() => {
    if (otp.length === 6 && !submitting) {
      setSubmitting(true);
      stackApp.signInWithMagicLink(otp + props.nonce).then((result) => {
        if (result.status === "error") {
          if (KnownErrors.VerificationCodeError.isInstance(result.error)) {
            setError(t("Invalid code"));
          } else if (KnownErrors.InvalidTotpCode.isInstance(result.error)) {
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
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-stretch stack-scope", children: [
    /* @__PURE__ */ jsxs("form", { className: "w-full flex flex-col items-center mb-2", children: [
      /* @__PURE__ */ jsx(Typography, { className: "mb-2", children: t("Enter the code from your email") }),
      /* @__PURE__ */ jsx(
        InputOTP,
        {
          maxLength: 6,
          type: "text",
          inputMode: "text",
          pattern: "^[a-zA-Z0-9]+$",
          value: otp,
          onChange: (value) => setOtp(value.toUpperCase()),
          disabled: submitting,
          children: /* @__PURE__ */ jsx(InputOTPGroup, { children: [0, 1, 2, 3, 4, 5].map((index) => /* @__PURE__ */ jsx(InputOTPSlot, { index, size: "lg" }, index)) })
        }
      ),
      error && /* @__PURE__ */ jsx(FormWarningText, { text: error })
    ] }),
    /* @__PURE__ */ jsx(Button, { variant: "link", onClick: props.onBack, className: "underline", children: t("Cancel") })
  ] });
}
function MagicLinkSignIn() {
  const { t } = useTranslation();
  const app = useStackApp();
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(null);
  const schema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email"))
  });
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: yupResolver(schema)
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
      if (KnownErrors.SignUpNotEnabled.isInstance(e)) {
        setError("email", { type: "manual", message: t("New account registration is not allowed") });
      } else {
        throw e;
      }
    } finally {
      setLoading(false);
    }
  };
  if (nonce) {
    return /* @__PURE__ */ jsx(OTP, { nonce, onBack: () => setNonce(null) });
  } else {
    return /* @__PURE__ */ jsxs(
      "form",
      {
        className: "flex flex-col items-stretch stack-scope",
        onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
        noValidate: true,
        children: [
          /* @__PURE__ */ jsx(Label, { htmlFor: "email", className: "mb-1", children: t("Email") }),
          /* @__PURE__ */ jsx(
            Input,
            {
              id: "email",
              type: "email",
              autoComplete: "email",
              ...register("email")
            }
          ),
          /* @__PURE__ */ jsx(FormWarningText, { text: errors.email?.message?.toString() }),
          /* @__PURE__ */ jsx(Button, { type: "submit", className: "mt-6", loading, children: t("Send email") })
        ]
      }
    );
  }
}
export {
  MagicLinkSignIn
};
//# sourceMappingURL=magic-link-sign-in.js.map