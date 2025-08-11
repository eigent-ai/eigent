"use client";
"use client";

// src/components/credential-sign-up.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { passwordSchema, strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "..";
import { useTranslation } from "../lib/translations";
import { FormWarningText } from "./elements/form-warning";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function CredentialSignUp(props) {
  const { t } = useTranslation();
  const schema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email")),
    password: passwordSchema.defined().nonEmpty(t("Please enter your password")).test({
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
    ...!props.noPasswordRepeat && {
      passwordRepeat: passwordSchema.nullable().oneOf([yup.ref("password"), "", null], t("Passwords do not match")).nonEmpty(t("Please repeat your password"))
    }
  });
  const { register, handleSubmit, setError, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const app = useStackApp();
  const [loading, setLoading] = useState(false);
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
  return /* @__PURE__ */ jsxs(
    "form",
    {
      className: "flex flex-col items-stretch stack-scope",
      onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
      noValidate: true,
      children: [
        /* @__PURE__ */ jsx(Label, { htmlFor: "email", className: "mb-1", children: t("Email") }),
        /* @__PURE__ */ jsx(Input, { id: "email", type: "email", autoComplete: "email", ...register("email") }),
        /* @__PURE__ */ jsx(FormWarningText, { text: errors.email?.message?.toString() }),
        /* @__PURE__ */ jsx(Label, { htmlFor: "password", className: "mt-4 mb-1", children: t("Password") }),
        /* @__PURE__ */ jsx(
          PasswordInput,
          {
            id: "password",
            autoComplete: "new-password",
            ...registerPassword,
            onChange: (e) => {
              clearErrors("password");
              clearErrors("passwordRepeat");
              runAsynchronously(registerPassword.onChange(e));
            }
          }
        ),
        /* @__PURE__ */ jsx(FormWarningText, { text: errors.password?.message?.toString() }),
        !props.noPasswordRepeat && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Label, { htmlFor: "repeat-password", className: "mt-4 mb-1", children: t("Repeat Password") }),
          /* @__PURE__ */ jsx(
            PasswordInput,
            {
              id: "repeat-password",
              ...registerPasswordRepeat,
              onChange: (e) => {
                clearErrors("password");
                clearErrors("passwordRepeat");
                runAsynchronously(registerPasswordRepeat.onChange(e));
              }
            }
          ),
          /* @__PURE__ */ jsx(FormWarningText, { text: errors.passwordRepeat?.message?.toString() })
        ] }),
        /* @__PURE__ */ jsx(Button, { type: "submit", className: "mt-6", loading, children: t("Sign Up") })
      ]
    }
  );
}
export {
  CredentialSignUp
};
//# sourceMappingURL=credential-sign-up.js.map