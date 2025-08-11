"use client";
"use client";

// src/components-page/email-verification.tsx
import { KnownErrors } from "@stackframe/stack-shared";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import React from "react";
import { useStackApp, useUser } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";
import { jsx } from "react/jsx-runtime";
function EmailVerification(props) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const user = useUser();
  const [result, setResult] = React.useState(null);
  const invalidJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Invalid Verification Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("p", { children: t("Please check if you have the correct link. If you continue to have issues, please contact support.") }) });
  const expiredJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Expired Verification Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("p", { children: t("Your email verification link has expired. Please request a new verification link from your account settings.") }) });
  if (!props.searchParams?.code) {
    return invalidJsx;
  }
  if (!result) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Do you want to verify your email?"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Verify"),
        primaryAction: async () => {
          const result2 = await stackApp.verifyEmail(props.searchParams?.code || throwErr("No verification code provided"));
          setResult(result2);
        },
        secondaryButtonText: t("Cancel"),
        secondaryAction: async () => {
          await stackApp.redirectToHome();
        }
      }
    );
  } else {
    if (result.status === "error") {
      if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
        return invalidJsx;
      } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
        return expiredJsx;
      } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      } else {
        throw result.error;
      }
    }
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("You email has been verified!"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Go home"),
        primaryAction: async () => {
          await stackApp.redirectToHome();
        }
      }
    );
  }
}
export {
  EmailVerification
};
//# sourceMappingURL=email-verification.js.map