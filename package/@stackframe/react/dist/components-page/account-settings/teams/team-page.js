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

// src/components-page/account-settings/teams/team-page.tsx
var team_page_exports = {};
__export(team_page_exports, {
  TeamPage: () => TeamPage
});
module.exports = __toCommonJS(team_page_exports);
var import_page_layout = require("../page-layout");
var import_leave_team_section = require("./leave-team-section");
var import_team_api_keys_section = require("./team-api-keys-section");
var import_team_display_name_section = require("./team-display-name-section");
var import_team_member_invitation_section = require("./team-member-invitation-section");
var import_team_member_list_section = require("./team-member-list-section");
var import_team_profile_image_section = require("./team-profile-image-section");
var import_team_profile_user_section = require("./team-profile-user-section");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamPage(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_page_layout.PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_profile_user_section.TeamUserProfileSection, { team: props.team }, `user-profile-${props.team.id}`),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_profile_image_section.TeamProfileImageSection, { team: props.team }, `profile-image-${props.team.id}`),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_display_name_section.TeamDisplayNameSection, { team: props.team }, `display-name-${props.team.id}`),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_member_list_section.TeamMemberListSection, { team: props.team }, `member-list-${props.team.id}`),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_member_invitation_section.TeamMemberInvitationSection, { team: props.team }, `member-invitation-${props.team.id}`),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_api_keys_section.TeamApiKeysSection, { team: props.team }, `api-keys-${props.team.id}`),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_leave_team_section.LeaveTeamSection, { team: props.team }, `leave-team-${props.team.id}`)
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamPage
});
//# sourceMappingURL=team-page.js.map