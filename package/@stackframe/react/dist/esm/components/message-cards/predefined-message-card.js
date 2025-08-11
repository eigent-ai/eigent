"use client";
"use client";

// src/components/message-cards/predefined-message-card.tsx
import { Typography } from "@stackframe/stack-ui";
import { useStackApp } from "../..";
import { useTranslation } from "../../lib/translations";
import { MessageCard } from "./message-card";
import { jsx } from "react/jsx-runtime";
function PredefinedMessageCard({
  type,
  fullPage = false
}) {
  const stackApp = useStackApp();
  const { t } = useTranslation();
  let title;
  let message = null;
  let primaryButton = null;
  let secondaryButton = null;
  let primaryAction = null;
  let secondaryAction = null;
  switch (type) {
    case "signedIn": {
      title = t("You are already signed in");
      primaryAction = () => stackApp.redirectToHome();
      secondaryAction = () => stackApp.redirectToSignOut();
      primaryButton = t("Go home");
      secondaryButton = t("Sign out");
      break;
    }
    case "signedOut": {
      title = t("You are not currently signed in.");
      primaryAction = () => stackApp.redirectToSignIn();
      primaryButton = t("Sign in");
      break;
    }
    case "signUpDisabled": {
      title = t("Sign up for new users is not enabled at the moment.");
      primaryAction = () => stackApp.redirectToHome();
      secondaryAction = () => stackApp.redirectToSignIn();
      primaryButton = t("Go home");
      secondaryButton = t("Sign in");
      break;
    }
    case "emailSent": {
      title = t("Email sent!");
      message = t("If the user with this e-mail address exists, an e-mail was sent to your inbox. Make sure to check your spam folder.");
      primaryAction = () => stackApp.redirectToHome();
      primaryButton = t("Go home");
      break;
    }
    case "passwordReset": {
      title = t("Password reset successfully!");
      message = t("Your password has been reset. You can now sign in with your new password.");
      primaryAction = () => stackApp.redirectToSignIn({ noRedirectBack: true });
      primaryButton = t("Sign in");
      break;
    }
    case "unknownError": {
      title = t("An unknown error occurred");
      message = t("Please try again and if the problem persists, contact support.");
      primaryAction = () => stackApp.redirectToHome();
      primaryButton = t("Go home");
      break;
    }
  }
  return /* @__PURE__ */ jsx(
    MessageCard,
    {
      title,
      fullPage,
      primaryButtonText: primaryButton,
      primaryAction,
      secondaryButtonText: secondaryButton || void 0,
      secondaryAction: secondaryAction || void 0,
      children: message && /* @__PURE__ */ jsx(Typography, { children: message })
    }
  );
}
export {
  PredefinedMessageCard
};
//# sourceMappingURL=predefined-message-card.js.map