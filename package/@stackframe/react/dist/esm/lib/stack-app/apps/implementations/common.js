// src/lib/stack-app/apps/implementations/common.ts
import { AsyncCache } from "@stackframe/stack-shared/dist/utils/caches";
import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, concatStacktraces, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
import { suspendIfSsr } from "@stackframe/stack-shared/dist/utils/react";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Store } from "@stackframe/stack-shared/dist/utils/stores";
import React, { useCallback } from "react";
var process = globalThis.process ?? { env: {} };
var clientVersion = "js @stackframe/react@2.8.12";
if (clientVersion.startsWith("STACK_COMPILE_TIME")) {
  throw new StackAssertionError("Client version was not replaced. Something went wrong during build!");
}
var createCache = (fetcher) => {
  return new AsyncCache(
    async (dependencies) => await Result.fromThrowingAsync(async () => await fetcher(dependencies)),
    {}
  );
};
var createCacheBySession = (fetcher) => {
  return new AsyncCache(
    async ([session, ...extraDependencies]) => await Result.fromThrowingAsync(async () => await fetcher(session, extraDependencies)),
    {
      onSubscribe: ([session], refresh) => {
        const handler = session.onInvalidate(() => refresh());
        return () => handler.unsubscribe();
      }
    }
  );
};
function getUrls(partial) {
  const handler = partial.handler ?? "/handler";
  const home = partial.home ?? "/";
  const afterSignIn = partial.afterSignIn ?? home;
  return {
    handler,
    signIn: `${handler}/sign-in`,
    afterSignIn: home,
    signUp: `${handler}/sign-up`,
    afterSignUp: afterSignIn,
    signOut: `${handler}/sign-out`,
    afterSignOut: home,
    emailVerification: `${handler}/email-verification`,
    passwordReset: `${handler}/password-reset`,
    forgotPassword: `${handler}/forgot-password`,
    oauthCallback: `${handler}/oauth-callback`,
    magicLinkCallback: `${handler}/magic-link-callback`,
    home,
    accountSettings: `${handler}/account-settings`,
    error: `${handler}/error`,
    teamInvitation: `${handler}/team-invitation`,
    ...filterUndefined(partial)
  };
}
function getDefaultProjectId() {
  return process.env.NEXT_PUBLIC_STACK_PROJECT_ID || throwErr(new Error("Welcome to Stack Auth! It seems that you haven't provided a project ID. Please create a project on the Stack dashboard at https://app.stack-auth.com and put it in the NEXT_PUBLIC_STACK_PROJECT_ID environment variable."));
}
function getDefaultPublishableClientKey() {
  return process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || throwErr(new Error("Welcome to Stack Auth! It seems that you haven't provided a publishable client key. Please create an API key for your project on the Stack dashboard at https://app.stack-auth.com and copy your publishable client key into the NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY environment variable."));
}
function getDefaultSecretServerKey() {
  return process.env.STACK_SECRET_SERVER_KEY || throwErr(new Error("No secret server key provided. Please copy your key from the Stack dashboard and put it in the STACK_SECRET_SERVER_KEY environment variable."));
}
function getDefaultSuperSecretAdminKey() {
  return process.env.STACK_SUPER_SECRET_ADMIN_KEY || throwErr(new Error("No super secret admin key provided. Please copy your key from the Stack dashboard and put it in the STACK_SUPER_SECRET_ADMIN_KEY environment variable."));
}
function getDefaultExtraRequestHeaders() {
  return JSON.parse(process.env.NEXT_PUBLIC_STACK_EXTRA_REQUEST_HEADERS || "{}");
}
function getBaseUrl(userSpecifiedBaseUrl) {
  let url;
  if (userSpecifiedBaseUrl) {
    if (typeof userSpecifiedBaseUrl === "string") {
      url = userSpecifiedBaseUrl;
    } else {
      if (isBrowserLike()) {
        url = userSpecifiedBaseUrl.browser;
      } else {
        url = userSpecifiedBaseUrl.server;
      }
    }
  } else {
    if (isBrowserLike()) {
      url = process.env.NEXT_PUBLIC_BROWSER_STACK_API_URL;
    } else {
      url = process.env.NEXT_PUBLIC_SERVER_STACK_API_URL;
    }
    url = url || process.env.NEXT_PUBLIC_STACK_API_URL || process.env.NEXT_PUBLIC_STACK_URL || defaultBaseUrl;
  }
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
var defaultBaseUrl = "https://api.stack-auth.com";
function createEmptyTokenStore() {
  return new Store({
    refreshToken: null,
    accessToken: null
  });
}
var cachePromiseByHookId = /* @__PURE__ */ new Map();
function useAsyncCache(cache, dependencies, caller) {
  suspendIfSsr(caller);
  const id = React.useId();
  const subscribe = useCallback((cb) => {
    const { unsubscribe } = cache.onStateChange(dependencies, () => {
      cachePromiseByHookId.delete(id);
      cb();
    });
    return unsubscribe;
  }, [cache, ...dependencies]);
  const getSnapshot = useCallback(() => {
    if (!cachePromiseByHookId.has(id)) {
      cachePromiseByHookId.set(id, cache.getOrWait(dependencies, "read-write"));
    }
    return cachePromiseByHookId.get(id);
  }, [cache, ...dependencies]);
  const promise = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => throwErr(new Error("getServerSnapshot should never be called in useAsyncCache because we restrict to CSR earlier"))
  );
  const result = React.use(promise);
  if (result.status === "error") {
    const error = result.error;
    if (error instanceof Error && !error.__stackHasConcatenatedStacktraces) {
      concatStacktraces(error, new Error());
      error.__stackHasConcatenatedStacktraces = true;
    }
    throw error;
  }
  return result.data;
}
export {
  clientVersion,
  createCache,
  createCacheBySession,
  createEmptyTokenStore,
  getBaseUrl,
  getDefaultExtraRequestHeaders,
  getDefaultProjectId,
  getDefaultPublishableClientKey,
  getDefaultSecretServerKey,
  getDefaultSuperSecretAdminKey,
  getUrls,
  useAsyncCache
};
//# sourceMappingURL=common.js.map