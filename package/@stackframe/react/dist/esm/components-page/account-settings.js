"use client";
"use client";

// src/components-page/account-settings.tsx
import { Skeleton, Typography } from "@stackframe/stack-ui";
import { icons } from "lucide-react";
import { Suspense } from "react";
import { useStackApp, useUser } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { SidebarLayout } from "../components/elements/sidebar-layout";
import { TeamIcon } from "../components/team-icon";
import { useTranslation } from "../lib/translations";
import { ActiveSessionsPage } from "./account-settings/active-sessions/active-sessions-page";
import { ApiKeysPage } from "./account-settings/api-keys/api-keys-page";
import { EmailsAndAuthPage } from "./account-settings/email-and-auth/email-and-auth-page";
import { ProfilePage } from "./account-settings/profile-page/profile-page";
import { SettingsPage } from "./account-settings/settings/settings-page";
import { TeamCreationPage } from "./account-settings/teams/team-creation-page";
import { TeamPage } from "./account-settings/teams/team-page";
import { jsx, jsxs } from "react/jsx-runtime";
var Icon = ({ name }) => {
  const LucideIcon = icons[name];
  return /* @__PURE__ */ jsx(LucideIcon, { className: "mr-2 h-4 w-4" });
};
function AccountSettings(props) {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const teams = user.useTeams();
  const stackApp = useStackApp();
  const project = stackApp.useProject();
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("div", { className: "self-stretch flex-grow w-full", children: /* @__PURE__ */ jsx(
    SidebarLayout,
    {
      items: [
        {
          title: t("My Profile"),
          type: "item",
          id: "profile",
          icon: /* @__PURE__ */ jsx(Icon, { name: "Contact" }),
          content: /* @__PURE__ */ jsx(ProfilePage, {})
        },
        {
          title: t("Emails & Auth"),
          type: "item",
          id: "auth",
          icon: /* @__PURE__ */ jsx(Icon, { name: "ShieldCheck" }),
          content: /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(EmailsAndAuthPageSkeleton, {}), children: /* @__PURE__ */ jsx(EmailsAndAuthPage, {}) })
        },
        {
          title: t("Active Sessions"),
          type: "item",
          id: "sessions",
          icon: /* @__PURE__ */ jsx(Icon, { name: "Monitor" }),
          content: /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(ActiveSessionsPageSkeleton, {}), children: /* @__PURE__ */ jsx(ActiveSessionsPage, {}) })
        },
        ...project.config.allowUserApiKeys ? [{
          title: t("API Keys"),
          type: "item",
          id: "api-keys",
          icon: /* @__PURE__ */ jsx(Icon, { name: "Key" }),
          content: /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(ApiKeysPageSkeleton, {}), children: /* @__PURE__ */ jsx(ApiKeysPage, {}) })
        }] : [],
        {
          title: t("Settings"),
          type: "item",
          id: "settings",
          icon: /* @__PURE__ */ jsx(Icon, { name: "Settings" }),
          content: /* @__PURE__ */ jsx(SettingsPage, {})
        },
        ...props.extraItems?.map((item) => ({
          title: item.title,
          type: "item",
          id: item.id,
          icon: (() => {
            const iconName = item.iconName;
            if (iconName) {
              return /* @__PURE__ */ jsx(Icon, { name: iconName });
            } else if (item.icon) {
              return item.icon;
            }
            return null;
          })(),
          content: item.content
        })) || [],
        ...teams.length > 0 || project.config.clientTeamCreationEnabled ? [{
          title: t("Teams"),
          type: "divider"
        }] : [],
        ...teams.map((team) => ({
          title: /* @__PURE__ */ jsxs("div", { className: "flex gap-2 items-center w-full", children: [
            /* @__PURE__ */ jsx(TeamIcon, { team }),
            /* @__PURE__ */ jsx(Typography, { className: "max-w-[320px] md:w-[90%] truncate", children: team.displayName })
          ] }),
          type: "item",
          id: `team-${team.id}`,
          content: /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(TeamPageSkeleton, {}), children: /* @__PURE__ */ jsx(TeamPage, { team }) })
        })),
        ...project.config.clientTeamCreationEnabled ? [{
          title: t("Create a team"),
          icon: /* @__PURE__ */ jsx(Icon, { name: "CirclePlus" }),
          type: "item",
          id: "team-creation",
          content: /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(TeamCreationSkeleton, {}), children: /* @__PURE__ */ jsx(TeamCreationPage, {}) })
        }] : []
      ].filter((p) => p.type === "divider" || p.content),
      title: t("Account Settings")
    }
  ) }) });
}
function PageLayout(props) {
  return /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-6", children: props.children });
}
function EmailsAndAuthPageSkeleton() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" })
  ] });
}
function ActiveSessionsPageSkeleton() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(Skeleton, { className: "h-6 w-48 mb-2" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-4 w-full mb-4" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-[200px] w-full mt-1 rounded-md" })
  ] });
}
function ApiKeysPageSkeleton() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-[200px] w-full mt-1 rounded-md" })
  ] });
}
function TeamPageSkeleton() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-[200px] w-full mt-1 rounded-md" })
  ] });
}
function TeamCreationSkeleton() {
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" })
  ] });
}
export {
  AccountSettings
};
//# sourceMappingURL=account-settings.js.map