// src/components-page/account-settings/teams/team-profile-user-section.tsx
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { Section } from "../section";
import { jsx } from "react/jsx-runtime";
function TeamUserProfileSection(props) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const profile = user.useTeamProfile(props.team);
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Team user name"),
      description: t("Overwrite your user display name in this team"),
      children: /* @__PURE__ */ jsx(
        EditableText,
        {
          value: profile.displayName || "",
          onSave: async (newDisplayName) => {
            await profile.update({ displayName: newDisplayName });
          }
        }
      )
    }
  );
}
export {
  TeamUserProfileSection
};
//# sourceMappingURL=team-profile-user-section.js.map