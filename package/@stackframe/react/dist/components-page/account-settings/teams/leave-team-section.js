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

// src/components-page/account-settings/teams/leave-team-section.tsx
var leave_team_section_exports = {};
__export(leave_team_section_exports, {
  LeaveTeamSection: () => LeaveTeamSection
});
module.exports = __toCommonJS(leave_team_section_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function LeaveTeamSection(props) {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const [leaving, setLeaving] = (0, import_react.useState)(false);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_section.Section,
    {
      title: t("Leave Team"),
      description: t("leave this team and remove your team profile"),
      children: !leaving ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "secondary",
          onClick: () => setLeaving(true),
          children: t("Leave team")
        }
      ) }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", children: t("Are you sure you want to leave the team?") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Button,
            {
              variant: "destructive",
              onClick: async () => {
                await user.leaveTeam(props.team);
                window.location.reload();
              },
              children: t("Leave")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Button,
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LeaveTeamSection
});
//# sourceMappingURL=leave-team-section.js.map