"use client";
"use strict";
"use client";
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

// src/components-page/team-creation.tsx
var team_creation_exports = {};
__export(team_creation_exports, {
  TeamCreation: () => TeamCreation
});
module.exports = __toCommonJS(team_creation_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import__ = require("..");
var import_form_warning = require("../components/elements/form-warning");
var import_maybe_full_page = require("../components/elements/maybe-full-page");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamCreation(props) {
  const { t } = (0, import_translations.useTranslation)();
  const schema = (0, import_schema_fields.yupObject)({
    displayName: (0, import_schema_fields.yupString)().defined().nonEmpty(t("Please enter a team name"))
  });
  const { register, handleSubmit, formState: { errors } } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(schema)
  });
  const app = (0, import__.useStackApp)();
  const project = app.useProject();
  const user = (0, import__.useUser)({ or: "redirect" });
  const [loading, setLoading] = (0, import_react.useState)(false);
  const navigate = app.useNavigate();
  if (!project.config.clientTeamCreationEnabled) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import__.MessageCard, { title: t("Team creation is not enabled") });
  }
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const team = await user.createTeam({ displayName: data.displayName });
      navigate(`${app.urls.handler}/team-settings/${team.id}`);
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "stack-scope flex flex-col items-stretch", style: { maxWidth: "380px", flexBasis: "380px", padding: props.fullPage ? "1rem" : 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "text-center mb-6", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h2", children: t("Create a Team") }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "form",
      {
        className: "flex flex-col items-stretch stack-scope",
        onSubmit: (e) => (0, import_promises.runAsynchronously)(handleSubmit(onSubmit)(e)),
        noValidate: true,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Label, { htmlFor: "display-name", className: "mb-1", children: t("Display name") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            import_stack_ui.Input,
            {
              id: "display-name",
              ...register("displayName")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.displayName?.message?.toString() }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", className: "mt-6", loading, children: t("Create") })
        ]
      }
    )
  ] }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamCreation
});
//# sourceMappingURL=team-creation.js.map