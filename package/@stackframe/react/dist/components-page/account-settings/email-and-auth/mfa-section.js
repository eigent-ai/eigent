"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components-page/account-settings/email-and-auth/mfa-section.tsx
var mfa_section_exports = {};
__export(mfa_section_exports, {
  MfaSection: () => MfaSection
});
module.exports = __toCommonJS(mfa_section_exports);
var import_otp = require("@oslojs/otp");
var import_use_async_callback = require("@stackframe/stack-shared/dist/hooks/use-async-callback");
var import_crypto = require("@stackframe/stack-shared/dist/utils/crypto");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var QRCode = __toESM(require("qrcode"));
var import_react = require("react");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function MfaSection() {
  const { t } = (0, import_translations.useTranslation)();
  const project = (0, import_hooks.useStackApp)().useProject();
  const user = (0, import_hooks.useUser)({ or: "throw" });
  const [generatedSecret, setGeneratedSecret] = (0, import_react.useState)(null);
  const [qrCodeUrl, setQrCodeUrl] = (0, import_react.useState)(null);
  const [mfaCode, setMfaCode] = (0, import_react.useState)("");
  const [isMaybeWrong, setIsMaybeWrong] = (0, import_react.useState)(false);
  const isEnabled = user.isMultiFactorRequired;
  const [handleSubmit, isLoading] = (0, import_use_async_callback.useAsyncCallback)(async () => {
    await user.update({
      totpMultiFactorSecret: generatedSecret
    });
    setGeneratedSecret(null);
    setQrCodeUrl(null);
    setMfaCode("");
  }, [generatedSecret, user]);
  (0, import_react.useEffect)(() => {
    setIsMaybeWrong(false);
    (0, import_promises.runAsynchronouslyWithAlert)(async () => {
      if (generatedSecret && (0, import_otp.verifyTOTP)(generatedSecret, 30, 6, mfaCode)) {
        await handleSubmit();
      }
      setIsMaybeWrong(true);
    });
  }, [mfaCode, generatedSecret, handleSubmit]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_section.Section,
    {
      title: t("Multi-factor authentication"),
      description: isEnabled ? t("Multi-factor authentication is currently enabled.") : t("Multi-factor authentication is currently disabled."),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-4", children: [
        !isEnabled && generatedSecret && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Scan this QR code with your authenticator app:") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { width: 200, height: 200, src: qrCodeUrl ?? (0, import_errors.throwErr)("TOTP QR code failed to generate"), alt: t("TOTP multi-factor authentication QR code") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Then, enter your six-digit MFA code:") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Input,
            {
              value: mfaCode,
              onChange: (e) => {
                setIsMaybeWrong(false);
                setMfaCode(e.target.value);
              },
              placeholder: "123456",
              maxLength: 6,
              disabled: isLoading
            }
          ),
          isMaybeWrong && mfaCode.length === 6 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", children: t("Incorrect code. Please try again.") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Button,
            {
              variant: "secondary",
              onClick: () => {
                setGeneratedSecret(null);
                setQrCodeUrl(null);
                setMfaCode("");
              },
              children: t("Cancel")
            }
          ) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex gap-2", children: isEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "secondary",
            onClick: async () => {
              await user.update({
                totpMultiFactorSecret: null
              });
            },
            children: t("Disable MFA")
          }
        ) : !generatedSecret && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "secondary",
            onClick: async () => {
              const secret = (0, import_crypto.generateRandomValues)(new Uint8Array(20));
              setQrCodeUrl(await generateTotpQrCode(project, user, secret));
              setGeneratedSecret(secret);
            },
            children: t("Enable MFA")
          }
        ) })
      ] })
    }
  );
}
async function generateTotpQrCode(project, user, secret) {
  const uri = (0, import_otp.createTOTPKeyURI)(project.displayName, user.primaryEmail ?? user.id, secret, 30, 6);
  return await QRCode.toDataURL(uri);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MfaSection
});
//# sourceMappingURL=mfa-section.js.map