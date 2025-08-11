// src/components-page/account-settings/teams/team-page.tsx
import { PageLayout } from "../page-layout";
import { LeaveTeamSection } from "./leave-team-section";
import { TeamApiKeysSection } from "./team-api-keys-section";
import { TeamDisplayNameSection } from "./team-display-name-section";
import { TeamMemberInvitationSection } from "./team-member-invitation-section";
import { TeamMemberListSection } from "./team-member-list-section";
import { TeamProfileImageSection } from "./team-profile-image-section";
import { TeamUserProfileSection } from "./team-profile-user-section";
import { jsx, jsxs } from "react/jsx-runtime";
function TeamPage(props) {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(TeamUserProfileSection, { team: props.team }, `user-profile-${props.team.id}`),
    /* @__PURE__ */ jsx(TeamProfileImageSection, { team: props.team }, `profile-image-${props.team.id}`),
    /* @__PURE__ */ jsx(TeamDisplayNameSection, { team: props.team }, `display-name-${props.team.id}`),
    /* @__PURE__ */ jsx(TeamMemberListSection, { team: props.team }, `member-list-${props.team.id}`),
    /* @__PURE__ */ jsx(TeamMemberInvitationSection, { team: props.team }, `member-invitation-${props.team.id}`),
    /* @__PURE__ */ jsx(TeamApiKeysSection, { team: props.team }, `api-keys-${props.team.id}`),
    /* @__PURE__ */ jsx(LeaveTeamSection, { team: props.team }, `leave-team-${props.team.id}`)
  ] });
}
export {
  TeamPage
};
//# sourceMappingURL=team-page.js.map