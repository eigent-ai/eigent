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

// src/components-page/account-settings/email-and-auth/passkey-section.tsx
var passkey_section_exports = {};
__export(passkey_section_exports, {
  PasskeySection: () => PasskeySection
});
module.exports = __toCommonJS(passkey_section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import__ = require("../../..");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function PasskeySection() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "throw" });
  const stackApp = (0, import__.useStackApp)();
  const project = stackApp.useProject();
  const contactChannels = user.useContactChannels();
  const hasPasskey = user.passkeyAuthEnabled;
  const isLastAuth = user.passkeyAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.otpAuthEnabled;
  const [showConfirmationModal, setShowConfirmationModal] = (0, import_react.useState)(false);
  const hasValidEmail = contactChannels.filter((x) => x.type === "email" && x.isVerified && x.usedForAuth).length > 0;
  if (!project.config.passkeyEnabled) {
    return null;
  }
  const handleDeletePasskey = async () => {
    await user.update({ passkeyAuthEnabled: false });
    setShowConfirmationModal(false);
  };
  const handleAddNewPasskey = async () => {
    await user.registerPasskey();
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_section.Section, { title: t("Passkey"), description: hasPasskey ? t("Passkey registered") : t("Register a passkey"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex md:justify-end gap-2", children: [
    !hasValidEmail && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: t("To enable Passkey sign-in, please add a verified sign-in email.") }),
    hasValidEmail && hasPasskey && isLastAuth && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: t("Passkey sign-in is enabled and cannot be disabled as it is currently the only sign-in method") }),
    !hasPasskey && hasValidEmail && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { onClick: handleAddNewPasskey, variant: "secondary", children: t("Add new passkey") }) }),
    hasValidEmail && hasPasskey && !isLastAuth && !showConfirmationModal && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_stack_ui.Button,
      {
        variant: "secondary",
        onClick: () => setShowConfirmationModal(true),
        children: t("Delete Passkey")
      }
    ),
    hasValidEmail && hasPasskey && !isLastAuth && showConfirmationModal && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", children: t("Are you sure you want to disable Passkey sign-in? You will not be able to sign in with your passkey anymore.") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "destructive",
            onClick: handleDeletePasskey,
            children: t("Disable")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "secondary",
            onClick: () => setShowConfirmationModal(false),
            children: t("Cancel")
          }
        )
      ] })
    ] })
  ] }) }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PasskeySection
});
//# sourceMappingURL=passkey-section.js.map