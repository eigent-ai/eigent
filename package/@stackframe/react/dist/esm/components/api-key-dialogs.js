"use client";
"use client";

// src/components/api-key-dialogs.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionDialog, Button, CopyField, Input, Label, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
var neverInMs = 1e3 * 60 * 60 * 24 * 365 * 200;
var expiresInOptions = {
  [1e3 * 60 * 60 * 24 * 1]: "1 day",
  [1e3 * 60 * 60 * 24 * 7]: "7 days",
  [1e3 * 60 * 60 * 24 * 30]: "30 days",
  [1e3 * 60 * 60 * 24 * 90]: "90 days",
  [1e3 * 60 * 60 * 24 * 365]: "1 year",
  [neverInMs]: "Never"
};
function CreateApiKeyDialog(props) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const [loading, setLoading] = useState(false);
  const apiKeySchema = yupObject({
    description: yupString().defined().nonEmpty(t("Description is required")),
    expiresIn: yupString().defined()
  });
  const { register, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: yupResolver(apiKeySchema),
    defaultValues: {
      description: "",
      expiresIn: Object.keys(expiresInOptions)[2]
      // Default to 30 days
    }
  });
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const expiresAt = new Date(Date.now() + parseInt(data.expiresIn));
      const apiKey = await props.createApiKey({
        description: data.description,
        expiresAt
      });
      if (props.onKeyCreated) {
        props.onKeyCreated(apiKey);
      }
      reset();
      props.onOpenChange(false);
    } catch (error) {
      captureError("Failed to create API key", { error });
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ jsx(
    ActionDialog,
    {
      open: props.open,
      onOpenChange: props.onOpenChange,
      title: t("Create API Key"),
      description: t("API keys grant programmatic access to your account."),
      children: /* @__PURE__ */ jsxs(
        "form",
        {
          onSubmit: (e) => {
            e.preventDefault();
            runAsynchronously(handleSubmit(onSubmit));
          },
          className: "space-y-4",
          children: [
            /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
              /* @__PURE__ */ jsx(Label, { htmlFor: "description", children: t("Description") }),
              /* @__PURE__ */ jsx(
                Input,
                {
                  id: "description",
                  placeholder: t("e.g. Development, Production, CI/CD"),
                  ...register("description")
                }
              ),
              errors.description && /* @__PURE__ */ jsx(FormWarningText, { text: errors.description.message })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
              /* @__PURE__ */ jsx(Label, { htmlFor: "expiresIn", children: t("Expires In") }),
              /* @__PURE__ */ jsx(
                "select",
                {
                  id: "expiresIn",
                  className: "w-full p-2 border border-input rounded-md bg-background",
                  ...register("expiresIn"),
                  children: Object.entries(expiresInOptions).map(([value, label]) => /* @__PURE__ */ jsx("option", { value, children: t(label) }, value))
                }
              ),
              errors.expiresIn && /* @__PURE__ */ jsx(FormWarningText, { text: errors.expiresIn.message })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "flex justify-end gap-2 pt-4", children: [
              /* @__PURE__ */ jsx(
                Button,
                {
                  type: "button",
                  variant: "secondary",
                  onClick: () => {
                    reset();
                    props.onOpenChange(false);
                  },
                  children: t("Cancel")
                }
              ),
              /* @__PURE__ */ jsx(Button, { type: "submit", loading, children: t("Create") })
            ] })
          ]
        }
      )
    }
  );
}
function ShowApiKeyDialog(props) {
  const { t } = useTranslation();
  return /* @__PURE__ */ jsx(
    ActionDialog,
    {
      open: !!props.apiKey,
      title: t("API Key"),
      okButton: { label: t("Close") },
      onClose: props.onClose,
      preventClose: true,
      confirmText: t("I understand that I will not be able to view this key again."),
      children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-4", children: [
        /* @__PURE__ */ jsxs(Typography, { children: [
          t("Here is your API key."),
          " ",
          /* @__PURE__ */ jsx("span", { className: "font-bold", children: t("Copy it to a safe place. You will not be able to view it again.") })
        ] }),
        /* @__PURE__ */ jsx(
          CopyField,
          {
            monospace: true,
            value: props.apiKey?.value ?? "",
            label: t("Secret API Key")
          }
        )
      ] })
    }
  );
}
export {
  CreateApiKeyDialog,
  ShowApiKeyDialog,
  expiresInOptions,
  neverInMs
};
//# sourceMappingURL=api-key-dialogs.js.map