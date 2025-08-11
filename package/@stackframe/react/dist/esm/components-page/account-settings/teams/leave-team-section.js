// src/components-page/account-settings/teams/leave-team-section.tsx
import { Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { jsx, jsxs } from "react/jsx-runtime";
function LeaveTeamSection(props) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const [leaving, setLeaving] = useState(false);
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Leave Team"),
      description: t("leave this team and remove your team profile"),
      children: !leaving ? /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(
        Button,
        {
          variant: "secondary",
          onClick: () => setLeaving(true),
          children: t("Leave team")
        }
      ) }) : /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
        /* @__PURE__ */ jsx(Typography, { variant: "destructive", children: t("Are you sure you want to leave the team?") }),
        /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
          /* @__PURE__ */ jsx(
            Button,
            {
              variant: "destructive",
              onClick: async () => {
                await user.leaveTeam(props.team);
                window.location.reload();
              },
              children: t("Leave")
            }
          ),
          /* @__PURE__ */ jsx(
            Button,
            {
              variant: "secondary",
              onClick: () => setLeaving(false),
              children: t("Cancel")
            }
          )
        ] })
      ] })
    }
  );
}
export {
  LeaveTeamSection
};
//# sourceMappingURL=leave-team-section.js.map