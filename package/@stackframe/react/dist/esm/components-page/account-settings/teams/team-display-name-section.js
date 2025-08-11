// src/components-page/account-settings/teams/team-display-name-section.tsx
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { EditableText } from "../editable-text";
import { Section } from "../section";
import { jsx } from "react/jsx-runtime";
function TeamDisplayNameSection(props) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const updateTeamPermission = user.usePermission(props.team, "$update_team");
  if (!updateTeamPermission) {
    return null;
  }
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Team display name"),
      description: t("Change the display name of your team"),
      children: /* @__PURE__ */ jsx(
        EditableText,
        {
          value: props.team.displayName,
          onSave: async (newDisplayName) => await props.team.update({ displayName: newDisplayName })
        }
      )
    }
  );
}
export {
  TeamDisplayNameSection
};
//# sourceMappingURL=team-display-name-section.js.map