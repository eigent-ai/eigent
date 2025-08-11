// src/components-page/account-settings/active-sessions/active-sessions-page.tsx
import { fromNow } from "@stackframe/stack-shared/dist/utils/dates";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, Badge, Button, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";
import { jsx, jsxs } from "react/jsx-runtime";
function ActiveSessionsPage() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });
  const [isLoading, setIsLoading] = useState(true);
  const [isRevokingAll, setIsRevokingAll] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [showConfirmRevokeAll, setShowConfirmRevokeAll] = useState(false);
  useEffect(() => {
    runAsynchronously(async () => {
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
      captureError("Failed to revoke session", { sessionId, error });
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
      captureError("Failed to revoke all sessions", { error, sessionIds: sessions.map((session) => session.id) });
      throw error;
    } finally {
      setIsRevokingAll(false);
      setShowConfirmRevokeAll(false);
    }
  };
  return /* @__PURE__ */ jsx(PageLayout, { children: /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs("div", { className: "flex justify-between items-center mb-2", children: [
      /* @__PURE__ */ jsx(Typography, { className: "font-medium", children: t("Active Sessions") }),
      sessions.filter((s) => !s.isCurrentSession).length > 0 && !isLoading && (showConfirmRevokeAll ? /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsx(
          Button,
          {
            variant: "destructive",
            size: "sm",
            loading: isRevokingAll,
            onClick: handleRevokeAllSessions,
            children: t("Confirm")
          }
        ),
        /* @__PURE__ */ jsx(
          Button,
          {
            variant: "secondary",
            size: "sm",
            disabled: isRevokingAll,
            onClick: () => setShowConfirmRevokeAll(false),
            children: t("Cancel")
          }
        )
      ] }) : /* @__PURE__ */ jsx(
        Button,
        {
          variant: "outline",
          size: "sm",
          onClick: () => setShowConfirmRevokeAll(true),
          children: t("Revoke All Other Sessions")
        }
      ))
    ] }),
    /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "footnote", className: "mb-4", children: t("These are devices where you're currently logged in. You can revoke access to end a session.") }),
    isLoading ? /* @__PURE__ */ jsx(Skeleton, { className: "h-[300px] w-full rounded-md" }) : /* @__PURE__ */ jsx("div", { className: "border rounded-md", children: /* @__PURE__ */ jsxs(Table, { children: [
      /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { children: [
        /* @__PURE__ */ jsx(TableHead, { className: "w-[200px]", children: t("Session") }),
        /* @__PURE__ */ jsx(TableHead, { className: "w-[150px]", children: t("IP Address") }),
        /* @__PURE__ */ jsx(TableHead, { className: "w-[150px]", children: t("Location") }),
        /* @__PURE__ */ jsx(TableHead, { className: "w-[150px]", children: t("Last used") }),
        /* @__PURE__ */ jsx(TableHead, { className: "w-[80px]" })
      ] }) }),
      /* @__PURE__ */ jsx(TableBody, { children: sessions.length === 0 ? /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: 5, className: "text-center py-6", children: /* @__PURE__ */ jsx(Typography, { variant: "secondary", children: t("No active sessions found") }) }) }) : sessions.map((session) => /* @__PURE__ */ jsxs(TableRow, { children: [
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col", children: [
          /* @__PURE__ */ jsx(Typography, { children: session.isCurrentSession ? t("Current Session") : t("Other Session") }),
          session.isImpersonation && /* @__PURE__ */ jsx(Badge, { variant: "secondary", className: "w-fit mt-1", children: t("Impersonation") }),
          /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "footnote", children: t("Signed in {time}", { time: new Date(session.createdAt).toLocaleDateString() }) })
        ] }) }),
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsx(Typography, { children: session.geoInfo?.ip || t("-") }) }),
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsx(Typography, { children: session.geoInfo?.cityName || t("Unknown") }) }),
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col", children: [
          /* @__PURE__ */ jsx(Typography, { children: session.lastUsedAt ? fromNow(new Date(session.lastUsedAt)) : t("Never") }),
          /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "footnote", title: session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString() : "", children: session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleDateString() : "" })
        ] }) }),
        /* @__PURE__ */ jsx(TableCell, { align: "right", children: /* @__PURE__ */ jsx(
          ActionCell,
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
export {
  ActiveSessionsPage
};
//# sourceMappingURL=active-sessions-page.js.map