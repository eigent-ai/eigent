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

// src/components/api-key-dialogs.tsx
var api_key_dialogs_exports = {};
__export(api_key_dialogs_exports, {
  CreateApiKeyDialog: () => CreateApiKeyDialog,
  ShowApiKeyDialog: () => ShowApiKeyDialog,
  expiresInOptions: () => expiresInOptions,
  neverInMs: () => neverInMs
});
module.exports = __toCommonJS(api_key_dialogs_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import__ = require("..");
var import_form_warning = require("../components/elements/form-warning");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
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
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import__.useUser)({ or: "redirect" });
  const [loading, setLoading] = (0, import_react.useState)(false);
  const apiKeySchema = (0, import_schema_fields.yupObject)({
    description: (0, import_schema_fields.yupString)().defined().nonEmpty(t("Description is required")),
    expiresIn: (0, import_schema_fields.yupString)().defined()
  });
  const { register, handleSubmit, formState: { errors }, reset } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(apiKeySchema),
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
      (0, import_errors.captureError)("Failed to create API key", { error });
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.ActionDialog,
    {
      open: props.open,
      onOpenChange: props.onOpenChange,
      title: t("Create API Key"),
      description: t("API keys grant programmatic access to your account."),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "form",
        {
          onSubmit: (e) => {
            e.preventDefault();
            (0, import_promises.runAsynchronously)(handleSubmit(onSubmit));
          },
          className: "space-y-4",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "description", children: t("Description") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_stack_ui.Input,
                {
                  id: "description",
                  placeholder: t("e.g. Development, Production, CI/CD"),
                  ...register("description")
                }
              ),
              errors.description && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.description.message })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "space-y-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "expiresIn", children: t("Expires In") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                "select",
                {
                  id: "expiresIn",
                  className: "w-full p-2 border border-input rounded-md bg-background",
                  ...register("expiresIn"),
                  children: Object.entries(expiresInOptions).map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value, children: t(label) }, value))
                }
              ),
              errors.expiresIn && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.expiresIn.message })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex justify-end gap-2 pt-4", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_stack_ui.Button,
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
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", loading, children: t("Create") })
            ] })
          ]
        }
      )
    }
  );
}
function ShowApiKeyDialog(props) {
  const { t } = (0, import_translations.useTranslation)();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.ActionDialog,
    {
      open: !!props.apiKey,
      title: t("API Key"),
      okButton: { label: t("Close") },
      onClose: props.onClose,
      preventClose: true,
      confirmText: t("I understand that I will not be able to view this key again."),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-4", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
          t("Here is your API key."),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "font-bold", children: t("Copy it to a safe place. You will not be able to view it again.") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.CopyField,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CreateApiKeyDialog,
  ShowApiKeyDialog,
  expiresInOptions,
  neverInMs
});
//# sourceMappingURL=api-key-dialogs.js.map