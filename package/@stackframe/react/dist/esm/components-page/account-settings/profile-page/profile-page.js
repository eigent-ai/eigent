// src/components-page/account-settings/profile-page/profile-page.tsx
import { ProfileImageEditor } from "../../../components/profile-image-editor";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { PageLayout } from "../page-layout";
import { Section } from "../section";
import { jsx, jsxs } from "react/jsx-runtime";
function ProfilePage() {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(
      Section,
      {
        title: t("User name"),
        description: t("This is a display name and is not used for authentication"),
        children: /* @__PURE__ */ jsx(
          EditableText,
          {
            value: user.displayName || "",
            onSave: async (newDisplayName) => {
              await user.update({ displayName: newDisplayName });
            }
          }
        )
      }
    ),
    /* @__PURE__ */ jsx(
      Section,
      {
        title: t("Profile image"),
        description: t("Upload your own image as your avatar"),
        children: /* @__PURE__ */ jsx(
          ProfileImageEditor,
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
export {
  ProfilePage
};
//# sourceMappingURL=profile-page.js.map