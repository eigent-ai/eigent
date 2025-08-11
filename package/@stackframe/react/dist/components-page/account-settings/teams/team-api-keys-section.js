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

// src/components-page/account-settings/teams/team-api-keys-section.tsx
var team_api_keys_section_exports = {};
__export(team_api_keys_section_exports, {
  TeamApiKeysSection: () => TeamApiKeysSection
});
module.exports = __toCommonJS(team_api_keys_section_exports);
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_api_key_dialogs = require("../../../components/api-key-dialogs");
var import_api_key_table = require("../../../components/api-key-table");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamApiKeysSection(props) {
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const team = user.useTeam(props.team.id);
  const stackApp = (0, import_hooks.useStackApp)();
  const project = stackApp.useProject();
  if (!team) {
    throw new import_errors.StackAssertionError("Team not found");
  }
  const teamApiKeysEnabled = project.config.allowTeamApiKeys;
  const manageApiKeysPermission = user.usePermission(props.team, "$manage_api_keys");
  if (!manageApiKeysPermission || !teamApiKeysEnabled) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TeamApiKeysSectionInner, { team: props.team });
}
function TeamApiKeysSectionInner(props) {
  const { t } = (0, import_translations.useTranslation)();
  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = (0, import_react.useState)(false);
  const [returnedApiKey, setReturnedApiKey] = (0, import_react.useState)(null);
  const apiKeys = props.team.useApiKeys();
  const CreateDialog = import_api_key_dialogs.CreateApiKeyDialog;
  const ShowDialog = import_api_key_dialogs.ShowApiKeyDialog;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_section.Section,
      {
        title: t("API Keys"),
        description: t("API keys grant programmatic access to your team."),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { onClick: () => setIsNewApiKeyDialogOpen(true), children: t("Create API Key") })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api_key_table.ApiKeyTable, { apiKeys }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      CreateDialog,
      {
        open: isNewApiKeyDialogOpen,
        onOpenChange: setIsNewApiKeyDialogOpen,
        onKeyCreated: setReturnedApiKey,
        createApiKey: async (data) => {
          const apiKey = await props.team.createApiKey(data);
          return apiKey;
        }
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      ShowDialog,
      {
        apiKey: returnedApiKey,
        onClose: () => setReturnedApiKey(null)
      }
    )
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamApiKeysSection
});
//# sourceMappingURL=team-api-keys-section.js.map