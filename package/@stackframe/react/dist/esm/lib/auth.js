// src/lib/auth.ts
import { KnownError } from "@stackframe/stack-shared";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { neverResolve } from "@stackframe/stack-shared/dist/utils/promises";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { constructRedirectUrl } from "../utils/url";
import { consumeVerifierAndStateCookie, saveVerifierAndState } from "./cookie";
async function signInWithOAuth(iface, options) {
  const { codeChallenge, state } = await saveVerifierAndState();
  const location = await iface.getOAuthUrl({
    provider: options.provider,
    redirectUrl: constructRedirectUrl(options.redirectUrl, "redirectUrl"),
    errorRedirectUrl: constructRedirectUrl(options.errorRedirectUrl, "errorRedirectUrl"),
    codeChallenge,
    state,
    type: "authenticate",
    providerScope: options.providerScope
  });
  window.location.assign(location);
  await neverResolve();
}
async function addNewOAuthProviderOrScope(iface, options, session) {
  const { codeChallenge, state } = await saveVerifierAndState();
  const location = await iface.getOAuthUrl({
    provider: options.provider,
    redirectUrl: constructRedirectUrl(options.redirectUrl, "redirectUrl"),
    errorRedirectUrl: constructRedirectUrl(options.errorRedirectUrl, "errorRedirectUrl"),
    afterCallbackRedirectUrl: constructRedirectUrl(window.location.href, "afterCallbackRedirectUrl"),
    codeChallenge,
    state,
    type: "link",
    session,
    providerScope: options.providerScope
  });
  window.location.assign(location);
  await neverResolve();
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
  const expectedState = originalUrl.searchParams.get("state") ?? throwErr("This should never happen; isn't state required above?");
  const cookieResult = consumeVerifierAndStateCookie(expectedState);
  if (!cookieResult) {
    console.warn(deindent`
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
  if (!consumed) return Result.ok(void 0);
  try {
    return Result.ok(await iface.callOAuthCallback({
      oauthParams: consumed.originalUrl.searchParams,
      redirectUri: constructRedirectUrl(redirectUrl, "redirectUri"),
      codeVerifier: consumed.codeVerifier,
      state: consumed.state
    }));
  } catch (e) {
    if (KnownError.isKnownError(e)) {
      throw e;
    }
    throw new StackAssertionError("Error signing in during OAuth callback. Please try again.", { cause: e });
  }
}
export {
  addNewOAuthProviderOrScope,
  callOAuthCallback,
  signInWithOAuth
};
//# sourceMappingURL=auth.js.map