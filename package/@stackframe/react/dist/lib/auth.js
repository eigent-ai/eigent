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

// src/lib/auth.ts
var auth_exports = {};
__export(auth_exports, {
  addNewOAuthProviderOrScope: () => addNewOAuthProviderOrScope,
  callOAuthCallback: () => callOAuthCallback,
  signInWithOAuth: () => signInWithOAuth
});
module.exports = __toCommonJS(auth_exports);
var import_stack_shared = require("@stackframe/stack-shared");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_results = require("@stackframe/stack-shared/dist/utils/results");
var import_strings = require("@stackframe/stack-shared/dist/utils/strings");
var import_url = require("../utils/url");
var import_cookie = require("./cookie");
async function signInWithOAuth(iface, options) {
  const { codeChallenge, state } = await (0, import_cookie.saveVerifierAndState)();
  const location = await iface.getOAuthUrl({
    provider: options.provider,
    redirectUrl: (0, import_url.constructRedirectUrl)(options.redirectUrl, "redirectUrl"),
    errorRedirectUrl: (0, import_url.constructRedirectUrl)(options.errorRedirectUrl, "errorRedirectUrl"),
    codeChallenge,
    state,
    type: "authenticate",
    providerScope: options.providerScope
  });
  window.location.assign(location);
  await (0, import_promises.neverResolve)();
}
async function addNewOAuthProviderOrScope(iface, options, session) {
  const { codeChallenge, state } = await (0, import_cookie.saveVerifierAndState)();
  const location = await iface.getOAuthUrl({
    provider: options.provider,
    redirectUrl: (0, import_url.constructRedirectUrl)(options.redirectUrl, "redirectUrl"),
    errorRedirectUrl: (0, import_url.constructRedirectUrl)(options.errorRedirectUrl, "errorRedirectUrl"),
    afterCallbackRedirectUrl: (0, import_url.constructRedirectUrl)(window.location.href, "afterCallbackRedirectUrl"),
    codeChallenge,
    state,
    type: "link",
    session,
    providerScope: options.providerScope
  });
  window.location.assign(location);
  await (0, import_promises.neverResolve)();
}
function consumeOAuthCallbackQueryParams() {
  const requiredParams = ["code", "state"];
  const originalUrl = new URL(window.location.href);
  for (const param of requiredParams) {
    if (!originalUrl.searchParams.has(param)) {
      console.warn(new Error(`Missing required query parameter on OAuth callback: ${param}. Maybe you opened or reloaded the oauth-callback page from your history?`));
      return null;
    }
  }
  const expectedState = originalUrl.searchParams.get("state") ?? (0, import_errors.throwErr)("This should never happen; isn't state required above?");
  const cookieResult = (0, import_cookie.consumeVerifierAndStateCookie)(expectedState);
  if (!cookieResult) {
    console.warn(import_strings.deindent`
      Stack found an outer OAuth callback state in the query parameters, but not in cookies.
      
      This could have multiple reasons:
        - The cookie expired, because the OAuth flow took too long.
        - The user's browser deleted the cookie, either manually or because of a very strict cookie policy.
        - The cookie was already consumed by this page, and the user already logged in.
        - You are using another OAuth client library with the same callback URL as Stack.
        - The user opened the OAuth callback page from their history.

      Either way, it is probably safe to ignore this warning unless you are debugging an OAuth issue.
    `);
    return null;
  }
  const newUrl = new URL(originalUrl);
  for (const param of requiredParams) {
    newUrl.searchParams.delete(param);
  }
  window.history.replaceState({}, "", newUrl.toString());
  return {
    originalUrl,
    codeVerifier: cookieResult.codeVerifier,
    state: expectedState
  };
}
async function callOAuthCallback(iface, redirectUrl) {
  const consumed = consumeOAuthCallbackQueryParams();
  if (!consumed) return import_results.Result.ok(void 0);
  try {
    return import_results.Result.ok(await iface.callOAuthCallback({
      oauthParams: consumed.originalUrl.searchParams,
      redirectUri: (0, import_url.constructRedirectUrl)(redirectUrl, "redirectUri"),
      codeVerifier: consumed.codeVerifier,
      state: consumed.state
    }));
  } catch (e) {
    if (import_stack_shared.KnownError.isKnownError(e)) {
      throw e;
    }
    throw new import_errors.StackAssertionError("Error signing in during OAuth callback. Please try again.", { cause: e });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  addNewOAuthProviderOrScope,
  callOAuthCallback,
  signInWithOAuth
});
//# sourceMappingURL=auth.js.map