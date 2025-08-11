"use client";
"use client";

// src/components-page/oauth-callback.tsx
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Spinner, cn } from "@stackframe/stack-ui";
import { useEffect, useRef, useState } from "react";
import { useStackApp } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function OAuthCallback({ fullPage }) {
  const { t } = useTranslation();
  const app = useStackApp();
  const called = useRef(false);
  const [error, setError] = useState(null);
  const [showRedirectLink, setShowRedirectLink] = useState(false);
  useEffect(() => runAsynchronously(async () => {
    if (called.current) return;
    called.current = true;
    let hasRedirected = false;
    try {
      hasRedirected = await app.callOAuthCallback();
    } catch (e) {
      captureError("<OAuthCallback />", e);
      setError(e);
    }
    if (!hasRedirected && (!error || process.env.NODE_ENV === "production")) {
      await app.redirectToSignIn({ noRedirectBack: true });
    }
  }), []);
  useEffect(() => {
    setTimeout(() => setShowRedirectLink(true), 3e3);
  }, []);
  return /* @__PURE__ */ jsx(
    MaybeFullPage,
    {
      fullPage: fullPage ?? false,
      containerClassName: "flex items-center justify-center",
      children: /* @__PURE__ */ jsxs(
        "div",
        {
          className: cn(
            "text-center justify-center items-center stack-scope flex flex-col gap-4 max-w-[380px]",
            fullPage ? "p-4" : "p-0"
          ),
          children: [
            /* @__PURE__ */ jsx("div", { className: "flex flex-col justify-center items-center gap-4", children: /* @__PURE__ */ jsx(Spinner, { size: 20 }) }),
            showRedirectLink ? /* @__PURE__ */ jsxs("p", { children: [
              t("If you are not redirected automatically, "),
              /* @__PURE__ */ jsx(StyledLink, { className: "whitespace-nowrap", href: app.urls.home, children: t("click here") })
            ] }) : null,
            error ? /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("p", { children: t("Something went wrong while processing the OAuth callback:") }),
              /* @__PURE__ */ jsx("pre", { children: JSON.stringify(error, null, 2) }),
              /* @__PURE__ */ jsx("p", { children: t("This is most likely an error in Stack. Please report it.") })
            ] }) : null
          ]
        }
      )
    }
  );
}
export {
  OAuthCallback
};
//# sourceMappingURL=oauth-callback.js.map