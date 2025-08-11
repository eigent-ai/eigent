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

// src/components/selected-team-switcher.tsx
var selected_team_switcher_exports = {};
__export(selected_team_switcher_exports, {
  SelectedTeamSwitcher: () => SelectedTeamSwitcher
});
module.exports = __toCommonJS(selected_team_switcher_exports);
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_team_icon = require("./team-icon");
var import_jsx_runtime = require("react/jsx-runtime");
function SelectedTeamSwitcher(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fallback, {}), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Inner, { ...props }) });
}
function Fallback() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full max-w-64 stack-scope" });
}
function Inner(props) {
  const { t } = (0, import_translations.useTranslation)();
  const app = (0, import__.useStackApp)();
  const user = (0, import__.useUser)();
  const project = app.useProject();
  const navigate = app.useNavigate();
  const selectedTeam = user?.selectedTeam || props.selectedTeam;
  const rawTeams = user?.useTeams();
  const teams = (0, import_react.useMemo)(() => rawTeams?.sort((a, b) => b.id === selectedTeam?.id ? 1 : -1), [rawTeams, selectedTeam]);
  (0, import_react.useEffect)(() => {
    if (!props.noUpdateSelectedTeam && props.selectedTeam) {
      (0, import_promises.runAsynchronouslyWithAlert)(user?.setSelectedTeam(props.selectedTeam));
    }
  }, [props.noUpdateSelectedTeam, props.selectedTeam]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_stack_ui.Select,
    {
      value: selectedTeam?.id,
      onValueChange: (value) => {
        (0, import_promises.runAsynchronouslyWithAlert)(async () => {
          const team = teams?.find((team2) => team2.id === value);
          if (!team) {
            throw new Error("Team not found, this should not happen");
          }
          if (!props.noUpdateSelectedTeam) {
            await user?.setSelectedTeam(team);
          }
          if (props.urlMap) {
            navigate(props.urlMap(team));
          }
        });
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectTrigger, { className: "stack-scope max-w-64", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectValue, { placeholder: "Select team" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.SelectContent, { className: "stack-scope", children: [
          user?.selectedTeam ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.SelectGroup, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectLabel, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center justify-between", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("Current team") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => navigate(`${app.urls.accountSettings}#team-${user.selectedTeam?.id}`), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.Settings, { className: "h-4 w-4" }) })
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectItem, { value: user.selectedTeam.id, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_icon.TeamIcon, { team: user.selectedTeam }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-40 truncate", children: user.selectedTeam.displayName })
            ] }) })
          ] }) : void 0,
          teams?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.SelectGroup, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectLabel, { children: t("Other teams") }),
            teams.filter((team) => team.id !== user?.selectedTeam?.id).map((team) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectItem, { value: team.id, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_icon.TeamIcon, { team }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-64 truncate", children: team.displayName })
            ] }) }, team.id))
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectGroup, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectLabel, { children: t("No teams yet") }) }),
          project.config.clientTeamCreationEnabled && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.SelectSeparator, {}),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              import_stack_ui.Button,
              {
                onClick: () => navigate(`${app.urls.accountSettings}#team-creation`),
                className: "w-full",
                variant: "ghost",
                children: [
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.PlusCircle, { className: "mr-2 h-4 w-4" }),
                  " ",
                  t("Create a team")
                ]
              }
            ) })
          ] })
        ] })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SelectedTeamSwitcher
});
//# sourceMappingURL=selected-team-switcher.js.map