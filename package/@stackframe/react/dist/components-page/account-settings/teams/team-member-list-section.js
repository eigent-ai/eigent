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

// src/components-page/account-settings/teams/team-member-list-section.tsx
var team_member_list_section_exports = {};
__export(team_member_list_section_exports, {
  TeamMemberListSection: () => TeamMemberListSection
});
module.exports = __toCommonJS(team_member_list_section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_user_avatar = require("../../../components/elements/user-avatar");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamMemberListSection(props) {
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const readMemberPermission = user.usePermission(props.team, "$read_members");
  const inviteMemberPermission = user.usePermission(props.team, "$invite_members");
  if (!readMemberPermission && !inviteMemberPermission) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MemberListSectionInner, { team: props.team });
}
function MemberListSectionInner(props) {
  const { t } = (0, import_translations.useTranslation)();
  const users = props.team.useUsers();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "font-medium mb-2", children: t("Members") }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "border rounded-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Table, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHeader, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[100px]", children: t("User") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[200px]", children: t("Name") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableBody, { children: users.map(({ id, teamProfile }, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_user_avatar.UserAvatar, { user: teamProfile }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableCell, { children: [
          teamProfile.displayName && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: teamProfile.displayName }),
          !teamProfile.displayName && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "text-muted-foreground italic", children: t("No display name set") })
        ] })
      ] }, id)) })
    ] }) })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamMemberListSection
});
//# sourceMappingURL=team-member-list-section.js.map