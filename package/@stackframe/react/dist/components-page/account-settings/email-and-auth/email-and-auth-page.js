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

// src/components-page/account-settings/email-and-auth/email-and-auth-page.tsx
var email_and_auth_page_exports = {};
__export(email_and_auth_page_exports, {
  EmailsAndAuthPage: () => EmailsAndAuthPage
});
module.exports = __toCommonJS(email_and_auth_page_exports);
var import_page_layout = require("../page-layout");
var import_emails_section = require("./emails-section");
var import_mfa_section = require("./mfa-section");
var import_otp_section = require("./otp-section");
var import_passkey_section = require("./passkey-section");
var import_password_section = require("./password-section");
var import_jsx_runtime = require("react/jsx-runtime");
function EmailsAndAuthPage() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_page_layout.PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_emails_section.EmailsSection, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_password_section.PasswordSection, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_passkey_section.PasskeySection, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_otp_section.OtpSection, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_mfa_section.MfaSection, {})
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EmailsAndAuthPage
});
//# sourceMappingURL=email-and-auth-page.js.map