"use strict";
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

// src/components-page/account-settings/email-and-auth/emails-section.tsx
var emails_section_exports = {};
__export(emails_section_exports, {
  EmailsSection: () => EmailsSection
});
module.exports = __toCommonJS(emails_section_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_known_errors = require("@stackframe/stack-shared/dist/known-errors");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import_form_warning = require("../../../components/elements/form-warning");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function EmailsSection() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const contactChannels = user.useContactChannels();
  const [addingEmail, setAddingEmail] = (0, import_react.useState)(contactChannels.length === 0);
  const [addingEmailLoading, setAddingEmailLoading] = (0, import_react.useState)(false);
  const [addedEmail, setAddedEmail] = (0, import_react.useState)(null);
  const isLastEmail = contactChannels.filter((x) => x.usedForAuth && x.type === "email").length === 1;
  (0, import_react.useEffect)(() => {
    if (addedEmail) {
      (0, import_promises.runAsynchronously)(async () => {
        const cc = contactChannels.find((x) => x.value === addedEmail);
        if (cc && !cc.isVerified) {
          await cc.sendVerificationEmail();
        }
        setAddedEmail(null);
      });
    }
  }, [contactChannels, addedEmail]);
  const emailSchema = (0, import_schema_fields.yupObject)({
    email: (0, import_schema_fields.strictEmailSchema)(t("Please enter a valid email address")).notOneOf(contactChannels.map((x) => x.value), t("Email already exists")).defined().nonEmpty(t("Email is required"))
  });
  const { register, handleSubmit, formState: { errors }, reset } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(emailSchema)
  });
  const onSubmit = async (data) => {
    setAddingEmailLoading(true);
    try {
      await user.createContactChannel({ type: "email", value: data.email, usedForAuth: false });
      setAddedEmail(data.email);
    } finally {
      setAddingEmailLoading(false);
    }
    setAddingEmail(false);
    reset();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col md:flex-row justify-between mb-4 gap-4", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "font-medium", children: t("Emails") }),
      addingEmail ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "form",
        {
          onSubmit: (e) => {
            e.preventDefault();
            (0, import_promises.runAsynchronously)(handleSubmit(onSubmit));
          },
          className: "flex flex-col",
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_stack_ui.Input,
                {
                  ...register("email"),
                  placeholder: t("Enter email")
                }
              ),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", loading: addingEmailLoading, children: t("Add") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                import_stack_ui.Button,
                {
                  variant: "secondary",
                  onClick: () => {
                    setAddingEmail(false);
                    reset();
                  },
                  children: t("Cancel")
                }
              )
            ] }),
            errors.email && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.email.message })
          ]
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex md:justify-end", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { variant: "secondary", onClick: () => setAddingEmail(true), children: t("Add an email") }) })
    ] }),
    contactChannels.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "border rounded-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Table, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableBody, { children: contactChannels.filter((x) => x.type === "email").sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
      return 0;
    }).map((x) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col md:flex-row gap-2 md:gap-4", children: [
        x.value,
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
          x.isPrimary ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Badge, { children: t("Primary") }) : null,
          !x.isVerified ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Badge, { variant: "destructive", children: t("Unverified") }) : null,
          x.usedForAuth ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Badge, { variant: "outline", children: t("Used for sign-in") }) : null
        ] })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { className: "flex justify-end", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.ActionCell, { items: [
        ...!x.isVerified ? [{
          item: t("Send verification email"),
          onClick: async () => {
            await x.sendVerificationEmail();
          }
        }] : [],
        ...!x.isPrimary && x.isVerified ? [{
          item: t("Set as primary"),
          onClick: async () => {
            await x.update({ isPrimary: true });
          }
        }] : !x.isPrimary ? [{
          item: t("Set as primary"),
          onClick: async () => {
          },
          disabled: true,
          disabledTooltip: t("Please verify your email first")
        }] : [],
        ...!x.usedForAuth && x.isVerified ? [{
          item: t("Use for sign-in"),
          onClick: async () => {
            try {
              await x.update({ usedForAuth: true });
            } catch (e) {
              if (import_known_errors.KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse.isInstance(e)) {
                alert(t("This email is already used for sign-in by another user."));
              }
            }
          }
        }] : [],
        ...x.usedForAuth && !isLastEmail ? [{
          item: t("Stop using for sign-in"),
          onClick: async () => {
            await x.update({ usedForAuth: false });
          }
        }] : x.usedForAuth ? [{
          item: t("Stop using for sign-in"),
          onClick: async () => {
          },
          disabled: true,
          disabledTooltip: t("You can not remove your last sign-in email")
        }] : [],
        ...!isLastEmail || !x.usedForAuth ? [{
          item: t("Remove"),
          onClick: async () => {
            await x.delete();
          },
          danger: true
        }] : [{
          item: t("Remove"),
          onClick: async () => {
          },
          disabled: true,
          disabledTooltip: t("You can not remove your last sign-in email")
        }]
      ] }) })
    ] }, x.id)) }) }) }) : null
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EmailsSection
});
//# sourceMappingURL=emails-section.js.map