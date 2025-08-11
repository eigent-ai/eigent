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

// src/components-page/account-settings/email-and-auth/otp-section.tsx
var otp_section_exports = {};
__export(otp_section_exports, {
  OtpSection: () => OtpSection
});
module.exports = __toCommonJS(otp_section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function OtpSection() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "throw" });
  const project = (0, import_hooks.useStackApp)().useProject();
  const contactChannels = user.useContactChannels();
  const isLastAuth = user.otpAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.passkeyAuthEnabled;
  const [disabling, setDisabling] = (0, import_react.useState)(false);
  const hasValidEmail = contactChannels.filter((x) => x.type === "email" && x.isVerified && x.usedForAuth).length > 0;
  if (!project.config.magicLinkEnabled) {
    return null;
  }
  const handleDisableOTP = async () => {
    await user.update({ otpAuthEnabled: false });
    setDisabling(false);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_section.Section, { title: t("OTP sign-in"), description: user.otpAuthEnabled ? t("OTP/magic link sign-in is currently enabled.") : t("Enable sign-in via magic link or OTP sent to your sign-in emails."), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex md:justify-end", children: hasValidEmail ? user.otpAuthEnabled ? !isLastAuth ? !disabling ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.Button,
    {
      variant: "secondary",
      onClick: () => setDisabling(true),
      children: t("Disable OTP")
    }
  ) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", children: t("Are you sure you want to disable OTP sign-in? You will not be able to sign in with only emails anymore.") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "destructive",
          onClick: handleDisableOTP,
          children: t("Disable")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "secondary",
          onClick: () => setDisabling(false),
          children: t("Cancel")
        }
      )
    ] })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: t("OTP sign-in is enabled and cannot be disabled as it is currently the only sign-in method") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_stack_ui.Button,
    {
      variant: "secondary",
      onClick: async () => {
        await user.update({ otpAuthEnabled: true });
      },
      children: t("Enable OTP")
    }
  ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "label", children: t("To enable OTP sign-in, please add a verified sign-in email.") }) }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OtpSection
});
//# sourceMappingURL=otp-section.js.map