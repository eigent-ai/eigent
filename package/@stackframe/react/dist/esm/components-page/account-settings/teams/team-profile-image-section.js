// src/components-page/account-settings/teams/team-profile-image-section.tsx
import { ProfileImageEditor } from "../../../components/profile-image-editor";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { jsx } from "react/jsx-runtime";
function TeamProfileImageSection(props) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const updateTeamPermission = user.usePermission(props.team, "$update_team");
  if (!updateTeamPermission) {
    return null;
  }
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Team profile image"),
      description: t("Upload an image for your team"),
      children: /* @__PURE__ */ jsx(
        ProfileImageEditor,
        {
          user: props.team,
          onProfileImageUrlChange: async (profileImageUrl) => {
            await props.team.update({ profileImageUrl });
          }
        }
      )
    }
  );
}
export {
  TeamProfileImageSection
};
//# sourceMappingURL=team-profile-image-section.js.map