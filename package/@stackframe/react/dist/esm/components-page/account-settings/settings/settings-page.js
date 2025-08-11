// src/components-page/account-settings/settings/settings-page.tsx
import { PageLayout } from "../page-layout";
import { DeleteAccountSection } from "./delete-account-section";
import { SignOutSection } from "./sign-out-section";
import { jsx, jsxs } from "react/jsx-runtime";
function SettingsPage() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(DeleteAccountSection, {}),
    /* @__PURE__ */ jsx(SignOutSection, {})
  ] });
}
export {
  SettingsPage
};
//# sourceMappingURL=settings-page.js.map