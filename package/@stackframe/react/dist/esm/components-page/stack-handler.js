// src/components-page/stack-handler.tsx
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { getRelativePart } from "@stackframe/stack-shared/dist/utils/urls";
import { useMemo } from "react";
import { SignIn, SignUp } from "..";
import { IframePreventer } from "../components/iframe-preventer";
import { MessageCard } from "../components/message-cards/message-card";
import { AccountSettings } from "./account-settings";
import { CliAuthConfirmation } from "./cli-auth-confirm";
import { EmailVerification } from "./email-verification";
import { ErrorPage } from "./error-page";
import { ForgotPassword } from "./forgot-password";
import { MagicLinkCallback } from "./magic-link-callback";
import { OAuthCallback } from "./oauth-callback";
import { PasswordReset } from "./password-reset";
import { SignOut } from "./sign-out";
import { TeamInvitation } from "./team-invitation";
import { jsx } from "react/jsx-runtime";
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
      return /* @__PURE__ */ jsx(
        SignIn,
        {
          fullPage,
          automaticRedirect: true,
          ...filterUndefinedINU(componentProps?.SignIn)
        }
      );
    }
    case availablePaths.signUp: {
      redirectIfNotHandler?.("signUp");
      return /* @__PURE__ */ jsx(
        SignUp,
        {
          fullPage,
          automaticRedirect: true,
          ...filterUndefinedINU(componentProps?.SignUp)
        }
      );
    }
    case availablePaths.emailVerification: {
      redirectIfNotHandler?.("emailVerification");
      return /* @__PURE__ */ jsx(
        EmailVerification,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.EmailVerification)
        }
      );
    }
    case availablePaths.passwordReset: {
      redirectIfNotHandler?.("passwordReset");
      return /* @__PURE__ */ jsx(
        PasswordReset,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.PasswordReset)
        }
      );
    }
    case availablePaths.forgotPassword: {
      redirectIfNotHandler?.("forgotPassword");
      return /* @__PURE__ */ jsx(
        ForgotPassword,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.ForgotPassword)
        }
      );
    }
    case availablePaths.signOut: {
      redirectIfNotHandler?.("signOut");
      return /* @__PURE__ */ jsx(
        SignOut,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.SignOut)
        }
      );
    }
    case availablePaths.oauthCallback: {
      redirectIfNotHandler?.("oauthCallback");
      return /* @__PURE__ */ jsx(
        OAuthCallback,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.OAuthCallback)
        }
      );
    }
    case availablePaths.magicLinkCallback: {
      redirectIfNotHandler?.("magicLinkCallback");
      return /* @__PURE__ */ jsx(
        MagicLinkCallback,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.MagicLinkCallback)
        }
      );
    }
    case availablePaths.teamInvitation: {
      redirectIfNotHandler?.("teamInvitation");
      return /* @__PURE__ */ jsx(
        TeamInvitation,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.TeamInvitation)
        }
      );
    }
    case availablePaths.accountSettings: {
      return /* @__PURE__ */ jsx(
        AccountSettings,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.AccountSettings)
        }
      );
    }
    case availablePaths.error: {
      return /* @__PURE__ */ jsx(
        ErrorPage,
        {
          searchParams,
          fullPage,
          ...filterUndefinedINU(componentProps?.ErrorPage)
        }
      );
    }
    case availablePaths.cliAuthConfirm: {
      return /* @__PURE__ */ jsx(
        CliAuthConfirmation,
        {
          fullPage,
          ...filterUndefinedINU(componentProps?.CliAuthConfirmation)
        }
      );
    }
    default: {
      if (Object.values(availablePaths).includes(path)) {
        throw new StackAssertionError(`Path alias ${path} not included in switch statement, but in availablePaths?`, { availablePaths });
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
  const { path, searchParams } = useMemo(() => {
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
    window.location.href = getRelativePart(urlObj);
  };
  const result = renderComponent({
    path,
    searchParams,
    fullPage: props.fullPage,
    componentProps: props.componentProps,
    redirectIfNotHandler,
    onNotFound: () => /* @__PURE__ */ jsx(
      MessageCard,
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
  return /* @__PURE__ */ jsx(IframePreventer, { children: result });
}
var stack_handler_default = ReactStackHandler;
function filterUndefinedINU(value) {
  return value === void 0 ? value : filterUndefined(value);
}
export {
  stack_handler_default as default
};
//# sourceMappingURL=stack-handler.js.map