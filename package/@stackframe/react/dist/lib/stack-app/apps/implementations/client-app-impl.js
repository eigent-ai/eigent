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

// src/lib/stack-app/apps/implementations/client-app-impl.ts
var client_app_impl_exports = {};
__export(client_app_impl_exports, {
  _StackClientAppImplIncomplete: () => _StackClientAppImplIncomplete
});
module.exports = __toCommonJS(client_app_impl_exports);
var import_browser = require("@simplewebauthn/browser");
var import_stack_shared = require("@stackframe/stack-shared");
var import_sessions = require("@stackframe/stack-shared/dist/sessions");
var import_env = require("@stackframe/stack-shared/dist/utils/env");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_maps = require("@stackframe/stack-shared/dist/utils/maps");
var import_objects = require("@stackframe/stack-shared/dist/utils/objects");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_react = require("@stackframe/stack-shared/dist/utils/react");
var import_results = require("@stackframe/stack-shared/dist/utils/results");
var import_stores = require("@stackframe/stack-shared/dist/utils/stores");
var import_strings = require("@stackframe/stack-shared/dist/utils/strings");
var import_urls = require("@stackframe/stack-shared/dist/utils/urls");
var import_uuids = require("@stackframe/stack-shared/dist/utils/uuids");
var cookie = __toESM(require("cookie"));
var import_url = require("../../../../utils/url");
var import_auth = require("../../../auth");
var import_cookie = require("../../../cookie");
var import_api_keys = require("../../api-keys");
var import_common = require("../../common");
var import_contact_channels = require("../../contact-channels");
var import_projects = require("../../projects");
var import_teams = require("../../teams");
var import_users = require("../../users");
var import_common2 = require("./common");
var import_react2 = __toESM(require("react"));
var import_common3 = require("./common");
var isReactServer = false;
var process = globalThis.process ?? { env: {} };
var allClientApps = /* @__PURE__ */ new Map();
var __StackClientAppImplIncomplete = class __StackClientAppImplIncomplete {
  constructor(_options) {
    this._options = _options;
    this._uniqueIdentifier = void 0;
    this.__DEMO_ENABLE_SLIGHT_FETCH_DELAY = false;
    this._ownedAdminApps = new import_maps.DependenciesMap();
    this._currentUserCache = (0, import_common2.createCacheBySession)(async (session) => {
      if (this.__DEMO_ENABLE_SLIGHT_FETCH_DELAY) {
        await (0, import_promises.wait)(2e3);
      }
      if (session.isKnownToBeInvalid()) {
        return null;
      }
      return await this._interface.getClientUserByToken(session);
    });
    this._currentProjectCache = (0, import_common2.createCache)(async () => {
      return import_results.Result.orThrow(await this._interface.getClientProject());
    });
    this._ownedProjectsCache = (0, import_common2.createCacheBySession)(async (session) => {
      return await this._interface.listProjects(session);
    });
    this._currentUserPermissionsCache = (0, import_common2.createCacheBySession)(async (session, [teamId, recursive]) => {
      return await this._interface.listCurrentUserTeamPermissions({ teamId, recursive }, session);
    });
    this._currentUserProjectPermissionsCache = (0, import_common2.createCacheBySession)(async (session, [recursive]) => {
      return await this._interface.listCurrentUserProjectPermissions({ recursive }, session);
    });
    this._currentUserTeamsCache = (0, import_common2.createCacheBySession)(async (session) => {
      return await this._interface.listCurrentUserTeams(session);
    });
    this._currentUserOAuthConnectionAccessTokensCache = (0, import_common2.createCacheBySession)(
      async (session, [providerId, scope]) => {
        try {
          const result = await this._interface.createProviderAccessToken(providerId, scope || "", session);
          return { accessToken: result.access_token };
        } catch (err) {
          if (!(import_stack_shared.KnownErrors.OAuthConnectionDoesNotHaveRequiredScope.isInstance(err) || import_stack_shared.KnownErrors.OAuthConnectionNotConnectedToUser.isInstance(err))) {
            throw err;
          }
        }
        return null;
      }
    );
    this._currentUserOAuthConnectionCache = (0, import_common2.createCacheBySession)(
      async (session, [providerId, scope, redirect]) => {
        return await this._getUserOAuthConnectionCacheFn({
          getUser: async () => import_results.Result.orThrow(await this._currentUserCache.getOrWait([session], "write-only")),
          getOrWaitOAuthToken: async () => import_results.Result.orThrow(await this._currentUserOAuthConnectionAccessTokensCache.getOrWait([session, providerId, scope || ""], "write-only")),
          useOAuthToken: () => (0, import_common3.useAsyncCache)(this._currentUserOAuthConnectionAccessTokensCache, [session, providerId, scope || ""], "useOAuthToken"),
          providerId,
          scope,
          redirect,
          session
        });
      }
    );
    this._teamMemberProfilesCache = (0, import_common2.createCacheBySession)(
      async (session, [teamId]) => {
        return await this._interface.listTeamMemberProfiles({ teamId }, session);
      }
    );
    this._teamInvitationsCache = (0, import_common2.createCacheBySession)(
      async (session, [teamId]) => {
        return await this._interface.listTeamInvitations({ teamId }, session);
      }
    );
    this._currentUserTeamProfileCache = (0, import_common2.createCacheBySession)(
      async (session, [teamId]) => {
        return await this._interface.getTeamMemberProfile({ teamId, userId: "me" }, session);
      }
    );
    this._clientContactChannelsCache = (0, import_common2.createCacheBySession)(
      async (session) => {
        return await this._interface.listClientContactChannels(session);
      }
    );
    this._userApiKeysCache = (0, import_common2.createCacheBySession)(
      async (session) => {
        const results = await this._interface.listProjectApiKeys({ user_id: "me" }, session, "client");
        return results;
      }
    );
    this._teamApiKeysCache = (0, import_common2.createCacheBySession)(
      async (session, [teamId]) => {
        const results = await this._interface.listProjectApiKeys({ team_id: teamId }, session, "client");
        return results;
      }
    );
    this._anonymousSignUpInProgress = null;
    this._memoryTokenStore = (0, import_common2.createEmptyTokenStore)();
    this._nextServerCookiesTokenStores = /* @__PURE__ */ new WeakMap();
    this._requestTokenStores = /* @__PURE__ */ new WeakMap();
    this._storedBrowserCookieTokenStore = null;
    /**
     * A map from token stores and session keys to sessions.
     *
     * This isn't just a map from session keys to sessions for two reasons:
     *
     * - So we can garbage-collect Session objects when the token store is garbage-collected
     * - So different token stores are separated and don't leak information between each other, eg. if the same user sends two requests to the same server they should get a different session object
     */
    this._sessionsByTokenStoreAndSessionKey = /* @__PURE__ */ new WeakMap();
    if (!__StackClientAppImplIncomplete.LazyStackAdminAppImpl.value) {
      throw new import_errors.StackAssertionError("Admin app implementation not initialized. Did you import the _StackClientApp from stack-app/apps/implementations/index.ts? You can't import it directly from ./apps/implementations/client-app-impl.ts as that causes a circular dependency (see the comment at _LazyStackAdminAppImpl for more details).");
    }
    if ("interface" in _options) {
      this._interface = _options.interface;
    } else {
      this._interface = new import_stack_shared.StackClientInterface({
        getBaseUrl: () => (0, import_common2.getBaseUrl)(_options.baseUrl),
        extraRequestHeaders: _options.extraRequestHeaders ?? (0, import_common2.getDefaultExtraRequestHeaders)(),
        projectId: _options.projectId ?? (0, import_common2.getDefaultProjectId)(),
        clientVersion: import_common2.clientVersion,
        publishableClientKey: _options.publishableClientKey ?? (0, import_common2.getDefaultPublishableClientKey)(),
        prepareRequest: async () => {
        }
      });
    }
    this._tokenStoreInit = _options.tokenStore;
    this._redirectMethod = _options.redirectMethod || "none";
    this._urlOptions = _options.urls ?? {};
    this._oauthScopesOnSignIn = _options.oauthScopesOnSignIn ?? {};
    if (_options.uniqueIdentifier) {
      this._uniqueIdentifier = _options.uniqueIdentifier;
      this._initUniqueIdentifier();
    }
  }
  async _createCookieHelper() {
    if (this._tokenStoreInit === "nextjs-cookie" || this._tokenStoreInit === "cookie") {
      return await (0, import_cookie.createCookieHelper)();
    } else {
      return await (0, import_cookie.createPlaceholderCookieHelper)();
    }
  }
  async _getUserOAuthConnectionCacheFn(options) {
    const user = await options.getUser();
    let hasConnection = true;
    if (!user || !user.oauth_providers.find((p) => p.id === options.providerId)) {
      hasConnection = false;
    }
    const token = await options.getOrWaitOAuthToken();
    if (!token) {
      hasConnection = false;
    }
    if (!hasConnection && options.redirect) {
      if (!options.session) {
        throw new Error(import_strings.deindent`
          Cannot add new scopes to a user that is not a CurrentUser. Please ensure that you are calling this function on a CurrentUser object, or remove the 'or: redirect' option.

          Often, you can solve this by calling this function in the browser instead, or by removing the 'or: redirect' option and dealing with the case where the user doesn't have enough permissions.
        `);
      }
      await (0, import_auth.addNewOAuthProviderOrScope)(
        this._interface,
        {
          provider: options.providerId,
          redirectUrl: this.urls.oauthCallback,
          errorRedirectUrl: this.urls.error,
          providerScope: (0, import_strings.mergeScopeStrings)(options.scope || "", (this._oauthScopesOnSignIn[options.providerId] ?? []).join(" "))
        },
        options.session
      );
      return await (0, import_promises.neverResolve)();
    } else if (!hasConnection) {
      return null;
    }
    return {
      id: options.providerId,
      async getAccessToken() {
        const result = await options.getOrWaitOAuthToken();
        if (!result) {
          throw new import_errors.StackAssertionError("No access token available");
        }
        return result;
      },
      useAccessToken() {
        const result = options.useOAuthToken();
        if (!result) {
          throw new import_errors.StackAssertionError("No access token available");
        }
        return result;
      }
    };
  }
  _initUniqueIdentifier() {
    if (!this._uniqueIdentifier) {
      throw new import_errors.StackAssertionError("Unique identifier not initialized");
    }
    if (allClientApps.has(this._uniqueIdentifier)) {
      throw new import_errors.StackAssertionError("A Stack client app with the same unique identifier already exists");
    }
    allClientApps.set(this._uniqueIdentifier, [this._options.checkString ?? void 0, this]);
  }
  /**
   * Cloudflare workers does not allow use of randomness on the global scope (on which the Stack app is probably
   * initialized). For that reason, we generate the unique identifier lazily when it is first needed instead of in the
   * constructor.
   */
  _getUniqueIdentifier() {
    if (!this._uniqueIdentifier) {
      this._uniqueIdentifier = (0, import_uuids.generateUuid)();
      this._initUniqueIdentifier();
    }
    return this._uniqueIdentifier;
  }
  async _checkFeatureSupport(name, options) {
    return await this._interface.checkFeatureSupport({ ...options, name });
  }
  _useCheckFeatureSupport(name, options) {
    (0, import_promises.runAsynchronously)(this._checkFeatureSupport(name, options));
    throw new import_errors.StackAssertionError(`${name} is not currently supported. Please reach out to Stack support for more information.`);
  }
  get _refreshTokenCookieName() {
    return `stack-refresh-${this.projectId}`;
  }
  _getTokensFromCookies(cookies) {
    const refreshToken = cookies.refreshTokenCookie;
    const accessTokenObject = cookies.accessTokenCookie?.startsWith('["') ? JSON.parse(cookies.accessTokenCookie) : null;
    const accessToken = accessTokenObject && refreshToken === accessTokenObject[0] ? accessTokenObject[1] : null;
    return {
      refreshToken,
      accessToken
    };
  }
  get _accessTokenCookieName() {
    return `stack-access`;
  }
  _getBrowserCookieTokenStore() {
    if (!(0, import_env.isBrowserLike)()) {
      throw new Error("Cannot use cookie token store on the server!");
    }
    if (this._storedBrowserCookieTokenStore === null) {
      const getCurrentValue = (old) => {
        const tokens = this._getTokensFromCookies({
          refreshTokenCookie: (0, import_cookie.getCookieClient)(this._refreshTokenCookieName) ?? (0, import_cookie.getCookieClient)("stack-refresh"),
          // keep old cookie name for backwards-compatibility
          accessTokenCookie: (0, import_cookie.getCookieClient)(this._accessTokenCookieName)
        });
        return {
          refreshToken: tokens.refreshToken,
          accessToken: tokens.accessToken ?? (old?.refreshToken === tokens.refreshToken ? old.accessToken : null)
        };
      };
      this._storedBrowserCookieTokenStore = new import_stores.Store(getCurrentValue(null));
      let hasSucceededInWriting = true;
      setInterval(() => {
        if (hasSucceededInWriting) {
          const oldValue = this._storedBrowserCookieTokenStore.get();
          const currentValue = getCurrentValue(oldValue);
          if (!(0, import_objects.deepPlainEquals)(currentValue, oldValue)) {
            this._storedBrowserCookieTokenStore.set(currentValue);
          }
        }
      }, 100);
      this._storedBrowserCookieTokenStore.onChange((value) => {
        try {
          (0, import_cookie.setOrDeleteCookieClient)(this._refreshTokenCookieName, value.refreshToken, { maxAge: 60 * 60 * 24 * 365 });
          (0, import_cookie.setOrDeleteCookieClient)(this._accessTokenCookieName, value.accessToken ? JSON.stringify([value.refreshToken, value.accessToken]) : null, { maxAge: 60 * 60 * 24 });
          (0, import_cookie.deleteCookieClient)("stack-refresh");
          hasSucceededInWriting = true;
        } catch (e) {
          if (!(0, import_env.isBrowserLike)()) {
            hasSucceededInWriting = false;
          } else {
            throw e;
          }
        }
      });
    }
    return this._storedBrowserCookieTokenStore;
  }
  _getOrCreateTokenStore(cookieHelper, overrideTokenStoreInit) {
    const tokenStoreInit = overrideTokenStoreInit === void 0 ? this._tokenStoreInit : overrideTokenStoreInit;
    switch (tokenStoreInit) {
      case "cookie": {
        return this._getBrowserCookieTokenStore();
      }
      case "nextjs-cookie": {
        if ((0, import_env.isBrowserLike)()) {
          return this._getBrowserCookieTokenStore();
        } else {
          const tokens = this._getTokensFromCookies({
            refreshTokenCookie: cookieHelper.get(this._refreshTokenCookieName) ?? cookieHelper.get("stack-refresh"),
            // keep old cookie name for backwards-compatibility
            accessTokenCookie: cookieHelper.get(this._accessTokenCookieName)
          });
          const store = new import_stores.Store(tokens);
          store.onChange((value) => {
            (0, import_promises.runAsynchronously)(async () => {
              await Promise.all([
                (0, import_cookie.setOrDeleteCookie)(this._refreshTokenCookieName, value.refreshToken, { maxAge: 60 * 60 * 24 * 365, noOpIfServerComponent: true }),
                (0, import_cookie.setOrDeleteCookie)(this._accessTokenCookieName, value.accessToken ? JSON.stringify([value.refreshToken, value.accessToken]) : null, { maxAge: 60 * 60 * 24, noOpIfServerComponent: true })
              ]);
            });
          });
          return store;
        }
      }
      case "memory": {
        return this._memoryTokenStore;
      }
      default: {
        if (tokenStoreInit === null) {
          return (0, import_common2.createEmptyTokenStore)();
        } else if (typeof tokenStoreInit === "object" && "headers" in tokenStoreInit) {
          if (this._requestTokenStores.has(tokenStoreInit)) return this._requestTokenStores.get(tokenStoreInit);
          const stackAuthHeader = tokenStoreInit.headers.get("x-stack-auth");
          if (stackAuthHeader) {
            let parsed2;
            try {
              parsed2 = JSON.parse(stackAuthHeader);
              if (typeof parsed2 !== "object") throw new Error("x-stack-auth header must be a JSON object");
              if (parsed2 === null) throw new Error("x-stack-auth header must not be null");
            } catch (e) {
              throw new Error(`Invalid x-stack-auth header: ${stackAuthHeader}`, { cause: e });
            }
            return this._getOrCreateTokenStore(cookieHelper, {
              accessToken: parsed2.accessToken ?? null,
              refreshToken: parsed2.refreshToken ?? null
            });
          }
          const cookieHeader = tokenStoreInit.headers.get("cookie");
          const parsed = cookie.parse(cookieHeader || "");
          const res = new import_stores.Store({
            refreshToken: parsed[this._refreshTokenCookieName] || parsed["stack-refresh"] || null,
            // keep old cookie name for backwards-compatibility
            accessToken: parsed[this._accessTokenCookieName] || null
          });
          this._requestTokenStores.set(tokenStoreInit, res);
          return res;
        } else if ("accessToken" in tokenStoreInit || "refreshToken" in tokenStoreInit) {
          return new import_stores.Store({
            refreshToken: tokenStoreInit.refreshToken,
            accessToken: tokenStoreInit.accessToken
          });
        }
        throw new Error(`Invalid token store ${tokenStoreInit}`);
      }
    }
  }
  _useTokenStore(overrideTokenStoreInit) {
    (0, import_react.suspendIfSsr)();
    const cookieHelper = (0, import_cookie.createBrowserCookieHelper)();
    const tokenStore = this._getOrCreateTokenStore(cookieHelper, overrideTokenStoreInit);
    return tokenStore;
  }
  _getSessionFromTokenStore(tokenStore) {
    const tokenObj = tokenStore.get();
    const sessionKey = import_sessions.InternalSession.calculateSessionKey(tokenObj);
    const existing = sessionKey ? this._sessionsByTokenStoreAndSessionKey.get(tokenStore)?.get(sessionKey) : null;
    if (existing) return existing;
    const session = this._interface.createSession({
      refreshToken: tokenObj.refreshToken,
      accessToken: tokenObj.accessToken
    });
    session.onAccessTokenChange((newAccessToken) => {
      tokenStore.update((old) => ({
        ...old,
        accessToken: newAccessToken?.token ?? null
      }));
    });
    session.onInvalidate(() => {
      tokenStore.update((old) => ({
        ...old,
        accessToken: null,
        refreshToken: null
      }));
    });
    let sessionsBySessionKey = this._sessionsByTokenStoreAndSessionKey.get(tokenStore) ?? /* @__PURE__ */ new Map();
    this._sessionsByTokenStoreAndSessionKey.set(tokenStore, sessionsBySessionKey);
    sessionsBySessionKey.set(sessionKey, session);
    return session;
  }
  async _getSession(overrideTokenStoreInit) {
    const tokenStore = this._getOrCreateTokenStore(await this._createCookieHelper(), overrideTokenStoreInit);
    return this._getSessionFromTokenStore(tokenStore);
  }
  _useSession(overrideTokenStoreInit) {
    const tokenStore = this._useTokenStore(overrideTokenStoreInit);
    const subscribe = (0, import_react2.useCallback)((cb) => {
      const { unsubscribe } = tokenStore.onChange(() => {
        cb();
      });
      return unsubscribe;
    }, [tokenStore]);
    const getSnapshot = (0, import_react2.useCallback)(() => this._getSessionFromTokenStore(tokenStore), [tokenStore]);
    return import_react2.default.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }
  async _signInToAccountWithTokens(tokens) {
    if (!("accessToken" in tokens) || !("refreshToken" in tokens)) {
      throw new import_errors.StackAssertionError("Invalid tokens object; can't sign in with this", { tokens });
    }
    const tokenStore = this._getOrCreateTokenStore(await this._createCookieHelper());
    tokenStore.set(tokens);
  }
  _hasPersistentTokenStore(overrideTokenStoreInit) {
    return (overrideTokenStoreInit !== void 0 ? overrideTokenStoreInit : this._tokenStoreInit) !== null;
  }
  _ensurePersistentTokenStore(overrideTokenStoreInit) {
    if (!this._hasPersistentTokenStore(overrideTokenStoreInit)) {
      throw new Error("Cannot call this function on a Stack app without a persistent token store. Make sure the tokenStore option on the constructor is set to a non-null value when initializing Stack.\n\nStack uses token stores to access access tokens of the current user. For example, on web frontends it is commonly the string value 'cookies' for cookie storage.");
    }
  }
  _isInternalProject() {
    return this.projectId === "internal";
  }
  _ensureInternalProject() {
    if (!this._isInternalProject()) {
      throw new Error("Cannot call this function on a Stack app with a project ID other than 'internal'.");
    }
  }
  _clientProjectFromCrud(crud) {
    return {
      id: crud.id,
      displayName: crud.display_name,
      config: {
        signUpEnabled: crud.config.sign_up_enabled,
        credentialEnabled: crud.config.credential_enabled,
        magicLinkEnabled: crud.config.magic_link_enabled,
        passkeyEnabled: crud.config.passkey_enabled,
        clientTeamCreationEnabled: crud.config.client_team_creation_enabled,
        clientUserDeletionEnabled: crud.config.client_user_deletion_enabled,
        allowTeamApiKeys: crud.config.allow_team_api_keys,
        allowUserApiKeys: crud.config.allow_user_api_keys,
        oauthProviders: crud.config.enabled_oauth_providers.map((p) => ({
          id: p.id
        }))
      }
    };
  }
  _clientPermissionFromCrud(crud) {
    return {
      id: crud.id
    };
  }
  _clientTeamUserFromCrud(crud) {
    return {
      id: crud.user_id,
      teamProfile: {
        displayName: crud.display_name,
        profileImageUrl: crud.profile_image_url
      }
    };
  }
  _clientTeamInvitationFromCrud(session, crud) {
    return {
      id: crud.id,
      recipientEmail: crud.recipient_email,
      expiresAt: new Date(crud.expires_at_millis),
      revoke: async () => {
        await this._interface.revokeTeamInvitation(crud.id, crud.team_id, session);
        await this._teamInvitationsCache.refresh([session, crud.team_id]);
      }
    };
  }
  _baseApiKeyFromCrud(crud) {
    return {
      id: crud.id,
      description: crud.description,
      expiresAt: crud.expires_at_millis ? new Date(crud.expires_at_millis) : void 0,
      manuallyRevokedAt: crud.manually_revoked_at_millis ? new Date(crud.manually_revoked_at_millis) : null,
      createdAt: new Date(crud.created_at_millis),
      ...crud.type === "team" ? { type: "team", teamId: crud.team_id } : { type: "user", userId: crud.user_id },
      value: typeof crud.value === "string" ? crud.value : {
        lastFour: crud.value.last_four
      },
      isValid: function() {
        return this.whyInvalid() === null;
      },
      whyInvalid: function() {
        if (this.manuallyRevokedAt) {
          return "manually-revoked";
        }
        if (this.expiresAt && this.expiresAt < /* @__PURE__ */ new Date()) {
          return "expired";
        }
        return null;
      }
    };
  }
  _clientApiKeyFromCrud(session, crud) {
    return {
      ...this._baseApiKeyFromCrud(crud),
      async revoke() {
        await this.update({ revoked: true });
      },
      update: async (options) => {
        await this._interface.updateProjectApiKey(crud.type === "team" ? { team_id: crud.team_id } : { user_id: crud.user_id }, crud.id, options, session, "client");
        if (crud.type === "team") {
          await this._teamApiKeysCache.refresh([session, crud.team_id]);
        } else {
          await this._userApiKeysCache.refresh([session]);
        }
      }
    };
  }
  _clientTeamFromCrud(crud, session) {
    const app = this;
    return {
      id: crud.id,
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      async inviteUser(options) {
        await app._interface.sendTeamInvitation({
          teamId: crud.id,
          email: options.email,
          session,
          callbackUrl: options.callbackUrl ?? (0, import_url.constructRedirectUrl)(app.urls.teamInvitation, "callbackUrl")
        });
        await app._teamInvitationsCache.refresh([session, crud.id]);
      },
      async listUsers() {
        const result = import_results.Result.orThrow(await app._teamMemberProfilesCache.getOrWait([session, crud.id], "write-only"));
        return result.map((crud2) => app._clientTeamUserFromCrud(crud2));
      },
      useUsers() {
        const result = (0, import_common3.useAsyncCache)(app._teamMemberProfilesCache, [session, crud.id], "team.useUsers()");
        return result.map((crud2) => app._clientTeamUserFromCrud(crud2));
      },
      async listInvitations() {
        const result = import_results.Result.orThrow(await app._teamInvitationsCache.getOrWait([session, crud.id], "write-only"));
        return result.map((crud2) => app._clientTeamInvitationFromCrud(session, crud2));
      },
      useInvitations() {
        const result = (0, import_common3.useAsyncCache)(app._teamInvitationsCache, [session, crud.id], "team.useInvitations()");
        return result.map((crud2) => app._clientTeamInvitationFromCrud(session, crud2));
      },
      async update(data) {
        await app._interface.updateTeam({ data: (0, import_teams.teamUpdateOptionsToCrud)(data), teamId: crud.id }, session);
        await app._currentUserTeamsCache.refresh([session]);
      },
      async delete() {
        await app._interface.deleteTeam(crud.id, session);
        await app._currentUserTeamsCache.refresh([session]);
      },
      useApiKeys() {
        const result = (0, import_common3.useAsyncCache)(app._teamApiKeysCache, [session, crud.id], "team.useApiKeys()");
        return result.map((crud2) => app._clientApiKeyFromCrud(session, crud2));
      },
      async listApiKeys() {
        const results = import_results.Result.orThrow(await app._teamApiKeysCache.getOrWait([session, crud.id], "write-only"));
        return results.map((crud2) => app._clientApiKeyFromCrud(session, crud2));
      },
      async createApiKey(options) {
        const result = await app._interface.createProjectApiKey(
          await (0, import_api_keys.apiKeyCreationOptionsToCrud)("team", crud.id, options),
          session,
          "client"
        );
        await app._teamApiKeysCache.refresh([session, crud.id]);
        return app._clientApiKeyFromCrud(session, result);
      }
    };
  }
  _clientContactChannelFromCrud(crud, session) {
    const app = this;
    return {
      id: crud.id,
      value: crud.value,
      type: crud.type,
      isVerified: crud.is_verified,
      isPrimary: crud.is_primary,
      usedForAuth: crud.used_for_auth,
      async sendVerificationEmail(options) {
        await app._interface.sendCurrentUserContactChannelVerificationEmail(
          crud.id,
          options?.callbackUrl || (0, import_url.constructRedirectUrl)(app.urls.emailVerification, "callbackUrl"),
          session
        );
      },
      async update(data) {
        await app._interface.updateClientContactChannel(crud.id, (0, import_contact_channels.contactChannelUpdateOptionsToCrud)(data), session);
        await app._clientContactChannelsCache.refresh([session]);
      },
      async delete() {
        await app._interface.deleteClientContactChannel(crud.id, session);
        await app._clientContactChannelsCache.refresh([session]);
      }
    };
  }
  _createAuth(session) {
    const app = this;
    return {
      _internalSession: session,
      currentSession: {
        async getTokens() {
          const tokens = await session.getOrFetchLikelyValidTokens(2e4);
          return {
            accessToken: tokens?.accessToken.token ?? null,
            refreshToken: tokens?.refreshToken?.token ?? null
          };
        }
      },
      async getAuthHeaders() {
        return {
          "x-stack-auth": JSON.stringify(await this.getAuthJson())
        };
      },
      async getAuthJson() {
        const tokens = await this.currentSession.getTokens();
        return tokens;
      },
      async registerPasskey(options) {
        const hostname = (await app._getCurrentUrl())?.hostname;
        if (!hostname) {
          throw new import_errors.StackAssertionError("hostname must be provided if the Stack App does not have a redirect method");
        }
        const initiationResult = await app._interface.initiatePasskeyRegistration({}, session);
        if (initiationResult.status !== "ok") {
          return import_results.Result.error(new import_stack_shared.KnownErrors.PasskeyRegistrationFailed("Failed to get initiation options for passkey registration"));
        }
        const { options_json, code } = initiationResult.data;
        if (options_json.rp.id !== "THIS_VALUE_WILL_BE_REPLACED.example.com") {
          throw new import_errors.StackAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options_json.rp.id}`);
        }
        options_json.rp.id = hostname;
        let attResp;
        try {
          attResp = await (0, import_browser.startRegistration)({ optionsJSON: options_json });
        } catch (error) {
          if (error instanceof import_browser.WebAuthnError) {
            return import_results.Result.error(new import_stack_shared.KnownErrors.PasskeyWebAuthnError(error.message, error.name));
          } else {
            (0, import_errors.captureError)("passkey-registration-failed", error);
            return import_results.Result.error(new import_stack_shared.KnownErrors.PasskeyRegistrationFailed("Failed to start passkey registration due to unknown error"));
          }
        }
        const registrationResult = await app._interface.registerPasskey({ credential: attResp, code }, session);
        await app._refreshUser(session);
        return registrationResult;
      },
      signOut(options) {
        return app._signOut(session, options);
      }
    };
  }
  _editableTeamProfileFromCrud(crud, session) {
    const app = this;
    return {
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      async update(update) {
        await app._interface.updateTeamMemberProfile({
          teamId: crud.team_id,
          userId: crud.user_id,
          profile: {
            display_name: update.displayName,
            profile_image_url: update.profileImageUrl
          }
        }, session);
        await app._currentUserTeamProfileCache.refresh([session, crud.team_id]);
      }
    };
  }
  _createBaseUser(crud) {
    return {
      id: crud.id,
      displayName: crud.display_name,
      primaryEmail: crud.primary_email,
      primaryEmailVerified: crud.primary_email_verified,
      profileImageUrl: crud.profile_image_url,
      signedUpAt: new Date(crud.signed_up_at_millis),
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      hasPassword: crud.has_password,
      emailAuthEnabled: crud.auth_with_email,
      otpAuthEnabled: crud.otp_auth_enabled,
      oauthProviders: crud.oauth_providers,
      passkeyAuthEnabled: crud.passkey_auth_enabled,
      isMultiFactorRequired: crud.requires_totp_mfa,
      isAnonymous: crud.is_anonymous,
      toClientJson() {
        return crud;
      }
    };
  }
  _createUserExtraFromCurrent(crud, session) {
    const app = this;
    async function getConnectedAccount(id, options) {
      const scopeString = options?.scopes?.join(" ");
      return import_results.Result.orThrow(await app._currentUserOAuthConnectionCache.getOrWait([session, id, scopeString || "", options?.or === "redirect"], "write-only"));
    }
    function useConnectedAccount(id, options) {
      const scopeString = options?.scopes?.join(" ");
      return (0, import_common3.useAsyncCache)(app._currentUserOAuthConnectionCache, [session, id, scopeString || "", options?.or === "redirect"], "user.useConnectedAccount()");
    }
    return {
      async getActiveSessions() {
        const sessions = await app._interface.listSessions(session);
        return sessions.items.map((crud2) => app._clientSessionFromCrud(crud2));
      },
      async revokeSession(sessionId) {
        await app._interface.deleteSession(sessionId, session);
      },
      setDisplayName(displayName) {
        return this.update({ displayName });
      },
      setClientMetadata(metadata) {
        return this.update({ clientMetadata: metadata });
      },
      async setSelectedTeam(team) {
        await this.update({ selectedTeamId: team?.id ?? null });
      },
      getConnectedAccount,
      useConnectedAccount,
      // THIS_LINE_PLATFORM react-like
      async getTeam(teamId) {
        const teams = await this.listTeams();
        return teams.find((t) => t.id === teamId) ?? null;
      },
      useTeam(teamId) {
        const teams = this.useTeams();
        return (0, import_react2.useMemo)(() => {
          return teams.find((t) => t.id === teamId) ?? null;
        }, [teams, teamId]);
      },
      async listTeams() {
        const teams = import_results.Result.orThrow(await app._currentUserTeamsCache.getOrWait([session], "write-only"));
        return teams.map((crud2) => app._clientTeamFromCrud(crud2, session));
      },
      useTeams() {
        const teams = (0, import_common3.useAsyncCache)(app._currentUserTeamsCache, [session], "user.useTeams()");
        return (0, import_react2.useMemo)(() => teams.map((crud2) => app._clientTeamFromCrud(crud2, session)), [teams]);
      },
      async createTeam(data) {
        const crud2 = await app._interface.createClientTeam((0, import_teams.teamCreateOptionsToCrud)(data, "me"), session);
        await app._currentUserTeamsCache.refresh([session]);
        await this.update({ selectedTeamId: crud2.id });
        return app._clientTeamFromCrud(crud2, session);
      },
      async leaveTeam(team) {
        await app._interface.leaveTeam(team.id, session);
      },
      async listPermissions(scopeOrOptions, options) {
        if (scopeOrOptions && "id" in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = import_results.Result.orThrow(await app._currentUserPermissionsCache.getOrWait([session, scope.id, recursive], "write-only"));
          return permissions.map((crud2) => app._clientPermissionFromCrud(crud2));
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = import_results.Result.orThrow(await app._currentUserProjectPermissionsCache.getOrWait([session, recursive], "write-only"));
          return permissions.map((crud2) => app._clientPermissionFromCrud(crud2));
        }
      },
      usePermissions(scopeOrOptions, options) {
        if (scopeOrOptions && "id" in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = (0, import_common3.useAsyncCache)(app._currentUserPermissionsCache, [session, scope.id, recursive], "user.usePermissions()");
          return (0, import_react2.useMemo)(() => permissions.map((crud2) => app._clientPermissionFromCrud(crud2)), [permissions]);
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = (0, import_common3.useAsyncCache)(app._currentUserProjectPermissionsCache, [session, recursive], "user.usePermissions()");
          return (0, import_react2.useMemo)(() => permissions.map((crud2) => app._clientPermissionFromCrud(crud2)), [permissions]);
        }
      },
      usePermission(scopeOrPermissionId, permissionId) {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== "string") {
          const scope = scopeOrPermissionId;
          const permissions = this.usePermissions(scope);
          return (0, import_react2.useMemo)(() => permissions.find((p) => p.id === permissionId) ?? null, [permissions, permissionId]);
        } else {
          const pid = scopeOrPermissionId;
          const permissions = this.usePermissions();
          return (0, import_react2.useMemo)(() => permissions.find((p) => p.id === pid) ?? null, [permissions, pid]);
        }
      },
      async getPermission(scopeOrPermissionId, permissionId) {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== "string") {
          const scope = scopeOrPermissionId;
          const permissions = await this.listPermissions(scope);
          return permissions.find((p) => p.id === permissionId) ?? null;
        } else {
          const pid = scopeOrPermissionId;
          const permissions = await this.listPermissions();
          return permissions.find((p) => p.id === pid) ?? null;
        }
      },
      async hasPermission(scopeOrPermissionId, permissionId) {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== "string") {
          const scope = scopeOrPermissionId;
          return await this.getPermission(scope, permissionId) !== null;
        } else {
          const pid = scopeOrPermissionId;
          return await this.getPermission(pid) !== null;
        }
      },
      async update(update) {
        return await app._updateClientUser(update, session);
      },
      async sendVerificationEmail(options) {
        if (!crud.primary_email) {
          throw new import_errors.StackAssertionError("User does not have a primary email");
        }
        return await app._interface.sendVerificationEmail(
          crud.primary_email,
          options?.callbackUrl ?? (0, import_url.constructRedirectUrl)(app.urls.emailVerification, "callbackUrl"),
          session
        );
      },
      async updatePassword(options) {
        const result = await app._interface.updatePassword(options, session);
        await app._currentUserCache.refresh([session]);
        return result;
      },
      async setPassword(options) {
        const result = await app._interface.setPassword(options, session);
        await app._currentUserCache.refresh([session]);
        return result;
      },
      selectedTeam: crud.selected_team && this._clientTeamFromCrud(crud.selected_team, session),
      async getTeamProfile(team) {
        const result = import_results.Result.orThrow(await app._currentUserTeamProfileCache.getOrWait([session, team.id], "write-only"));
        return app._editableTeamProfileFromCrud(result, session);
      },
      useTeamProfile(team) {
        const result = (0, import_common3.useAsyncCache)(app._currentUserTeamProfileCache, [session, team.id], "user.useTeamProfile()");
        return app._editableTeamProfileFromCrud(result, session);
      },
      async delete() {
        await app._interface.deleteCurrentUser(session);
        session.markInvalid();
      },
      async listContactChannels() {
        const result = import_results.Result.orThrow(await app._clientContactChannelsCache.getOrWait([session], "write-only"));
        return result.map((crud2) => app._clientContactChannelFromCrud(crud2, session));
      },
      useContactChannels() {
        const result = (0, import_common3.useAsyncCache)(app._clientContactChannelsCache, [session], "user.useContactChannels()");
        return result.map((crud2) => app._clientContactChannelFromCrud(crud2, session));
      },
      async createContactChannel(data) {
        const crud2 = await app._interface.createClientContactChannel((0, import_contact_channels.contactChannelCreateOptionsToCrud)("me", data), session);
        await app._clientContactChannelsCache.refresh([session]);
        return app._clientContactChannelFromCrud(crud2, session);
      },
      useApiKeys() {
        const result = (0, import_common3.useAsyncCache)(app._userApiKeysCache, [session], "user.useApiKeys()");
        return result.map((crud2) => app._clientApiKeyFromCrud(session, crud2));
      },
      async listApiKeys() {
        const results = await app._interface.listProjectApiKeys({ user_id: "me" }, session, "client");
        return results.map((crud2) => app._clientApiKeyFromCrud(session, crud2));
      },
      async createApiKey(options) {
        const result = await app._interface.createProjectApiKey(
          await (0, import_api_keys.apiKeyCreationOptionsToCrud)("user", "me", options),
          session,
          "client"
        );
        await app._userApiKeysCache.refresh([session]);
        return app._clientApiKeyFromCrud(session, result);
      }
    };
  }
  _createInternalUserExtra(session) {
    const app = this;
    this._ensureInternalProject();
    return {
      createProject(newProject) {
        return app._createProject(session, newProject);
      },
      listOwnedProjects() {
        return app._listOwnedProjects(session);
      },
      useOwnedProjects() {
        return app._useOwnedProjects(session);
      }
    };
  }
  _currentUserFromCrud(crud, session) {
    const currentUser = {
      ...this._createBaseUser(crud),
      ...this._createAuth(session),
      ...this._createUserExtraFromCurrent(crud, session),
      ...this._isInternalProject() ? this._createInternalUserExtra(session) : {}
    };
    Object.freeze(currentUser);
    return currentUser;
  }
  _clientSessionFromCrud(crud) {
    return {
      id: crud.id,
      userId: crud.user_id,
      createdAt: new Date(crud.created_at),
      isImpersonation: crud.is_impersonation,
      lastUsedAt: crud.last_used_at ? new Date(crud.last_used_at) : void 0,
      isCurrentSession: crud.is_current_session ?? false,
      geoInfo: crud.last_used_at_end_user_ip_info
    };
  }
  _getOwnedAdminApp(forProjectId, session) {
    if (!this._ownedAdminApps.has([session, forProjectId])) {
      this._ownedAdminApps.set([session, forProjectId], new __StackClientAppImplIncomplete.LazyStackAdminAppImpl.value({
        baseUrl: this._interface.options.getBaseUrl(),
        projectId: forProjectId,
        tokenStore: null,
        projectOwnerSession: session,
        noAutomaticPrefetch: true
      }));
    }
    return this._ownedAdminApps.get([session, forProjectId]);
  }
  get projectId() {
    return this._interface.projectId;
  }
  async _isTrusted(url) {
    return (0, import_urls.isRelative)(url);
  }
  get urls() {
    return (0, import_common2.getUrls)(this._urlOptions);
  }
  async _getCurrentUrl() {
    if (this._redirectMethod === "none") {
      return null;
    }
    return new URL(window.location.href);
  }
  async _redirectTo(options) {
    if (this._redirectMethod === "none") {
      return;
    } else if (typeof this._redirectMethod === "object" && this._redirectMethod.navigate) {
      this._redirectMethod.navigate(options.url.toString());
    } else {
      if (options.replace) {
        window.location.replace(options.url);
      } else {
        window.location.assign(options.url);
      }
    }
    await (0, import_promises.wait)(2e3);
  }
  useNavigate() {
    if (typeof this._redirectMethod === "object") {
      return this._redirectMethod.useNavigate();
    } else if (this._redirectMethod === "window") {
      return (to) => window.location.assign(to);
    } else {
      return (to) => {
      };
    }
  }
  async _redirectIfTrusted(url, options) {
    if (!await this._isTrusted(url)) {
      throw new Error(`Redirect URL ${url} is not trusted; should be relative.`);
    }
    return await this._redirectTo({ url, ...options });
  }
  async _redirectToHandler(handlerName, options) {
    let url = this.urls[handlerName];
    if (!url) {
      throw new Error(`No URL for handler name ${handlerName}`);
    }
    if (!options?.noRedirectBack) {
      if (handlerName === "afterSignIn" || handlerName === "afterSignUp") {
        if (isReactServer || typeof window === "undefined") {
        } else {
          const queryParams = new URLSearchParams(window.location.search);
          url = queryParams.get("after_auth_return_to") || url;
        }
      } else if (handlerName === "signIn" || handlerName === "signUp") {
        if (isReactServer || typeof window === "undefined") {
        } else {
          const currentUrl = new URL(window.location.href);
          const nextUrl = new URL(url, currentUrl);
          if (currentUrl.searchParams.has("after_auth_return_to")) {
            nextUrl.searchParams.set("after_auth_return_to", currentUrl.searchParams.get("after_auth_return_to"));
          } else if (currentUrl.protocol === nextUrl.protocol && currentUrl.host === nextUrl.host) {
            nextUrl.searchParams.set("after_auth_return_to", (0, import_urls.getRelativePart)(currentUrl));
          }
          url = (0, import_urls.getRelativePart)(nextUrl);
        }
      }
    }
    await this._redirectIfTrusted(url, options);
  }
  async redirectToSignIn(options) {
    return await this._redirectToHandler("signIn", options);
  }
  async redirectToSignUp(options) {
    return await this._redirectToHandler("signUp", options);
  }
  async redirectToSignOut(options) {
    return await this._redirectToHandler("signOut", options);
  }
  async redirectToEmailVerification(options) {
    return await this._redirectToHandler("emailVerification", options);
  }
  async redirectToPasswordReset(options) {
    return await this._redirectToHandler("passwordReset", options);
  }
  async redirectToForgotPassword(options) {
    return await this._redirectToHandler("forgotPassword", options);
  }
  async redirectToHome(options) {
    return await this._redirectToHandler("home", options);
  }
  async redirectToOAuthCallback(options) {
    return await this._redirectToHandler("oauthCallback", options);
  }
  async redirectToMagicLinkCallback(options) {
    return await this._redirectToHandler("magicLinkCallback", options);
  }
  async redirectToAfterSignIn(options) {
    return await this._redirectToHandler("afterSignIn", options);
  }
  async redirectToAfterSignUp(options) {
    return await this._redirectToHandler("afterSignUp", options);
  }
  async redirectToAfterSignOut(options) {
    return await this._redirectToHandler("afterSignOut", options);
  }
  async redirectToAccountSettings(options) {
    return await this._redirectToHandler("accountSettings", options);
  }
  async redirectToError(options) {
    return await this._redirectToHandler("error", options);
  }
  async redirectToTeamInvitation(options) {
    return await this._redirectToHandler("teamInvitation", options);
  }
  async sendForgotPasswordEmail(email, options) {
    return await this._interface.sendForgotPasswordEmail(email, options?.callbackUrl ?? (0, import_url.constructRedirectUrl)(this.urls.passwordReset, "callbackUrl"));
  }
  async sendMagicLinkEmail(email, options) {
    return await this._interface.sendMagicLinkEmail(email, options?.callbackUrl ?? (0, import_url.constructRedirectUrl)(this.urls.magicLinkCallback, "callbackUrl"));
  }
  async resetPassword(options) {
    return await this._interface.resetPassword(options);
  }
  async verifyPasswordResetCode(code) {
    return await this._interface.verifyPasswordResetCode(code);
  }
  async verifyTeamInvitationCode(code) {
    return await this._interface.acceptTeamInvitation({
      type: "check",
      code,
      session: await this._getSession()
    });
  }
  async acceptTeamInvitation(code) {
    const result = await this._interface.acceptTeamInvitation({
      type: "use",
      code,
      session: await this._getSession()
    });
    if (result.status === "ok") {
      return import_results.Result.ok(void 0);
    } else {
      return import_results.Result.error(result.error);
    }
  }
  async getTeamInvitationDetails(code) {
    const result = await this._interface.acceptTeamInvitation({
      type: "details",
      code,
      session: await this._getSession()
    });
    if (result.status === "ok") {
      return import_results.Result.ok({ teamDisplayName: result.data.team_display_name });
    } else {
      return import_results.Result.error(result.error);
    }
  }
  async verifyEmail(code) {
    const result = await this._interface.verifyEmail(code);
    await this._currentUserCache.refresh([await this._getSession()]);
    await this._clientContactChannelsCache.refresh([await this._getSession()]);
    return result;
  }
  async getUser(options) {
    this._ensurePersistentTokenStore(options?.tokenStore);
    const session = await this._getSession(options?.tokenStore);
    let crud = import_results.Result.orThrow(await this._currentUserCache.getOrWait([session], "write-only"));
    if (crud?.is_anonymous && options?.or !== "anonymous" && options?.or !== "anonymous-if-exists") {
      crud = null;
    }
    if (crud === null) {
      switch (options?.or) {
        case "redirect": {
          await this.redirectToSignIn({ replace: true });
          break;
        }
        case "throw": {
          throw new Error("User is not signed in but getUser was called with { or: 'throw' }");
        }
        case "anonymous": {
          const tokens = await this._signUpAnonymously();
          return await this.getUser({ tokenStore: tokens, or: "anonymous-if-exists" }) ?? (0, import_errors.throwErr)("Something went wrong while signing up anonymously");
        }
        case void 0:
        case "anonymous-if-exists":
        case "return-null": {
          return null;
        }
      }
    }
    return crud && this._currentUserFromCrud(crud, session);
  }
  useUser(options) {
    this._ensurePersistentTokenStore(options?.tokenStore);
    const session = this._useSession(options?.tokenStore);
    let crud = (0, import_common3.useAsyncCache)(this._currentUserCache, [session], "useUser()");
    if (crud?.is_anonymous && options?.or !== "anonymous" && options?.or !== "anonymous-if-exists") {
      crud = null;
    }
    if (crud === null) {
      switch (options?.or) {
        case "redirect": {
          (0, import_promises.runAsynchronously)(this.redirectToSignIn({ replace: true }));
          (0, import_react.suspend)();
          throw new import_errors.StackAssertionError("suspend should never return");
        }
        case "throw": {
          throw new Error("User is not signed in but useUser was called with { or: 'throw' }");
        }
        case "anonymous": {
          (0, import_promises.runAsynchronously)(async () => {
            await this._signUpAnonymously();
            if (typeof window !== "undefined") {
              window.location.reload();
            }
          });
          (0, import_react.suspend)();
          throw new import_errors.StackAssertionError("suspend should never return");
        }
        case void 0:
        case "anonymous-if-exists":
        case "return-null": {
        }
      }
    }
    return (0, import_react2.useMemo)(() => {
      return crud && this._currentUserFromCrud(crud, session);
    }, [crud, session, options?.or]);
  }
  async _updateClientUser(update, session) {
    const res = await this._interface.updateClientUser((0, import_users.userUpdateOptionsToCrud)(update), session);
    await this._refreshUser(session);
    return res;
  }
  async signInWithOAuth(provider) {
    if (typeof window === "undefined") {
      throw new Error("signInWithOAuth can currently only be called in a browser environment");
    }
    this._ensurePersistentTokenStore();
    await (0, import_auth.signInWithOAuth)(
      this._interface,
      {
        provider,
        redirectUrl: this.urls.oauthCallback,
        errorRedirectUrl: this.urls.error,
        providerScope: this._oauthScopesOnSignIn[provider]?.join(" ")
      }
    );
  }
  /**
   * @deprecated
   * TODO remove
   */
  async _experimentalMfa(error, session) {
    const otp = prompt("Please enter the six-digit TOTP code from your authenticator app.");
    if (!otp) {
      throw new import_stack_shared.KnownErrors.InvalidTotpCode();
    }
    return await this._interface.totpMfa(
      error.details?.attempt_code ?? (0, import_errors.throwErr)("attempt code missing"),
      otp,
      session
    );
  }
  /**
   * @deprecated
   * TODO remove
   */
  async _catchMfaRequiredError(callback) {
    try {
      return await callback();
    } catch (e) {
      if (import_stack_shared.KnownErrors.MultiFactorAuthenticationRequired.isInstance(e)) {
        return import_results.Result.ok(await this._experimentalMfa(e, await this._getSession()));
      }
      throw e;
    }
  }
  async signInWithCredential(options) {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await this._interface.signInWithCredential(options.email, options.password, session);
      });
    } catch (e) {
      if (import_stack_shared.KnownErrors.InvalidTotpCode.isInstance(e)) {
        return import_results.Result.error(e);
      }
      throw e;
    }
    if (result.status === "ok") {
      await this._signInToAccountWithTokens(result.data);
      if (!options.noRedirect) {
        await this.redirectToAfterSignIn({ replace: true });
      }
      return import_results.Result.ok(void 0);
    } else {
      return import_results.Result.error(result.error);
    }
  }
  async signUpWithCredential(options) {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    const emailVerificationRedirectUrl = options.verificationCallbackUrl ?? (0, import_url.constructRedirectUrl)(this.urls.emailVerification, "verificationCallbackUrl");
    const result = await this._interface.signUpWithCredential(
      options.email,
      options.password,
      emailVerificationRedirectUrl,
      session
    );
    if (result.status === "ok") {
      await this._signInToAccountWithTokens(result.data);
      if (!options.noRedirect) {
        await this.redirectToAfterSignUp({ replace: true });
      }
      return import_results.Result.ok(void 0);
    } else {
      return import_results.Result.error(result.error);
    }
  }
  async _signUpAnonymously() {
    this._ensurePersistentTokenStore();
    if (!this._anonymousSignUpInProgress) {
      this._anonymousSignUpInProgress = (async () => {
        this._ensurePersistentTokenStore();
        const session = await this._getSession();
        const result = await this._interface.signUpAnonymously(session);
        if (result.status === "ok") {
          await this._signInToAccountWithTokens(result.data);
        } else {
          throw new import_errors.StackAssertionError("signUpAnonymously() should never return an error");
        }
        this._anonymousSignUpInProgress = null;
        return result.data;
      })();
    }
    return await this._anonymousSignUpInProgress;
  }
  async signInWithMagicLink(code, options) {
    this._ensurePersistentTokenStore();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await this._interface.signInWithMagicLink(code);
      });
    } catch (e) {
      if (import_stack_shared.KnownErrors.InvalidTotpCode.isInstance(e)) {
        return import_results.Result.error(e);
      }
      throw e;
    }
    if (result.status === "ok") {
      await this._signInToAccountWithTokens(result.data);
      if (!options?.noRedirect) {
        if (result.data.newUser) {
          await this.redirectToAfterSignUp({ replace: true });
        } else {
          await this.redirectToAfterSignIn({ replace: true });
        }
      }
      return import_results.Result.ok(void 0);
    } else {
      return import_results.Result.error(result.error);
    }
  }
  /**
   * Initiates a CLI authentication process that allows a command line application
   * to get a refresh token for a user's account.
   *
   * This process works as follows:
   * 1. The CLI app calls this method, which initiates the auth process with the server
   * 2. The server returns a polling code and a login code
   * 3. The CLI app opens a browser window to the appUrl with the login code as a parameter
   * 4. The user logs in through the browser and confirms the authorization
   * 5. The CLI app polls for the refresh token using the polling code
   *
   * @param options Options for the CLI login
   * @param options.appUrl The URL of the app that will handle the CLI auth confirmation
   * @param options.expiresInMillis Optional duration in milliseconds before the auth attempt expires (default: 2 hours)
   * @param options.maxAttempts Optional maximum number of polling attempts (default: Infinity)
   * @param options.waitTimeMillis Optional time to wait between polling attempts (default: 2 seconds)
   * @param options.promptLink Optional function to call with the login URL to prompt the user to open the browser
   * @returns Result containing either the refresh token or an error
   */
  async promptCliLogin(options) {
    const response = await this._interface.sendClientRequest(
      "/auth/cli",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          expires_in_millis: options.expiresInMillis
        })
      },
      null
    );
    if (!response.ok) {
      return import_results.Result.error(new import_stack_shared.KnownErrors.CliAuthError(`Failed to initiate CLI auth: ${response.status} ${await response.text()}`));
    }
    const initResult = await response.json();
    const pollingCode = initResult.polling_code;
    const loginCode = initResult.login_code;
    const url = `${options.appUrl}/handler/cli-auth-confirm?login_code=${encodeURIComponent(loginCode)}`;
    if (options.promptLink) {
      options.promptLink(url);
    } else {
      console.log(`Please visit the following URL to authenticate:
${url}`);
    }
    let attempts = 0;
    while (attempts < (options.maxAttempts ?? Infinity)) {
      attempts++;
      const pollResponse = await this._interface.sendClientRequest("/auth/cli/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          polling_code: pollingCode
        })
      }, null);
      if (!pollResponse.ok) {
        return import_results.Result.error(new import_stack_shared.KnownErrors.CliAuthError(`Failed to initiate CLI auth: ${pollResponse.status} ${await pollResponse.text()}`));
      }
      const pollResult = await pollResponse.json();
      if (pollResponse.status === 201 && pollResult.status === "success") {
        return import_results.Result.ok(pollResult.refresh_token);
      }
      if (pollResult.status === "waiting") {
        await (0, import_promises.wait)(options.waitTimeMillis ?? 2e3);
        continue;
      }
      if (pollResult.status === "expired") {
        return import_results.Result.error(new import_stack_shared.KnownErrors.CliAuthExpiredError("CLI authentication request expired. Please try again."));
      }
      if (pollResult.status === "used") {
        return import_results.Result.error(new import_stack_shared.KnownErrors.CliAuthUsedError("This authentication token has already been used."));
      }
      return import_results.Result.error(new import_stack_shared.KnownErrors.CliAuthError(`Unexpected status from CLI auth polling: ${pollResult.status}`));
    }
    return import_results.Result.error(new import_stack_shared.KnownErrors.CliAuthError("Timed out waiting for CLI authentication."));
  }
  async signInWithPasskey() {
    this._ensurePersistentTokenStore();
    const session = await this._getSession();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        const initiationResult = await this._interface.initiatePasskeyAuthentication({}, session);
        if (initiationResult.status !== "ok") {
          return import_results.Result.error(new import_stack_shared.KnownErrors.PasskeyAuthenticationFailed("Failed to get initiation options for passkey authentication"));
        }
        const { options_json, code } = initiationResult.data;
        if (options_json.rpId !== "THIS_VALUE_WILL_BE_REPLACED.example.com") {
          throw new import_errors.StackAssertionError(`Expected returned RP ID from server to equal sentinel, but found ${options_json.rpId}`);
        }
        options_json.rpId = window.location.hostname;
        const authentication_response = await (0, import_browser.startAuthentication)({ optionsJSON: options_json });
        return await this._interface.signInWithPasskey({ authentication_response, code });
      });
    } catch (error) {
      if (error instanceof import_browser.WebAuthnError) {
        return import_results.Result.error(new import_stack_shared.KnownErrors.PasskeyWebAuthnError(error.message, error.name));
      } else {
        return import_results.Result.error(new import_stack_shared.KnownErrors.PasskeyAuthenticationFailed("Failed to sign in with passkey"));
      }
    }
    if (result.status === "ok") {
      await this._signInToAccountWithTokens(result.data);
      await this.redirectToAfterSignIn({ replace: true });
      return import_results.Result.ok(void 0);
    } else {
      return import_results.Result.error(result.error);
    }
  }
  async callOAuthCallback() {
    if (typeof window === "undefined") {
      throw new Error("callOAuthCallback can currently only be called in a browser environment");
    }
    this._ensurePersistentTokenStore();
    let result;
    try {
      result = await this._catchMfaRequiredError(async () => {
        return await (0, import_auth.callOAuthCallback)(this._interface, this.urls.oauthCallback);
      });
    } catch (e) {
      if (import_stack_shared.KnownErrors.InvalidTotpCode.isInstance(e)) {
        alert("Invalid TOTP code. Please try signing in again.");
        return false;
      } else {
        throw e;
      }
    }
    if (result.status === "ok" && result.data) {
      await this._signInToAccountWithTokens(result.data);
      if ("afterCallbackRedirectUrl" in result.data && result.data.afterCallbackRedirectUrl) {
        await this._redirectTo({ url: result.data.afterCallbackRedirectUrl, replace: true });
        return true;
      } else if (result.data.newUser) {
        await this.redirectToAfterSignUp({ replace: true });
        return true;
      } else {
        await this.redirectToAfterSignIn({ replace: true });
        return true;
      }
    }
    return false;
  }
  async _signOut(session, options) {
    await import_stores.storeLock.withWriteLock(async () => {
      await this._interface.signOut(session);
      if (options?.redirectUrl) {
        await this._redirectTo({ url: options.redirectUrl, replace: true });
      } else {
        await this.redirectToAfterSignOut();
      }
    });
  }
  async signOut(options) {
    const user = await this.getUser();
    if (user) {
      await user.signOut(options);
    }
  }
  async getProject() {
    const crud = import_results.Result.orThrow(await this._currentProjectCache.getOrWait([], "write-only"));
    return this._clientProjectFromCrud(crud);
  }
  useProject() {
    const crud = (0, import_common3.useAsyncCache)(this._currentProjectCache, [], "useProject()");
    return (0, import_react2.useMemo)(() => this._clientProjectFromCrud(crud), [crud]);
  }
  async _listOwnedProjects(session) {
    this._ensureInternalProject();
    const crud = import_results.Result.orThrow(await this._ownedProjectsCache.getOrWait([session], "write-only"));
    return crud.map((j) => this._getOwnedAdminApp(j.id, session)._adminOwnedProjectFromCrud(
      j,
      () => this._refreshOwnedProjects(session)
    ));
  }
  _useOwnedProjects(session) {
    this._ensureInternalProject();
    const projects = (0, import_common3.useAsyncCache)(this._ownedProjectsCache, [session], "useOwnedProjects()");
    return (0, import_react2.useMemo)(() => projects.map((j) => this._getOwnedAdminApp(j.id, session)._adminOwnedProjectFromCrud(
      j,
      () => this._refreshOwnedProjects(session)
    )), [projects]);
  }
  async _createProject(session, newProject) {
    this._ensureInternalProject();
    const crud = await this._interface.createProject((0, import_projects.adminProjectCreateOptionsToCrud)(newProject), session);
    const res = this._getOwnedAdminApp(crud.id, session)._adminOwnedProjectFromCrud(
      crud,
      () => this._refreshOwnedProjects(session)
    );
    await this._refreshOwnedProjects(session);
    return res;
  }
  async _refreshUser(session) {
    await this._refreshSession(session);
  }
  async _refreshSession(session) {
    await this._currentUserCache.refresh([session]);
  }
  async _refreshUsers() {
  }
  async _refreshProject() {
    await this._currentProjectCache.refresh([]);
  }
  async _refreshOwnedProjects(session) {
    await this._ownedProjectsCache.refresh([session]);
  }
  static get [import_common.stackAppInternalsSymbol]() {
    return {
      fromClientJson: (json) => {
        const providedCheckString = JSON.stringify((0, import_objects.omit)(json, [
          /* none currently */
        ]));
        const existing = allClientApps.get(json.uniqueIdentifier);
        if (existing) {
          const [existingCheckString, clientApp] = existing;
          if (existingCheckString !== void 0 && existingCheckString !== providedCheckString) {
            throw new import_errors.StackAssertionError("The provided app JSON does not match the configuration of the existing client app with the same unique identifier", { providedObj: json, existingString: existingCheckString });
          }
          return clientApp;
        }
        return new __StackClientAppImplIncomplete({
          ...json,
          checkString: providedCheckString
        });
      }
    };
  }
  get [import_common.stackAppInternalsSymbol]() {
    return {
      toClientJson: () => {
        if (!("publishableClientKey" in this._interface.options)) {
          throw new import_errors.StackAssertionError("Cannot serialize to JSON from an application without a publishable client key");
        }
        if (typeof this._redirectMethod !== "string") {
          throw new import_errors.StackAssertionError("Cannot serialize to JSON from an application with a non-string redirect method");
        }
        return {
          baseUrl: this._options.baseUrl,
          projectId: this.projectId,
          publishableClientKey: this._interface.options.publishableClientKey,
          tokenStore: this._tokenStoreInit,
          urls: this._urlOptions,
          oauthScopesOnSignIn: this._oauthScopesOnSignIn,
          uniqueIdentifier: this._getUniqueIdentifier(),
          redirectMethod: this._redirectMethod,
          extraRequestHeaders: this._options.extraRequestHeaders
        };
      },
      setCurrentUser: (userJsonPromise) => {
        (0, import_promises.runAsynchronously)(async () => {
          await this._currentUserCache.forceSetCachedValueAsync([await this._getSession()], import_results.Result.fromPromise(userJsonPromise));
        });
      },
      sendRequest: async (path, requestOptions, requestType = "client") => {
        return await this._interface.sendClientRequest(path, requestOptions, await this._getSession(), requestType);
      }
    };
  }
};
/**
 * There is a circular dependency between the admin app and the client app, as the former inherits from the latter and
 * the latter needs to use the former when creating a new instance of an internal project.
 *
 * To break it, we set the admin app here lazily instead of importing it directly. This variable is set by ./index.ts,
 * which imports both this file and ./admin-app-impl.ts.
 */
__StackClientAppImplIncomplete.LazyStackAdminAppImpl = { value: void 0 };
var _StackClientAppImplIncomplete = __StackClientAppImplIncomplete;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  _StackClientAppImplIncomplete
});
//# sourceMappingURL=client-app-impl.js.map