// src/components-page/account-settings/teams/team-member-list-section.tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { UserAvatar } from "../../../components/elements/user-avatar";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function TeamMemberListSection(props) {
  const user = useUser({ or: "redirect" });
  const readMemberPermission = user.usePermission(props.team, "$read_members");
  const inviteMemberPermission = user.usePermission(props.team, "$invite_members");
  if (!readMemberPermission && !inviteMemberPermission) {
    return null;
  }
  return /* @__PURE__ */ jsx(MemberListSectionInner, { team: props.team });
}
function MemberListSectionInner(props) {
  const { t } = useTranslation();
  const users = props.team.useUsers();
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx(Typography, { className: "font-medium mb-2", children: t("Members") }),
    /* @__PURE__ */ jsx("div", { className: "border rounded-md", children: /* @__PURE__ */ jsxs(Table, { children: [
      /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { children: [
        /* @__PURE__ */ jsx(TableHead, { className: "w-[100px]", children: t("User") }),
        /* @__PURE__ */ jsx(TableHead, { className: "w-[200px]", children: t("Name") })
      ] }) }),
      /* @__PURE__ */ jsx(TableBody, { children: users.map(({ id, teamProfile }, i) => /* @__PURE__ */ jsxs(TableRow, { children: [
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsx(UserAvatar, { user: teamProfile }) }),
        /* @__PURE__ */ jsxs(TableCell, { children: [
          teamProfile.displayName && /* @__PURE__ */ jsx(Typography, { children: teamProfile.displayName }),
          !teamProfile.displayName && /* @__PURE__ */ jsx(Typography, { className: "text-muted-foreground italic", children: t("No display name set") })
        ] })
      ] }, id)) })
    ] }) })
  ] });
}
export {
  TeamMemberListSection
};
//# sourceMappingURL=team-member-list-section.js.map