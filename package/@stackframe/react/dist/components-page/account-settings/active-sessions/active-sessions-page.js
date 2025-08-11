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

// src/components-page/account-settings/active-sessions/active-sessions-page.tsx
var active_sessions_page_exports = {};
__export(active_sessions_page_exports, {
  ActiveSessionsPage: () => ActiveSessionsPage
});
module.exports = __toCommonJS(active_sessions_page_exports);
var import_dates = require("@stackframe/stack-shared/dist/utils/dates");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_page_layout = require("../page-layout");
var import_jsx_runtime = require("react/jsx-runtime");
function ActiveSessionsPage() {
  const { t } = (0, import_translations.useTranslation)();
  const user = (0, import_hooks.useUser)({ or: "throw" });
  const [isLoading, setIsLoading] = (0, import_react.useState)(true);
  const [isRevokingAll, setIsRevokingAll] = (0, import_react.useState)(false);
  const [sessions, setSessions] = (0, import_react.useState)([]);
  const [showConfirmRevokeAll, setShowConfirmRevokeAll] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => {
    (0, import_promises.runAsynchronously)(async () => {
      setIsLoading(true);
      const sessionsData = await user.getActiveSessions();
      const enhancedSessions = sessionsData;
      setSessions(enhancedSessions);
      setIsLoading(false);
    });
  }, [user]);
  const handleRevokeSession = async (sessionId) => {
    try {
      await user.revokeSession(sessionId);
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));
    } catch (error) {
      (0, import_errors.captureError)("Failed to revoke session", { sessionId, error });
      throw error;
    }
  };
  const handleRevokeAllSessions = async () => {
    setIsRevokingAll(true);
    try {
      const deletionPromises = sessions.filter((session) => !session.isCurrentSession).map((session) => user.revokeSession(session.id));
      await Promise.all(deletionPromises);
      setSessions((prevSessions) => prevSessions.filter((session) => session.isCurrentSession));
    } catch (error) {
      (0, import_errors.captureError)("Failed to revoke all sessions", { error, sessionIds: sessions.map((session) => session.id) });
      throw error;
    } finally {
      setIsRevokingAll(false);
      setShowConfirmRevokeAll(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_page_layout.PageLayout, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex justify-between items-center mb-2", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "font-medium", children: t("Active Sessions") }),
      sessions.filter((s) => !s.isCurrentSession).length > 0 && !isLoading && (showConfirmRevokeAll ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "destructive",
            size: "sm",
            loading: isRevokingAll,
            onClick: handleRevokeAllSessions,
            children: t("Confirm")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.Button,
          {
            variant: "secondary",
            size: "sm",
            disabled: isRevokingAll,
            onClick: () => setShowConfirmRevokeAll(false),
            children: t("Cancel")
          }
        )
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_stack_ui.Button,
        {
          variant: "outline",
          size: "sm",
          onClick: () => setShowConfirmRevokeAll(true),
          children: t("Revoke All Other Sessions")
        }
      ))
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "footnote", className: "mb-4", children: t("These are devices where you're currently logged in. You can revoke access to end a session.") }),
    isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-[300px] w-full rounded-md" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "border rounded-md", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Table, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHeader, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[200px]", children: t("Session") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[150px]", children: t("IP Address") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[150px]", children: t("Location") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[150px]", children: t("Last used") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[80px]" })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableBody, { children: sessions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableRow, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { colSpan: 5, className: "text-center py-6", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", children: t("No active sessions found") }) }) }) : sessions.map((session) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: session.isCurrentSession ? t("Current Session") : t("Other Session") }),
          session.isImpersonation && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Badge, { variant: "secondary", className: "w-fit mt-1", children: t("Impersonation") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "footnote", children: t("Signed in {time}", { time: new Date(session.createdAt).toLocaleDateString() }) })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: session.geoInfo?.ip || t("-") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: session.geoInfo?.cityName || t("Unknown") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: session.lastUsedAt ? (0, import_dates.fromNow)(new Date(session.lastUsedAt)) : t("Never") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", type: "footnote", title: session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString() : "", children: session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleDateString() : "" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { align: "right", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_stack_ui.ActionCell,
          {
            items: [
              {
                item: t("Revoke"),
                onClick: () => handleRevokeSession(session.id),
                danger: true,
                disabled: session.isCurrentSession,
                disabledTooltip: session.isCurrentSession ? t("You cannot revoke your current session") : void 0
              }
            ]
          }
        ) })
      ] }, session.id)) })
    ] }) })
  ] }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ActiveSessionsPage
});
//# sourceMappingURL=active-sessions-page.js.map