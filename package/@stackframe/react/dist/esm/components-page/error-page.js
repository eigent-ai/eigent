"use client";
"use client";

// src/components-page/error-page.tsx
import { KnownError, KnownErrors } from "@stackframe/stack-shared";
import { Typography } from "@stackframe/stack-ui";
import { useStackApp } from "..";
import { KnownErrorMessageCard } from "../components/message-cards/known-error-message-card";
import { MessageCard } from "../components/message-cards/message-card";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";
import { jsx } from "react/jsx-runtime";
function ErrorPage(props) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const errorCode = props.searchParams.errorCode;
  const message = props.searchParams.message;
  const details = props.searchParams.details;
  const unknownErrorCard = /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "unknownError", fullPage: !!props.fullPage });
  if (!errorCode || !message) {
    return unknownErrorCard;
  }
  let error;
  try {
    const detailJson = details ? JSON.parse(details) : {};
    error = KnownError.fromJson({ code: errorCode, message, details: detailJson });
  } catch (e) {
    return unknownErrorCard;
  }
  if (KnownErrors.OAuthConnectionAlreadyConnectedToAnotherUser.isInstance(error)) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Failed to connect account"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Go Home"),
        primaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ jsx(Typography, { children: t("This account is already connected to another user. Please connect a different account.") })
      }
    );
  }
  if (KnownErrors.UserAlreadyConnectedToAnotherOAuthConnection.isInstance(error)) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Failed to connect account"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Go Home"),
        primaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ jsx(Typography, { children: t("The user is already connected to another OAuth account. Did you maybe selected the wrong account on the OAuth provider page?") })
      }
    );
  }
  if (KnownErrors.OAuthProviderAccessDenied.isInstance(error)) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("OAuth provider access denied"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Sign in again"),
        primaryAction: () => stackApp.redirectToSignIn(),
        secondaryButtonText: t("Go Home"),
        secondaryAction: () => stackApp.redirectToHome(),
        children: /* @__PURE__ */ jsx(Typography, { children: t("The sign-in operation has been cancelled. Please try again. [access_denied]") })
      }
    );
  }
  return /* @__PURE__ */ jsx(KnownErrorMessageCard, { error, fullPage: !!props.fullPage });
}
export {
  ErrorPage
};
//# sourceMappingURL=error-page.js.map