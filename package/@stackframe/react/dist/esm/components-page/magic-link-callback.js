"use client";
"use client";

// src/components-page/magic-link-callback.tsx
import { KnownErrors } from "@stackframe/stack-shared";
import { cacheFunction } from "@stackframe/stack-shared/dist/utils/caches";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import React from "react";
import { useStackApp, useUser } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";
import { jsx } from "react/jsx-runtime";
var cacheSignInWithMagicLink = cacheFunction(async (stackApp, code) => {
  return await stackApp.signInWithMagicLink(code);
});
function MagicLinkCallback(props) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const user = useUser();
  const [result, setResult] = React.useState(null);
  if (user) {
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "signedIn", fullPage: !!props.fullPage });
  }
  const invalidJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Invalid Magic Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("p", { children: t("Please check if you have the correct link. If you continue to have issues, please contact support.") }) });
  const expiredJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Expired Magic Link"), fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("p", { children: t("Your magic link has expired. Please request a new magic link if you need to sign-in.") }) });
  const alreadyUsedJsx = /* @__PURE__ */ jsx(MessageCard, { title: t("Magic Link Already Used"), fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("p", { children: t("The magic link has already been used. The link can only be used once. Please request a new magic link if you need to sign-in again.") }) });
  if (!props.searchParams?.code) {
    return invalidJsx;
  }
  if (!result) {
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Do you want to sign in?"),
        fullPage: !!props.fullPage,
        primaryButtonText: t("Sign in"),
        primaryAction: async () => {
          const result2 = await stackApp.signInWithMagicLink(props.searchParams?.code || throwErr("No magic link provided"));
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
        return alreadyUsedJsx;
      } else {
        throw result.error;
      }
    }
    return /* @__PURE__ */ jsx(
      MessageCard,
      {
        title: t("Signed in successfully!"),
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
  MagicLinkCallback
};
//# sourceMappingURL=magic-link-callback.js.map