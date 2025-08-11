"use client";
"use client";

// src/components-page/cli-auth-confirm.tsx
import { Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { stackAppInternalsSymbol, useStackApp } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function CliAuthConfirmation({ fullPage = true }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const [authorizing, setAuthorizing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const user = app.useUser({ or: "redirect" });
  const handleAuthorize = async () => {
    if (authorizing) return;
    setAuthorizing(true);
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const loginCode = urlParams.get("login_code");
      if (!loginCode) {
        throw new Error("Missing login code in URL parameters");
      }
      const refreshToken = (await user.currentSession.getTokens()).refreshToken;
      if (!refreshToken) {
        throw new Error("You must be logged in to authorize CLI access");
      }
      const result = await app[stackAppInternalsSymbol].sendRequest("/auth/cli/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: (await user.currentSession.getTokens()).refreshToken
        })
      });
      if (!result.ok) {
        throw new Error(`Authorization failed: ${result.status} ${await result.text()}`);
      }
      setSuccess(true);
    } catch (err) {
      setError(err);
    } finally {
      setAuthorizing(false);
    }
  };
  if (success) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("CLI Authorization Successful"),
        fullPage,
        primaryButtonText: t("Close"),
        primaryAction: () => window.close(),
        children: /* @__PURE__ */ jsx(Typography, { children: t("The CLI application has been authorized successfully. You can now close this window and return to the command line.") })
      }
    );
  }
  if (error) {
    return /* @__PURE__ */ jsxs(
      MessageCard,
      {
        title: t("Authorization Failed"),
        fullPage,
        primaryButtonText: t("Try Again"),
        primaryAction: () => setError(null),
        secondaryButtonText: t("Cancel"),
        secondaryAction: () => window.close(),
        children: [
          /* @__PURE__ */ jsx(Typography, { className: "text-red-600", children: t("Failed to authorize the CLI application:") }),
          /* @__PURE__ */ jsx(Typography, { className: "text-red-600", children: error.message })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    MessageCard,
    {
      title: t("Authorize CLI Application"),
      fullPage,
      primaryButtonText: authorizing ? t("Authorizing...") : t("Authorize"),
      primaryAction: handleAuthorize,
      secondaryButtonText: t("Cancel"),
      secondaryAction: () => window.close(),
      children: [
        /* @__PURE__ */ jsx(Typography, { children: t("A command line application is requesting access to your account. Click the button below to authorize it.") }),
        /* @__PURE__ */ jsx(Typography, { variant: "destructive", children: t("WARNING: Make sure you trust the command line application, as it will gain access to your account. If you did not initiate this request, you can close this page and ignore it. We will never send you this link via email or any other means.") })
      ]
    }
  );
}
export {
  CliAuthConfirmation
};
//# sourceMappingURL=cli-auth-confirm.js.map