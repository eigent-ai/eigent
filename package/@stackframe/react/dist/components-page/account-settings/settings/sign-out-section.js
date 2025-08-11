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

// src/components-page/account-settings/settings/sign-out-section.tsx
var sign_out_section_exports = {};
__export(sign_out_section_exports, {
  SignOutSection: () => SignOutSection
});
module.exports = __toCommonJS(sign_out_section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function SignOutSection() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "throw" });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_section.Section,
    {
      title: t("Sign out"),
      description: t("End your current session"),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "secondary",
          onClick: () => user.signOut(),
          children: t("Sign out")
        }
      ) })
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SignOutSection
});
//# sourceMappingURL=sign-out-section.js.map