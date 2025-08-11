"use client";
"use client";

// src/components-page/auth-page.tsx
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Typography, cn } from "@stackframe/stack-ui";
import { Suspense, useEffect } from "react";
import { useStackApp, useUser } from "..";
import { CredentialSignIn } from "../components/credential-sign-in";
import { CredentialSignUp } from "../components/credential-sign-up";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { SeparatorWithText } from "../components/elements/separator-with-text";
import { StyledLink } from "../components/link";
import { MagicLinkSignIn } from "../components/magic-link-sign-in";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { OAuthButtonGroup } from "../components/oauth-button-group";
import { PasskeyButton } from "../components/passkey-button";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function AuthPage(props) {
  return /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(Fallback, { ...props }), children: /* @__PURE__ */ jsx(Inner, { ...props }) });
}
function Fallback(props) {
  const { t } = useTranslation();
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ jsx("div", { className: "stack-scope flex flex-col items-stretch", style: { maxWidth: "380px", flexBasis: "380px", padding: props.fullPage ? "1rem" : 0 }, children: /* @__PURE__ */ jsxs("div", { className: "text-center mb-6 flex flex-col", children: [
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-2/3 self-center" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-3 w-16 mt-8" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-3 w-24 mt-2" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ jsx(Skeleton, { className: "h-9 w-full mt-6" })
  ] }) }) });
}
function Inner(props) {
  const stackApp = useStackApp();
  const user = useUser();
  const projectFromHook = stackApp.useProject();
  const project = props.mockProject || projectFromHook;
  const { t } = useTranslation();
  useEffect(() => {
    if (props.automaticRedirect && user && !props.mockProject) {
      runAsynchronously(
        props.type === "sign-in" ? stackApp.redirectToAfterSignIn({ replace: true }) : stackApp.redirectToAfterSignUp({ replace: true })
      );
    }
  }, [user, props.mockProject, stackApp, props.automaticRedirect]);
  if (user && !props.mockProject && !props.automaticRedirect) {
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "signedIn", fullPage: props.fullPage });
  }
  if (props.type === "sign-up" && !project.config.signUpEnabled) {
    return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "signUpDisabled", fullPage: props.fullPage });
  }
  const hasOAuthProviders = project.config.oauthProviders.length > 0;
  const hasPasskey = project.config.passkeyEnabled === true && props.type === "sign-in";
  const enableSeparator = (project.config.credentialEnabled || project.config.magicLinkEnabled) && (hasOAuthProviders || hasPasskey);
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ jsxs("div", { className: "stack-scope flex flex-col items-stretch", style: { maxWidth: "380px", flexBasis: "380px", padding: props.fullPage ? "1rem" : 0 }, children: [
    /* @__PURE__ */ jsxs("div", { className: "text-center mb-6", children: [
      /* @__PURE__ */ jsx(Typography, { type: "h2", children: props.type === "sign-in" ? t("Sign in to your account") : t("Create a new account") }),
      props.type === "sign-in" ? project.config.signUpEnabled && /* @__PURE__ */ jsxs(Typography, { children: [
        t("Don't have an account?"),
        " ",
        /* @__PURE__ */ jsx(StyledLink, { href: stackApp.urls.signUp, onClick: (e) => {
          runAsynchronously(stackApp.redirectToSignUp());
          e.preventDefault();
        }, children: t("Sign up") })
      ] }) : /* @__PURE__ */ jsxs(Typography, { children: [
        t("Already have an account?"),
        " ",
        /* @__PURE__ */ jsx(StyledLink, { href: stackApp.urls.signIn, onClick: (e) => {
          runAsynchronously(stackApp.redirectToSignIn());
          e.preventDefault();
        }, children: t("Sign in") })
      ] })
    ] }),
    (hasOAuthProviders || hasPasskey) && /* @__PURE__ */ jsxs("div", { className: "gap-4 flex flex-col items-stretch stack-scope", children: [
      hasOAuthProviders && /* @__PURE__ */ jsx(OAuthButtonGroup, { type: props.type, mockProject: props.mockProject }),
      hasPasskey && /* @__PURE__ */ jsx(PasskeyButton, { type: props.type })
    ] }),
    enableSeparator && /* @__PURE__ */ jsx(SeparatorWithText, { text: t("Or continue with") }),
    project.config.credentialEnabled && project.config.magicLinkEnabled ? /* @__PURE__ */ jsxs(Tabs, { defaultValue: props.firstTab || "magic-link", children: [
      /* @__PURE__ */ jsxs(TabsList, { className: cn("w-full mb-2", {
        "flex-row-reverse": props.firstTab === "password"
      }), children: [
        /* @__PURE__ */ jsx(TabsTrigger, { value: "magic-link", className: "flex-1", children: t("Email") }),
        /* @__PURE__ */ jsx(TabsTrigger, { value: "password", className: "flex-1", children: t("Email & Password") })
      ] }),
      /* @__PURE__ */ jsx(TabsContent, { value: "magic-link", children: /* @__PURE__ */ jsx(MagicLinkSignIn, {}) }),
      /* @__PURE__ */ jsx(TabsContent, { value: "password", children: props.type === "sign-up" ? /* @__PURE__ */ jsx(CredentialSignUp, { noPasswordRepeat: props.noPasswordRepeat }) : /* @__PURE__ */ jsx(CredentialSignIn, {}) })
    ] }) : project.config.credentialEnabled ? props.type === "sign-up" ? /* @__PURE__ */ jsx(CredentialSignUp, { noPasswordRepeat: props.noPasswordRepeat }) : /* @__PURE__ */ jsx(CredentialSignIn, {}) : project.config.magicLinkEnabled ? /* @__PURE__ */ jsx(MagicLinkSignIn, {}) : !(hasOAuthProviders || hasPasskey) ? /* @__PURE__ */ jsx(Typography, { variant: "destructive", className: "text-center", children: t("No authentication method enabled.") }) : null,
    props.extraInfo && /* @__PURE__ */ jsx("div", { className: cn("flex flex-col items-center text-center text-sm text-gray-500", {
      "mt-2": project.config.credentialEnabled || project.config.magicLinkEnabled,
      "mt-6": !(project.config.credentialEnabled || project.config.magicLinkEnabled)
    }), children: /* @__PURE__ */ jsx("div", { children: props.extraInfo }) })
  ] }) });
}
export {
  AuthPage
};
//# sourceMappingURL=auth-page.js.map