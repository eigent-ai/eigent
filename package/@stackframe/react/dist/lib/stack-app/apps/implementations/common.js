"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/stack-app/apps/implementations/common.ts
var common_exports = {};
__export(common_exports, {
  clientVersion: () => clientVersion,
  createCache: () => createCache,
  createCacheBySession: () => createCacheBySession,
  createEmptyTokenStore: () => createEmptyTokenStore,
  getBaseUrl: () => getBaseUrl,
  getDefaultExtraRequestHeaders: () => getDefaultExtraRequestHeaders,
  getDefaultProjectId: () => getDefaultProjectId,
  getDefaultPublishableClientKey: () => getDefaultPublishableClientKey,
  getDefaultSecretServerKey: () => getDefaultSecretServerKey,
  getDefaultSuperSecretAdminKey: () => getDefaultSuperSecretAdminKey,
  getUrls: () => getUrls,
  useAsyncCache: () => useAsyncCache
});
module.exports = __toCommonJS(common_exports);
var import_caches = require("@stackframe/stack-shared/dist/utils/caches");
var import_env = require("@stackframe/stack-shared/dist/utils/env");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_objects = require("@stackframe/stack-shared/dist/utils/objects");
var import_react = require("@stackframe/stack-shared/dist/utils/react");
var import_results = require("@stackframe/stack-shared/dist/utils/results");
var import_stores = require("@stackframe/stack-shared/dist/utils/stores");
var import_react2 = __toESM(require("react"));
var process = globalThis.process ?? { env: {} };
var clientVersion = "js @stackframe/react@2.8.12";
if (clientVersion.startsWith("STACK_COMPILE_TIME")) {
  throw new import_errors.StackAssertionError("Client version was not replaced. Something went wrong during build!");
}
var createCache = (fetcher) => {
  return new import_caches.AsyncCache(
    async (dependencies) => await import_results.Result.fromThrowingAsync(async () => await fetcher(dependencies)),
    {}
  );
};
var createCacheBySession = (fetcher) => {
  return new import_caches.AsyncCache(
    async ([session, ...extraDependencies]) => await import_results.Result.fromThrowingAsync(async () => await fetcher(session, extraDependencies)),
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
    ...(0, import_objects.filterUndefined)(partial)
  };
}
function getDefaultProjectId() {
  return process.env.NEXT_PUBLIC_STACK_PROJECT_ID || (0, import_errors.throwErr)(new Error("Welcome to Stack Auth! It seems that you haven't provided a project ID. Please create a project on the Stack dashboard at https://app.stack-auth.com and put it in the NEXT_PUBLIC_STACK_PROJECT_ID environment variable."));
}
function getDefaultPublishableClientKey() {
  return process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY || (0, import_errors.throwErr)(new Error("Welcome to Stack Auth! It seems that you haven't provided a publishable client key. Please create an API key for your project on the Stack dashboard at https://app.stack-auth.com and copy your publishable client key into the NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY environment variable."));
}
function getDefaultSecretServerKey() {
  return process.env.STACK_SECRET_SERVER_KEY || (0, import_errors.throwErr)(new Error("No secret server key provided. Please copy your key from the Stack dashboard and put it in the STACK_SECRET_SERVER_KEY environment variable."));
}
function getDefaultSuperSecretAdminKey() {
  return process.env.STACK_SUPER_SECRET_ADMIN_KEY || (0, import_errors.throwErr)(new Error("No super secret admin key provided. Please copy your key from the Stack dashboard and put it in the STACK_SUPER_SECRET_ADMIN_KEY environment variable."));
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
      if ((0, import_env.isBrowserLike)()) {
        url = userSpecifiedBaseUrl.browser;
      } else {
        url = userSpecifiedBaseUrl.server;
      }
    }
  } else {
    if ((0, import_env.isBrowserLike)()) {
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
  return new import_stores.Store({
    refreshToken: null,
    accessToken: null
  });
}
var cachePromiseByHookId = /* @__PURE__ */ new Map();
function useAsyncCache(cache, dependencies, caller) {
  (0, import_react.suspendIfSsr)(caller);
  const id = import_react2.default.useId();
  const subscribe = (0, import_react2.useCallback)((cb) => {
    const { unsubscribe } = cache.onStateChange(dependencies, () => {
      cachePromiseByHookId.delete(id);
      cb();
    });
    return unsubscribe;
  }, [cache, ...dependencies]);
  const getSnapshot = (0, import_react2.useCallback)(() => {
    if (!cachePromiseByHookId.has(id)) {
      cachePromiseByHookId.set(id, cache.getOrWait(dependencies, "read-write"));
    }
    return cachePromiseByHookId.get(id);
  }, [cache, ...dependencies]);
  const promise = import_react2.default.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => (0, import_errors.throwErr)(new Error("getServerSnapshot should never be called in useAsyncCache because we restrict to CSR earlier"))
  );
  const result = import_react2.default.use(promise);
  if (result.status === "error") {
    const error = result.error;
    if (error instanceof Error && !error.__stackHasConcatenatedStacktraces) {
      (0, import_errors.concatStacktraces)(error, new Error());
      error.__stackHasConcatenatedStacktraces = true;
    }
    throw error;
  }
  return result.data;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
//# sourceMappingURL=common.js.map