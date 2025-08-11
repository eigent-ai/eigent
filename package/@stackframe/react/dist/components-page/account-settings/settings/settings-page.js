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

// src/components-page/account-settings/settings/settings-page.tsx
var settings_page_exports = {};
__export(settings_page_exports, {
  SettingsPage: () => SettingsPage
});
module.exports = __toCommonJS(settings_page_exports);
var import_page_layout = require("../page-layout");
var import_delete_account_section = require("./delete-account-section");
var import_sign_out_section = require("./sign-out-section");
var import_jsx_runtime = require("react/jsx-runtime");
function SettingsPage() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_page_layout.PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_delete_account_section.DeleteAccountSection, {}),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_sign_out_section.SignOutSection, {})
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SettingsPage
});
//# sourceMappingURL=settings-page.js.map