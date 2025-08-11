"use client";
"use client";

// src/components-page/team-invitation.tsx
import { KnownErrors } from "@stackframe/stack-shared";
import { cacheFunction } from "@stackframe/stack-shared/dist/utils/caches";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Typography } from "@stackframe/stack-ui";
import React from "react";
import { MessageCard, useStackApp, useUser } from "..";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
var cachedVerifyInvitation = cacheFunction(async (stackApp, code) => {
  return await stackApp.verifyTeamInvitationCode(code);
});
var cachedGetInvitationDetails = cacheFunction(async (stackApp, code) => {
  return await stackApp.getTeamInvitationDetails(code);
});
function TeamInvitationInner(props) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const [success, setSuccess] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState(null);
  const details = React.use(cachedGetInvitationDetails(stackApp, props.searchParams.code || ""));
  if (errorMessage || details.status === "error") {
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "unknownError", fullPage: props.fullPage });
  }
  if (success) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Team invitation"),
        fullPage: props.fullPage,
        primaryButtonText: "Go home",
        primaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ jsxs(Typography, { children: [
          "You have successfully joined ",
          details.data.teamDisplayName
        ] })
      }
    );
  }
  return /* @__PURE__ */ jsx(
    MessageCard,
    {
      title: t("Team invitation"),
      fullPage: props.fullPage,
      primaryButtonText: t("Join"),
      primaryAction: () => runAsynchronouslyWithAlert(async () => {
        const result = await stackApp.acceptTeamInvitation(props.searchParams.code || "");
        if (result.status === "error") {
          setErrorMessage(result.error.message);
        } else {
          setSuccess(true);
        }
      }),
      secondaryButtonText: t("Ignore"),
      secondaryAction: () => stackApp.redirectToHome(),
      children: /* @__PURE__ */ jsxs(Typography, { children: [
        "You are invited to join ",
        details.data.teamDisplayName
      ] })
    }
  );
}
function TeamInvitation({ fullPage = false, searchParams }) {
  const { t } = useTranslation();
  const user = useUser();
  const stackApp = useStackApp();
  const invalidJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Invalid Team Invitation Link"), fullPage, children: /* @__PURE__ */ jsx(Typography, { children: t("Please double check if you have the correct team invitation link.") }) });
  const expiredJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Expired Team Invitation Link"), fullPage, children: /* @__PURE__ */ jsx(Typography, { children: t("Your team invitation link has expired. Please request a new team invitation link ") }) });
  const usedJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Used Team Invitation Link"), fullPage, children: /* @__PURE__ */ jsx(Typography, { children: t("This team invitation link has already been used.") }) });
  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }
  if (!user) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Team invitation"),
        fullPage,
        primaryButtonText: t("Sign in"),
        primaryAction: () => stackApp.redirectToSignIn(),
        secondaryButtonText: t("Cancel"),
        secondaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ jsx(Typography, { children: t("Sign in or create an account to join the team.") })
      }
    );
  }
  const verificationResult = React.use(cachedVerifyInvitation(stackApp, searchParams.code || ""));
  if (verificationResult.status === "error") {
    const error = verificationResult.error;
    if (KnownErrors.VerificationCodeNotFound.isInstance(error)) {
      return invalidJsx;
    } else if (KnownErrors.VerificationCodeExpired.isInstance(error)) {
      return expiredJsx;
    } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(error)) {
      return usedJsx;
    } else {
      throw error;
    }
  }
  return /* @__PURE__ */ jsx(TeamInvitationInner, { fullPage, searchParams });
}
export {
  TeamInvitation
};
//# sourceMappingURL=team-invitation.js.map