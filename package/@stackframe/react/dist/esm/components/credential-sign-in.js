"use client";
"use client";

// src/components/credential-sign-in.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { passwordSchema, strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useStackApp } from "..";
import { useTranslation } from "../lib/translations";
import { FormWarningText } from "./elements/form-warning";
import { StyledLink } from "./link";
import { jsx, jsxs } from "react/jsx-runtime";
function CredentialSignIn() {
  const { t } = useTranslation();
  const schema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email")),
    password: passwordSchema.defined().nonEmpty(t("Please enter your password"))
  });
  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: yupResolver(schema)
  });
  const app = useStackApp();
  const [loading, setLoading] = useState(false);
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
        /* @__PURE__ */ jsx(Label, { htmlFor: "password", className: "mt-4 mb-1", children: t("Password") }),
        /* @__PURE__ */ jsx(
          PasswordInput,
          {
            id: "password",
            autoComplete: "current-password",
            ...register("password")
          }
        ),
        /* @__PURE__ */ jsx(FormWarningText, { text: errors.password?.message?.toString() }),
        /* @__PURE__ */ jsx(StyledLink, { href: app.urls.forgotPassword, className: "mt-1 text-sm", children: t("Forgot password?") }),
        /* @__PURE__ */ jsx(Button, { type: "submit", className: "mt-6", loading, children: t("Sign In") })
      ]
    }
  );
}
export {
  CredentialSignIn
};
//# sourceMappingURL=credential-sign-in.js.map