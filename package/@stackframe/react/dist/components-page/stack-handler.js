"use strict";
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

// src/components-page/stack-handler.tsx
var stack_handler_exports = {};
__export(stack_handler_exports, {
  default: () => stack_handler_default
});
module.exports = __toCommonJS(stack_handler_exports);
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_objects = require("@stackframe/stack-shared/dist/utils/objects");
var import_urls = require("@stackframe/stack-shared/dist/utils/urls");
var import_react = require("react");
var import__ = require("..");
var import_iframe_preventer = require("../components/iframe-preventer");
var import_message_card = require("../components/message-cards/message-card");
var import_account_settings = require("./account-settings");
var import_cli_auth_confirm = require("./cli-auth-confirm");
var import_email_verification = require("./email-verification");
var import_error_page = require("./error-page");
var import_forgot_password = require("./forgot-password");
var import_magic_link_callback = require("./magic-link-callback");
var import_oauth_callback = require("./oauth-callback");
var import_password_reset = require("./password-reset");
var import_sign_out = require("./sign-out");
var import_team_invitation = require("./team-invitation");
var import_jsx_runtime = require("react/jsx-runtime");
var availablePaths = {
  signIn: "sign-in",
  signUp: "sign-up",
  emailVerification: "email-verification",
  passwordReset: "password-reset",
  forgotPassword: "forgot-password",
  signOut: "sign-out",
  oauthCallback: "oauth-callback",
  magicLinkCallback: "magic-link-callback",
  teamInvitation: "team-invitation",
  accountSettings: "account-settings",
  cliAuthConfirm: "cli-auth-confirm",
  error: "error"
};
var pathAliases = {
  // also includes the uppercase and non-dashed versions
  ...Object.fromEntries(Object.entries(availablePaths).map(([key, value]) => [value, value])),
  "log-in": availablePaths.signIn,
  "register": availablePaths.signUp
};
function renderComponent(props) {
  const { path, searchParams, fullPage, componentProps, redirectIfNotHandler, onNotFound, app } = props;
  switch (path) {
    case availablePaths.signIn: {
      redirectIfNotHandler?.("signIn");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import__.SignIn,
        {
          fullPage,
          automaticRedirect: true,
          ...filterUndefinedINU(componentProps?.SignIn)
        }
      );
    }
    case availablePaths.signUp: {
      redirectIfNotHandler?.("signUp");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import__.SignUp,
        {
          fullPage,
          automaticRedirect: true,
          ...filterUndefinedINU(componentProps?.SignUp)
        }
      );
    }
    case availablePaths.emailVerification: {
      redirectIfNotHandler?.("emailVerification");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_email_verification.EmailVerification,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.EmailVerification)
        }
      );
    }
    case availablePaths.passwordReset: {
      redirectIfNotHandler?.("passwordReset");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_password_reset.PasswordReset,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.PasswordReset)
        }
      );
    }
    case availablePaths.forgotPassword: {
      redirectIfNotHandler?.("forgotPassword");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_forgot_password.ForgotPassword,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.ForgotPassword)
        }
      );
    }
    case availablePaths.signOut: {
      redirectIfNotHandler?.("signOut");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_sign_out.SignOut,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.SignOut)
        }
      );
    }
    case availablePaths.oauthCallback: {
      redirectIfNotHandler?.("oauthCallback");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_oauth_callback.OAuthCallback,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.OAuthCallback)
        }
      );
    }
    case availablePaths.magicLinkCallback: {
      redirectIfNotHandler?.("magicLinkCallback");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_magic_link_callback.MagicLinkCallback,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.MagicLinkCallback)
        }
      );
    }
    case availablePaths.teamInvitation: {
      redirectIfNotHandler?.("teamInvitation");
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_team_invitation.TeamInvitation,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.TeamInvitation)
        }
      );
    }
    case availablePaths.accountSettings: {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_account_settings.AccountSettings,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.AccountSettings)
        }
      );
    }
    case availablePaths.error: {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_error_page.ErrorPage,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.ErrorPage)
        }
      );
    }
    case availablePaths.cliAuthConfirm: {
      return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_cli_auth_confirm.CliAuthConfirmation,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.CliAuthConfirmation)
        }
      );
    }
    default: {
      if (Object.values(availablePaths).includes(path)) {
        throw new import_errors.StackAssertionError(`Path alias ${path} not included in switch statement, but in availablePaths?`, { availablePaths });
      }
      for (const [key, value] of Object.entries(pathAliases)) {
        if (path === key.toLowerCase().replaceAll("-", "")) {
          const redirectUrl = `${app.urls.handler}/${value}?${new URLSearchParams(searchParams).toString()}`;
          return { redirect: redirectUrl };
        }
      }
      return onNotFound();
    }
  }
}
function ReactStackHandler(props) {
  const { path, searchParams } = (0, import_react.useMemo)(() => {
    const search = window.location.search;
    const handlerPath = new URL(props.app.urls.handler, window.location.origin).pathname;
    const relativePath = props.location.startsWith(handlerPath) ? props.location.slice(handlerPath.length).replace(/^\/+/, "") : props.location.replace(/^\/+/, "");
    return {
      path: relativePath,
      searchParams: Object.fromEntries(new URLSearchParams(search).entries())
    };
  }, [props.location, props.app.urls.handler]);
  const redirectIfNotHandler = (name) => {
    const url = props.app.urls[name];
    const handlerUrl = props.app.urls.handler;
    if (url !== handlerUrl && url.startsWith(handlerUrl + "/")) {
      return;
    }
    const urlObj = new URL(url, window.location.origin);
    for (const [key, value] of Object.entries(searchParams)) {
      urlObj.searchParams.set(key, value);
    }
    window.location.href = (0, import_urls.getRelativePart)(urlObj);
  };
  const result = renderComponent({
    path,
    searchParams,
    fullPage: props.fullPage,
    componentProps: props.componentProps,
    redirectIfNotHandler,
    onNotFound: () => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_message_card.MessageCard,
      {
        title: "Page does not exist",
        fullPage: props.fullPage,
        primaryButtonText: "Go to Home",
        primaryAction: () => props.app.redirectToHome(),
        children: "The page you are looking for could not be found. Please check the URL and try again."
      }
    ),
    app: props.app
  });
  if (result && "redirect" in result) {
    window.location.href = result.redirect;
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_iframe_preventer.IframePreventer, { children: result });
}
var stack_handler_default = ReactStackHandler;
function filterUndefinedINU(value) {
  return value === void 0 ? value : (0, import_objects.filterUndefined)(value);
}
//# sourceMappingURL=stack-handler.js.map