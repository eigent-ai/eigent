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

// src/components-page/account-settings/teams/team-creation-page.tsx
var team_creation_page_exports = {};
__export(team_creation_page_exports, {
  TeamCreationPage: () => TeamCreationPage
});
module.exports = __toCommonJS(team_creation_page_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import_form_warning = require("../../../components/elements/form-warning");
var import_message_card = require("../../../components/message-cards/message-card");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_page_layout = require("../page-layout");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamCreationPage() {
  const { t } = (0, import_translations.useTranslation)();
  const teamCreationSchema = (0, import_schema_fields.yupObject)({
    displayName: (0, import_schema_fields.yupString)().defined().nonEmpty(t("Please enter a team name"))
  });
  const { register, handleSubmit, formState: { errors } } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(teamCreationSchema)
  });
  const app = (0, import_hooks.useStackApp)();
  const project = app.useProject();
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const navigate = app.useNavigate();
  const [loading, setLoading] = (0, import_react.useState)(false);
  if (!project.config.clientTeamCreationEnabled) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_message_card.MessageCard, { title: t("Team creation is not enabled") });
  }
  const onSubmit = async (data) => {
    setLoading(true);
    let team;
    try {
      team = await user.createTeam({ displayName: data.displayName });
    } finally {
      setLoading(false);
    }
    navigate(`#team-${team.id}`);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_page_layout.PageLayout, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_section.Section, { title: t("Create a Team"), description: t("Enter a display name for your new team"), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "form",
    {
      onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
      noValidate: true,
      className: "flex gap-2 flex-col sm:flex-row",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col flex-1", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Input,
            {
              id: "displayName",
              type: "text",
              ...register("displayName")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.displayName?.message?.toString() })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", loading, children: t("Create") })
      ]
    }
  ) }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamCreationPage
});
//# sourceMappingURL=team-creation-page.js.map