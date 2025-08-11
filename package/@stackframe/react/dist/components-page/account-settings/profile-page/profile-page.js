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

// src/components-page/account-settings/profile-page/profile-page.tsx
var profile_page_exports = {};
__export(profile_page_exports, {
  ProfilePage: () => ProfilePage
});
module.exports = __toCommonJS(profile_page_exports);
var import_profile_image_editor = require("../../../components/profile-image-editor");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_editable_text = require("../editable-text");
var import_page_layout = require("../page-layout");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function ProfilePage() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_page_layout.PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_section.Section,
      {
        title: t("User name"),
        description: t("This is a display name and is not used for authentication"),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_editable_text.EditableText,
          {
            value: user.displayName || "",
            onSave: async (newDisplayName) => {
              await user.update({ displayName: newDisplayName });
            }
          }
        )
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_section.Section,
      {
        title: t("Profile image"),
        description: t("Upload your own image as your avatar"),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_profile_image_editor.ProfileImageEditor,
          {
            user,
            onProfileImageUrlChange: async (profileImageUrl) => {
              await user.update({ profileImageUrl });
            }
          }
        )
      }
    )
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ProfilePage
});
//# sourceMappingURL=profile-page.js.map