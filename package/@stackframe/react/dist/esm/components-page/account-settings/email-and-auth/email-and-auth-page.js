// src/components-page/account-settings/email-and-auth/email-and-auth-page.tsx
import { PageLayout } from "../page-layout";
import { EmailsSection } from "./emails-section";
import { MfaSection } from "./mfa-section";
import { OtpSection } from "./otp-section";
import { PasskeySection } from "./passkey-section";
import { PasswordSection } from "./password-section";
import { jsx, jsxs } from "react/jsx-runtime";
function EmailsAndAuthPage() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(EmailsSection, {}),
    /* @__PURE__ */ jsx(PasswordSection, {}),
    /* @__PURE__ */ jsx(PasskeySection, {}),
    /* @__PURE__ */ jsx(OtpSection, {}),
    /* @__PURE__ */ jsx(MfaSection, {})
  ] });
}
export {
  EmailsAndAuthPage
};
//# sourceMappingURL=email-and-auth-page.js.map