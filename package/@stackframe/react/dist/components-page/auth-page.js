"use client";
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components-page/auth-page.tsx
var auth_page_exports = {};
__export(auth_page_exports, {
  AuthPage: () => AuthPage
});
module.exports = __toCommonJS(auth_page_exports);
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_react = require("react");
var import__ = require("..");
var import_credential_sign_in = require("../components/credential-sign-in");
var import_credential_sign_up = require("../components/credential-sign-up");
var import_maybe_full_page = require("../components/elements/maybe-full-page");
var import_separator_with_text = require("../components/elements/separator-with-text");
var import_link = require("../components/link");
var import_magic_link_sign_in = require("../components/magic-link-sign-in");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_oauth_button_group = require("../components/oauth-button-group");
var import_passkey_button = require("../components/passkey-button");
var import_translations = require("../lib/translations");
var import_jsx_runtime = require("react/jsx-runtime");
function AuthPage(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fallback, { ...props }), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Inner, { ...props }) });
}
function Fallback(props) {
  const { t } = (0, import_translations.useTranslation)();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "stack-scope flex flex-col items-stretch", style: { maxWidth: "380px", flexBasis: "380px", padding: props.fullPage ? "1rem" : 0 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "text-center mb-6 flex flex-col", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-2/3 self-center" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-3 w-16 mt-8" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-3 w-24 mt-2" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-9 w-full mt-6" })
  ] }) }) });
}
function Inner(props) {
  const stackApp = (0, import__.useStackApp)();
  const user = (0, import__.useUser)();
  const projectFromHook = stackApp.useProject();
  const project = props.mockProject || projectFromHook;
  const { t } = (0, import_translations.useTranslation)();
  (0, import_react.useEffect)(() => {
    if (props.automaticRedirect && user && !props.mockProject) {
      (0, import_promises.runAsynchronously)(
        props.type === "sign-in" ? stackApp.redirectToAfterSignIn({ replace: true }) : stackApp.redirectToAfterSignUp({ replace: true })
      );
    }
  }, [user, props.mockProject, stackApp, props.automaticRedirect]);
  if (user && !props.mockProject && !props.automaticRedirect) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "signedIn", fullPage: props.fullPage });
  }
  if (props.type === "sign-up" && !project.config.signUpEnabled) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "signUpDisabled", fullPage: props.fullPage });
  }
  const hasOAuthProviders = project.config.oauthProviders.length > 0;
  const hasPasskey = project.config.passkeyEnabled === true && props.type === "sign-in";
  const enableSeparator = (project.config.credentialEnabled || project.config.magicLinkEnabled) && (hasOAuthProviders || hasPasskey);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "stack-scope flex flex-col items-stretch", style: { maxWidth: "380px", flexBasis: "380px", padding: props.fullPage ? "1rem" : 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "text-center mb-6", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h2", children: props.type === "sign-in" ? t("Sign in to your account") : t("Create a new account") }),
      props.type === "sign-in" ? project.config.signUpEnabled && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
        t("Don't have an account?"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_link.StyledLink, { href: stackApp.urls.signUp, onClick: (e) => {
          (0, import_promises.runAsynchronously)(stackApp.redirectToSignUp());
          e.preventDefault();
        }, children: t("Sign up") })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
        t("Already have an account?"),
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_link.StyledLink, { href: stackApp.urls.signIn, onClick: (e) => {
          (0, import_promises.runAsynchronously)(stackApp.redirectToSignIn());
          e.preventDefault();
        }, children: t("Sign in") })
      ] })
    ] }),
    (hasOAuthProviders || hasPasskey) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "gap-4 flex flex-col items-stretch stack-scope", children: [
      hasOAuthProviders && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_oauth_button_group.OAuthButtonGroup, { type: props.type, mockProject: props.mockProject }),
      hasPasskey && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_passkey_button.PasskeyButton, { type: props.type })
    ] }),
    enableSeparator && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_separator_with_text.SeparatorWithText, { text: t("Or continue with") }),
    project.config.credentialEnabled && project.config.magicLinkEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Tabs, { defaultValue: props.firstTab || "magic-link", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TabsList, { className: (0, import_stack_ui.cn)("w-full mb-2", {
        "flex-row-reverse": props.firstTab === "password"
      }), children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TabsTrigger, { value: "magic-link", className: "flex-1", children: t("Email") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TabsTrigger, { value: "password", className: "flex-1", children: t("Email & Password") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TabsContent, { value: "magic-link", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_magic_link_sign_in.MagicLinkSignIn, {}) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TabsContent, { value: "password", children: props.type === "sign-up" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_credential_sign_up.CredentialSignUp, { noPasswordRepeat: props.noPasswordRepeat }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_credential_sign_in.CredentialSignIn, {}) })
    ] }) : project.config.credentialEnabled ? props.type === "sign-up" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_credential_sign_up.CredentialSignUp, { noPasswordRepeat: props.noPasswordRepeat }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_credential_sign_in.CredentialSignIn, {}) : project.config.magicLinkEnabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_magic_link_sign_in.MagicLinkSignIn, {}) : !(hasOAuthProviders || hasPasskey) ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "destructive", className: "text-center", children: t("No authentication method enabled.") }) : null,
    props.extraInfo && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: (0, import_stack_ui.cn)("flex flex-col items-center text-center text-sm text-gray-500", {
      "mt-2": project.config.credentialEnabled || project.config.magicLinkEnabled,
      "mt-6": !(project.config.credentialEnabled || project.config.magicLinkEnabled)
    }), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: props.extraInfo }) })
  ] }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthPage
});
//# sourceMappingURL=auth-page.js.map