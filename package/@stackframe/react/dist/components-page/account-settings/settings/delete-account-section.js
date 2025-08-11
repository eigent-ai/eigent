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

// src/components-page/account-settings/settings/delete-account-section.tsx
var delete_account_section_exports = {};
__export(delete_account_section_exports, {
  DeleteAccountSection: () => DeleteAccountSection
});
module.exports = __toCommonJS(delete_account_section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function DeleteAccountSection() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const app = (0, import_hooks.useStackApp)();
  const project = app.useProject();
  const [deleting, setDeleting] = (0, import_react.useState)(false);
  if (!project.config.clientUserDeletionEnabled) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_section.Section,
    {
      title: t("Delete Account"),
      description: t("Permanently remove your account and all associated data"),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "stack-scope flex flex-col items-stretch", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Accordion, { type: "single", collapsible: true, className: "w-full", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.AccordionItem, { value: "item-1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.AccordionTrigger, { children: t("Danger zone") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.AccordionContent, { children: !deleting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "destructive",
            onClick: () => setDeleting(true),
            children: t("Delete account")
          }
        ) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", children: t("Are you sure you want to delete your account? This action is IRREVERSIBLE and will delete ALL associated data.") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_stack_ui.Button,
              {
                variant: "destructive",
                onClick: async () => {
                  await user.delete();
                  await app.redirectToHome();
                },
                children: t("Delete Account")
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              import_stack_ui.Button,
              {
                variant: "secondary",
                onClick: () => setDeleting(false),
                children: t("Cancel")
              }
            )
          ] })
        ] }) })
      ] }) }) })
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DeleteAccountSection
});
//# sourceMappingURL=delete-account-section.js.map