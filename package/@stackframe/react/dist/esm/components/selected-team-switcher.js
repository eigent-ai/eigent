"use client";
"use client";

// src/components/selected-team-switcher.tsx
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Typography
} from "@stackframe/stack-ui";
import { PlusCircle, Settings } from "lucide-react";
import { Suspense, useEffect, useMemo } from "react";
import { useStackApp, useUser } from "..";
import { useTranslation } from "../lib/translations";
import { TeamIcon } from "./team-icon";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function SelectedTeamSwitcher(props) {
  return /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(Fallback, {}), children: /* @__PURE__ */ jsx(Inner, { ...props }) });
}
function Fallback() {
  return /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full max-w-64 stack-scope" });
}
function Inner(props) {
  const { t } = useTranslation();
  const app = useStackApp();
  const user = useUser();
  const project = app.useProject();
  const navigate = app.useNavigate();
  const selectedTeam = user?.selectedTeam || props.selectedTeam;
  const rawTeams = user?.useTeams();
  const teams = useMemo(() => rawTeams?.sort((a, b) => b.id === selectedTeam?.id ? 1 : -1), [rawTeams, selectedTeam]);
  useEffect(() => {
    if (!props.noUpdateSelectedTeam && props.selectedTeam) {
      runAsynchronouslyWithAlert(user?.setSelectedTeam(props.selectedTeam));
    }
  }, [props.noUpdateSelectedTeam, props.selectedTeam]);
  return /* @__PURE__ */ jsxs(
    Select,
    {
      value: selectedTeam?.id,
      onValueChange: (value) => {
        runAsynchronouslyWithAlert(async () => {
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
        /* @__PURE__ */ jsx(SelectTrigger, { className: "stack-scope max-w-64", children: /* @__PURE__ */ jsx(SelectValue, { placeholder: "Select team" }) }),
        /* @__PURE__ */ jsxs(SelectContent, { className: "stack-scope", children: [
          user?.selectedTeam ? /* @__PURE__ */ jsxs(SelectGroup, { children: [
            /* @__PURE__ */ jsx(SelectLabel, { children: /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between", children: [
              /* @__PURE__ */ jsx("span", { children: t("Current team") }),
              /* @__PURE__ */ jsx(Button, { variant: "ghost", size: "icon", className: "h-6 w-6", onClick: () => navigate(`${app.urls.accountSettings}#team-${user.selectedTeam?.id}`), children: /* @__PURE__ */ jsx(Settings, { className: "h-4 w-4" }) })
            ] }) }),
            /* @__PURE__ */ jsx(SelectItem, { value: user.selectedTeam.id, children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx(TeamIcon, { team: user.selectedTeam }),
              /* @__PURE__ */ jsx(Typography, { className: "max-w-40 truncate", children: user.selectedTeam.displayName })
            ] }) })
          ] }) : void 0,
          teams?.length ? /* @__PURE__ */ jsxs(SelectGroup, { children: [
            /* @__PURE__ */ jsx(SelectLabel, { children: t("Other teams") }),
            teams.filter((team) => team.id !== user?.selectedTeam?.id).map((team) => /* @__PURE__ */ jsx(SelectItem, { value: team.id, children: /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
              /* @__PURE__ */ jsx(TeamIcon, { team }),
              /* @__PURE__ */ jsx(Typography, { className: "max-w-64 truncate", children: team.displayName })
            ] }) }, team.id))
          ] }) : /* @__PURE__ */ jsx(SelectGroup, { children: /* @__PURE__ */ jsx(SelectLabel, { children: t("No teams yet") }) }),
          project.config.clientTeamCreationEnabled && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(SelectSeparator, {}),
            /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs(
              Button,
              {
                onClick: () => navigate(`${app.urls.accountSettings}#team-creation`),
                className: "w-full",
                variant: "ghost",
                children: [
                  /* @__PURE__ */ jsx(PlusCircle, { className: "mr-2 h-4 w-4" }),
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
export {
  SelectedTeamSwitcher
};
//# sourceMappingURL=selected-team-switcher.js.map