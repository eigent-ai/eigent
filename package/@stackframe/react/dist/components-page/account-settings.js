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

// src/components-page/account-settings.tsx
var account_settings_exports = {};
__export(account_settings_exports, {
  AccountSettings: () => AccountSettings
});
module.exports = __toCommonJS(account_settings_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var import__ = require("..");
var import_maybe_full_page = require("../components/elements/maybe-full-page");
var import_sidebar_layout = require("../components/elements/sidebar-layout");
var import_team_icon = require("../components/team-icon");
var import_translations = require("../lib/translations");
var import_active_sessions_page = require("./account-settings/active-sessions/active-sessions-page");
var import_api_keys_page = require("./account-settings/api-keys/api-keys-page");
var import_email_and_auth_page = require("./account-settings/email-and-auth/email-and-auth-page");
var import_profile_page = require("./account-settings/profile-page/profile-page");
var import_settings_page = require("./account-settings/settings/settings-page");
var import_team_creation_page = require("./account-settings/teams/team-creation-page");
var import_team_page = require("./account-settings/teams/team-page");
var import_jsx_runtime = require("react/jsx-runtime");
var Icon = ({ name }) => {
  const LucideIcon = import_lucide_react.icons[name];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LucideIcon, { className: "mr-2 h-4 w-4" });
};
function AccountSettings(props) {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import__.useUser)({ or: "redirect" });
  const teams = user.useTeams();
  const stackApp = (0, import__.useStackApp)();
  const project = stackApp.useProject();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "self-stretch flex-grow w-full", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_sidebar_layout.SidebarLayout,
    {
      items: [
        {
          title: t("My Profile"),
          type: "item",
          id: "profile",
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "Contact" }),
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_profile_page.ProfilePage, {})
        },
        {
          title: t("Emails & Auth"),
          type: "item",
          id: "auth",
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "ShieldCheck" }),
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmailsAndAuthPageSkeleton, {}), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_email_and_auth_page.EmailsAndAuthPage, {}) })
        },
        {
          title: t("Active Sessions"),
          type: "item",
          id: "sessions",
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "Monitor" }),
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ActiveSessionsPageSkeleton, {}), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_active_sessions_page.ActiveSessionsPage, {}) })
        },
        ...project.config.allowUserApiKeys ? [{
          title: t("API Keys"),
          type: "item",
          id: "api-keys",
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "Key" }),
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ApiKeysPageSkeleton, {}), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_api_keys_page.ApiKeysPage, {}) })
        }] : [],
        {
          title: t("Settings"),
          type: "item",
          id: "settings",
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "Settings" }),
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_settings_page.SettingsPage, {})
        },
        ...props.extraItems?.map((item) => ({
          title: item.title,
          type: "item",
          id: item.id,
          icon: (() => {
            const iconName = item.iconName;
            if (iconName) {
              return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: iconName });
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
          title: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2 items-center w-full", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_icon.TeamIcon, { team }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-[320px] md:w-[90%] truncate", children: team.displayName })
          ] }),
          type: "item",
          id: `team-${team.id}`,
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TeamPageSkeleton, {}), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_page.TeamPage, { team }) })
        })),
        ...project.config.clientTeamCreationEnabled ? [{
          title: t("Create a team"),
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { name: "CirclePlus" }),
          type: "item",
          id: "team-creation",
          content: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TeamCreationSkeleton, {}), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_team_creation_page.TeamCreationPage, {}) })
        }] : []
      ].filter((p) => p.type === "divider" || p.content),
      title: t("Account Settings")
    }
  ) }) });
}
function PageLayout(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex flex-col gap-6", children: props.children });
}
function EmailsAndAuthPageSkeleton() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" })
  ] });
}
function ActiveSessionsPageSkeleton() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-6 w-48 mb-2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-4 w-full mb-4" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-[200px] w-full mt-1 rounded-md" })
  ] });
}
function ApiKeysPageSkeleton() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-[200px] w-full mt-1 rounded-md" })
  ] });
}
function TeamPageSkeleton() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-[200px] w-full mt-1 rounded-md" })
  ] });
}
function TeamCreationSkeleton() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PageLayout, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AccountSettings
});
//# sourceMappingURL=account-settings.js.map