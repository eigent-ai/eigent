"use client";
"use client";

// src/components/message-cards/known-error-message-card.tsx
import { Typography } from "@stackframe/stack-ui";
import { useStackApp } from "../..";
import { MessageCard } from "./message-card";
import { jsxs } from "react/jsx-runtime";
function KnownErrorMessageCard({
  error,
  fullPage = false
}) {
  const stackApp = useStackApp();
  return /* @__PURE__ */ jsxs(
    MessageCard,
    {
      title: "An error occurred",
      fullPage,
      primaryButtonText: "Go Home",
      primaryAction: () => stackApp.redirectToHome(),
      children: [
        /* @__PURE__ */ jsxs(Typography, { children: [
          "Error Code: ",
          error.errorCode
        ] }),
        /* @__PURE__ */ jsxs(Typography, { children: [
          "Error Message: ",
          error.message
        ] })
      ]
    }
  );
}
export {
  KnownErrorMessageCard
};
//# sourceMappingURL=known-error-message-card.js.map