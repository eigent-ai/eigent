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

// src/components-page/account-settings/teams/team-display-name-section.tsx
var team_display_name_section_exports = {};
__export(team_display_name_section_exports, {
  TeamDisplayNameSection: () => TeamDisplayNameSection
});
module.exports = __toCommonJS(team_display_name_section_exports);
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_editable_text = require("../editable-text");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamDisplayNameSection(props) {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const updateTeamPermission = user.usePermission(props.team, "$update_team");
  if (!updateTeamPermission) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_section.Section,
    {
      title: t("Team display name"),
      description: t("Change the display name of your team"),
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_editable_text.EditableText,
        {
          value: props.team.displayName,
          onSave: async (newDisplayName) => await props.team.update({ displayName: newDisplayName })
        }
      )
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamDisplayNameSection
});
//# sourceMappingURL=team-display-name-section.js.map