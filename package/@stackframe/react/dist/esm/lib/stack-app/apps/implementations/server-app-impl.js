// src/lib/stack-app/apps/implementations/server-app-impl.ts
import { KnownErrors, StackServerInterface } from "@stackframe/stack-shared";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { suspend } from "@stackframe/stack-shared/dist/utils/react";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { useMemo } from "react";
import { constructRedirectUrl } from "../../../../utils/url";
import { apiKeyCreationOptionsToCrud, apiKeyUpdateOptionsToCrud } from "../../api-keys";
import { serverContactChannelCreateOptionsToCrud, serverContactChannelUpdateOptionsToCrud } from "../../contact-channels";
import { serverTeamCreateOptionsToCrud, serverTeamUpdateOptionsToCrud } from "../../teams";
import { serverUserCreateOptionsToCrud, serverUserUpdateOptionsToCrud } from "../../users";
import { _StackClientAppImplIncomplete } from "./client-app-impl";
import { clientVersion, createCache, createCacheBySession, getBaseUrl, getDefaultProjectId, getDefaultPublishableClientKey, getDefaultSecretServerKey } from "./common";
import { useAsyncCache } from "./common";
var _StackServerAppImplIncomplete = class extends _StackClientAppImplIncomplete {
  constructor(options) {
    super("interface" in options ? {
      interface: options.interface,
      tokenStore: options.tokenStore,
      urls: options.urls,
      oauthScopesOnSignIn: options.oauthScopesOnSignIn
    } : {
      interface: new StackServerInterface({
        getBaseUrl: () => getBaseUrl(options.baseUrl),
        projectId: options.projectId ?? getDefaultProjectId(),
        extraRequestHeaders: options.extraRequestHeaders ?? {},
        clientVersion,
        publishableClientKey: options.publishableClientKey ?? getDefaultPublishableClientKey(),
        secretServerKey: options.secretServerKey ?? getDefaultSecretServerKey()
      }),
      baseUrl: options.baseUrl,
      extraRequestHeaders: options.extraRequestHeaders,
      projectId: options.projectId,
      publishableClientKey: options.publishableClientKey,
      tokenStore: options.tokenStore,
      urls: options.urls,
      oauthScopesOnSignIn: options.oauthScopesOnSignIn,
      redirectMethod: options.redirectMethod
    });
    // TODO override the client user cache to use the server user cache, so we save some requests
    this._currentServerUserCache = createCacheBySession(async (session) => {
      if (session.isKnownToBeInvalid()) {
        return null;
      }
      return await this._interface.getServerUserByToken(session);
    });
    this._serverUsersCache = createCache(async ([cursor, limit, orderBy, desc, query]) => {
      return await this._interface.listServerUsers({ cursor, limit, orderBy, desc, query });
    });
    this._serverUserCache = createCache(async ([userId]) => {
      const user = await this._interface.getServerUserById(userId);
      return Result.or(user, null);
    });
    this._serverTeamsCache = createCache(async ([userId]) => {
      return await this._interface.listServerTeams({ userId });
    });
    this._serverTeamUserPermissionsCache = createCache(async ([teamId, userId, recursive]) => {
      return await this._interface.listServerTeamPermissions({ teamId, userId, recursive }, null);
    });
    this._serverUserProjectPermissionsCache = createCache(async ([userId, recursive]) => {
      return await this._interface.listServerProjectPermissions({ userId, recursive }, null);
    });
    this._serverUserOAuthConnectionAccessTokensCache = createCache(
      async ([userId, providerId, scope]) => {
        try {
          const result = await this._interface.createServerProviderAccessToken(userId, providerId, scope || "");
          return { accessToken: result.access_token };
        } catch (err) {
          if (!(KnownErrors.OAuthConnectionDoesNotHaveRequiredScope.isInstance(err) || KnownErrors.OAuthConnectionNotConnectedToUser.isInstance(err))) {
            throw err;
          }
        }
        return null;
      }
    );
    this._serverUserOAuthConnectionCache = createCache(
      async ([userId, providerId, scope, redirect]) => {
        return await this._getUserOAuthConnectionCacheFn({
          getUser: async () => Result.orThrow(await this._serverUserCache.getOrWait([userId], "write-only")),
          getOrWaitOAuthToken: async () => Result.orThrow(await this._serverUserOAuthConnectionAccessTokensCache.getOrWait([userId, providerId, scope || ""], "write-only")),
          useOAuthToken: () => useAsyncCache(this._serverUserOAuthConnectionAccessTokensCache, [userId, providerId, scope || ""], "user.useConnectedAccount()"),
          providerId,
          scope,
          redirect,
          session: null
        });
      }
    );
    this._serverTeamMemberProfilesCache = createCache(
      async ([teamId]) => {
        return await this._interface.listServerTeamMemberProfiles({ teamId });
      }
    );
    this._serverTeamInvitationsCache = createCache(
      async ([teamId]) => {
        return await this._interface.listServerTeamInvitations({ teamId });
      }
    );
    this._serverUserTeamProfileCache = createCache(
      async ([teamId, userId]) => {
        return await this._interface.getServerTeamMemberProfile({ teamId, userId });
      }
    );
    this._serverContactChannelsCache = createCache(
      async ([userId]) => {
        return await this._interface.listServerContactChannels(userId);
      }
    );
    this._serverUserApiKeysCache = createCache(
      async ([userId]) => {
        const result = await this._interface.listProjectApiKeys({
          user_id: userId
        }, null, "server");
        return result;
      }
    );
    this._serverTeamApiKeysCache = createCache(
      async ([teamId]) => {
        const result = await this._interface.listProjectApiKeys({
          team_id: teamId
        }, null, "server");
        return result;
      }
    );
    this._serverCheckApiKeyCache = createCache(async ([type, apiKey]) => {
      const result = await this._interface.checkProjectApiKey(
        type,
        apiKey,
        null,
        "server"
      );
      return result;
    });
  }
  async _updateServerUser(userId, update) {
    const result = await this._interface.updateServerUser(userId, serverUserUpdateOptionsToCrud(update));
    await this._refreshUsers();
    return result;
  }
  _serverEditableTeamProfileFromCrud(crud) {
    const app = this;
    return {
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      async update(update) {
        await app._interface.updateServerTeamMemberProfile({
          teamId: crud.team_id,
          userId: crud.user_id,
          profile: {
            display_name: update.displayName,
            profile_image_url: update.profileImageUrl
          }
        });
        await app._serverUserTeamProfileCache.refresh([crud.team_id, crud.user_id]);
      }
    };
  }
  _serverContactChannelFromCrud(userId, crud) {
    const app = this;
    return {
      id: crud.id,
      value: crud.value,
      type: crud.type,
      isVerified: crud.is_verified,
      isPrimary: crud.is_primary,
      usedForAuth: crud.used_for_auth,
      async sendVerificationEmail(options) {
        await app._interface.sendServerContactChannelVerificationEmail(userId, crud.id, options?.callbackUrl ?? constructRedirectUrl(app.urls.emailVerification, "callbackUrl"));
      },
      async update(data) {
        await app._interface.updateServerContactChannel(userId, crud.id, serverContactChannelUpdateOptionsToCrud(data));
        await Promise.all([
          app._serverContactChannelsCache.refresh([userId]),
          app._serverUserCache.refresh([userId])
        ]);
      },
      async delete() {
        await app._interface.deleteServerContactChannel(userId, crud.id);
        await Promise.all([
          app._serverContactChannelsCache.refresh([userId]),
          app._serverUserCache.refresh([userId])
        ]);
      }
    };
  }
  _serverApiKeyFromCrud(crud) {
    return {
      ...this._baseApiKeyFromCrud(crud),
      async revoke() {
        await this.update({ revoked: true });
      },
      update: async (options) => {
        await this._interface.updateProjectApiKey(
          crud.type === "team" ? { team_id: crud.team_id } : { user_id: crud.user_id },
          crud.id,
          await apiKeyUpdateOptionsToCrud(crud.type, options),
          null,
          "server"
        );
        if (crud.type === "team") {
          await this._serverTeamApiKeysCache.refresh([crud.team_id]);
        } else {
          await this._serverUserApiKeysCache.refresh([crud.user_id]);
        }
      }
    };
  }
  _serverUserFromCrud(crud) {
    const app = this;
    async function getConnectedAccount(id, options) {
      const scopeString = options?.scopes?.join(" ");
      return Result.orThrow(await app._serverUserOAuthConnectionCache.getOrWait([crud.id, id, scopeString || "", options?.or === "redirect"], "write-only"));
    }
    function useConnectedAccount(id, options) {
      const scopeString = options?.scopes?.join(" ");
      return useAsyncCache(app._serverUserOAuthConnectionCache, [crud.id, id, scopeString || "", options?.or === "redirect"], "user.useConnectedAccount()");
    }
    return {
      ...super._createBaseUser(crud),
      lastActiveAt: new Date(crud.last_active_at_millis),
      serverMetadata: crud.server_metadata,
      async setPrimaryEmail(email, options) {
        await app._updateServerUser(crud.id, { primaryEmail: email, primaryEmailVerified: options?.verified });
      },
      async grantPermission(scopeOrPermissionId, permissionId) {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== "string" && permissionId) {
          const scope = scopeOrPermissionId;
          await app._interface.grantServerTeamUserPermission(scope.id, crud.id, permissionId);
          for (const recursive of [true, false]) {
            await app._serverTeamUserPermissionsCache.refresh([scope.id, crud.id, recursive]);
          }
        } else {
          const pId = scopeOrPermissionId;
          await app._interface.grantServerProjectPermission(crud.id, pId);
          for (const recursive of [true, false]) {
            await app._serverUserProjectPermissionsCache.refresh([crud.id, recursive]);
          }
        }
      },
      async revokePermission(scopeOrPermissionId, permissionId) {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== "string" && permissionId) {
          const scope = scopeOrPermissionId;
          await app._interface.revokeServerTeamUserPermission(scope.id, crud.id, permissionId);
          for (const recursive of [true, false]) {
            await app._serverTeamUserPermissionsCache.refresh([scope.id, crud.id, recursive]);
          }
        } else {
          const pId = scopeOrPermissionId;
          await app._interface.revokeServerProjectPermission(crud.id, pId);
          for (const recursive of [true, false]) {
            await app._serverUserProjectPermissionsCache.refresh([crud.id, recursive]);
          }
        }
      },
      async delete() {
        const res = await app._interface.deleteServerUser(crud.id);
        await app._refreshUsers();
        return res;
      },
      async createSession(options) {
        const tokens = await app._interface.createServerUserSession(crud.id, options.expiresInMillis ?? 1e3 * 60 * 60 * 24 * 365, options.isImpersonation ?? false);
        return {
          async getTokens() {
            return tokens;
          }
        };
      },
      async getActiveSessions() {
        const sessions = await app._interface.listServerSessions(crud.id);
        return sessions.map((session) => app._clientSessionFromCrud(session));
      },
      async revokeSession(sessionId) {
        await app._interface.deleteServerSession(sessionId);
      },
      async setDisplayName(displayName) {
        return await this.update({ displayName });
      },
      async setClientMetadata(metadata) {
        return await this.update({ clientMetadata: metadata });
      },
      async setClientReadOnlyMetadata(metadata) {
        return await this.update({ clientReadOnlyMetadata: metadata });
      },
      async setServerMetadata(metadata) {
        return await this.update({ serverMetadata: metadata });
      },
      async setSelectedTeam(team) {
        return await this.update({ selectedTeamId: team?.id ?? null });
      },
      getConnectedAccount,
      useConnectedAccount,
      // THIS_LINE_PLATFORM react-like
      selectedTeam: crud.selected_team ? app._serverTeamFromCrud(crud.selected_team) : null,
      async getTeam(teamId) {
        const teams = await this.listTeams();
        return teams.find((t) => t.id === teamId) ?? null;
      },
      useTeam(teamId) {
        const teams = this.useTeams();
        return useMemo(() => {
          return teams.find((t) => t.id === teamId) ?? null;
        }, [teams, teamId]);
      },
      async listTeams() {
        const teams = Result.orThrow(await app._serverTeamsCache.getOrWait([crud.id], "write-only"));
        return teams.map((t) => app._serverTeamFromCrud(t));
      },
      useTeams() {
        const teams = useAsyncCache(app._serverTeamsCache, [crud.id], "user.useTeams()");
        return useMemo(() => teams.map((t) => app._serverTeamFromCrud(t)), [teams]);
      },
      createTeam: async (data) => {
        const team = await app._interface.createServerTeam(serverTeamCreateOptionsToCrud({
          creatorUserId: crud.id,
          ...data
        }));
        await app._serverTeamsCache.refresh([void 0]);
        await app._updateServerUser(crud.id, { selectedTeamId: team.id });
        return app._serverTeamFromCrud(team);
      },
      leaveTeam: async (team) => {
        await app._interface.leaveServerTeam({ teamId: team.id, userId: crud.id });
      },
      async listPermissions(scopeOrOptions, options) {
        if (scopeOrOptions && "id" in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = Result.orThrow(await app._serverTeamUserPermissionsCache.getOrWait([scope.id, crud.id, recursive], "write-only"));
          return permissions.map((crud2) => app._serverPermissionFromCrud(crud2));
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = Result.orThrow(await app._serverUserProjectPermissionsCache.getOrWait([crud.id, recursive], "write-only"));
          return permissions.map((crud2) => app._serverPermissionFromCrud(crud2));
        }
      },
      usePermissions(scopeOrOptions, options) {
        if (scopeOrOptions && "id" in scopeOrOptions) {
          const scope = scopeOrOptions;
          const recursive = options?.recursive ?? true;
          const permissions = useAsyncCache(app._serverTeamUserPermissionsCache, [scope.id, crud.id, recursive], "user.usePermissions()");
          return useMemo(() => permissions.map((crud2) => app._serverPermissionFromCrud(crud2)), [permissions]);
        } else {
          const opts = scopeOrOptions;
          const recursive = opts?.recursive ?? true;
          const permissions = useAsyncCache(app._serverUserProjectPermissionsCache, [crud.id, recursive], "user.usePermissions()");
          return useMemo(() => permissions.map((crud2) => app._serverPermissionFromCrud(crud2)), [permissions]);
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
      usePermission(scopeOrPermissionId, permissionId) {
        if (scopeOrPermissionId && typeof scopeOrPermissionId !== "string") {
          const scope = scopeOrPermissionId;
          const permissions = this.usePermissions(scope);
          return useMemo(() => permissions.find((p) => p.id === permissionId) ?? null, [permissions, permissionId]);
        } else {
          const pid = scopeOrPermissionId;
          const permissions = this.usePermissions();
          return useMemo(() => permissions.find((p) => p.id === pid) ?? null, [permissions, pid]);
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
        await app._updateServerUser(crud.id, update);
      },
      async sendVerificationEmail() {
        return await app._checkFeatureSupport("sendVerificationEmail() on ServerUser", {});
      },
      async updatePassword(options) {
        const result = await app._interface.updatePassword(options);
        await app._serverUserCache.refresh([crud.id]);
        return result;
      },
      async setPassword(options) {
        const result = await this.update(options);
        await app._serverUserCache.refresh([crud.id]);
        return result;
      },
      async getTeamProfile(team) {
        const result = Result.orThrow(await app._serverUserTeamProfileCache.getOrWait([team.id, crud.id], "write-only"));
        return app._serverEditableTeamProfileFromCrud(result);
      },
      useTeamProfile(team) {
        const result = useAsyncCache(app._serverUserTeamProfileCache, [team.id, crud.id], "user.useTeamProfile()");
        return useMemo(() => app._serverEditableTeamProfileFromCrud(result), [result]);
      },
      async listContactChannels() {
        const result = Result.orThrow(await app._serverContactChannelsCache.getOrWait([crud.id], "write-only"));
        return result.map((data) => app._serverContactChannelFromCrud(crud.id, data));
      },
      useContactChannels() {
        const result = useAsyncCache(app._serverContactChannelsCache, [crud.id], "user.useContactChannels()");
        return useMemo(() => result.map((data) => app._serverContactChannelFromCrud(crud.id, data)), [result]);
      },
      createContactChannel: async (data) => {
        const contactChannel = await app._interface.createServerContactChannel(serverContactChannelCreateOptionsToCrud(crud.id, data));
        await Promise.all([
          app._serverContactChannelsCache.refresh([crud.id]),
          app._serverUserCache.refresh([crud.id])
        ]);
        return app._serverContactChannelFromCrud(crud.id, contactChannel);
      },
      useApiKeys() {
        const result = useAsyncCache(app._serverUserApiKeysCache, [crud.id], "user.useApiKeys()");
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      async listApiKeys() {
        const result = Result.orThrow(await app._serverUserApiKeysCache.getOrWait([crud.id], "write-only"));
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      async createApiKey(options) {
        const result = await app._interface.createProjectApiKey(
          await apiKeyCreationOptionsToCrud("user", crud.id, options),
          null,
          "server"
        );
        await app._serverUserApiKeysCache.refresh([crud.id]);
        return app._serverApiKeyFromCrud(result);
      }
    };
  }
  _serverTeamUserFromCrud(crud) {
    return {
      ...this._serverUserFromCrud(crud.user),
      teamProfile: {
        displayName: crud.display_name,
        profileImageUrl: crud.profile_image_url
      }
    };
  }
  _serverTeamInvitationFromCrud(crud) {
    return {
      id: crud.id,
      recipientEmail: crud.recipient_email,
      expiresAt: new Date(crud.expires_at_millis),
      revoke: async () => {
        await this._interface.revokeServerTeamInvitation(crud.id, crud.team_id);
      }
    };
  }
  _currentUserFromCrud(crud, session) {
    const app = this;
    const currentUser = {
      ...this._serverUserFromCrud(crud),
      ...this._createAuth(session),
      ...this._isInternalProject() ? this._createInternalUserExtra(session) : {}
    };
    Object.freeze(currentUser);
    return currentUser;
  }
  _serverTeamFromCrud(crud) {
    const app = this;
    return {
      id: crud.id,
      displayName: crud.display_name,
      profileImageUrl: crud.profile_image_url,
      createdAt: new Date(crud.created_at_millis),
      clientMetadata: crud.client_metadata,
      clientReadOnlyMetadata: crud.client_read_only_metadata,
      serverMetadata: crud.server_metadata,
      async update(update) {
        await app._interface.updateServerTeam(crud.id, serverTeamUpdateOptionsToCrud(update));
        await app._serverTeamsCache.refresh([void 0]);
      },
      async delete() {
        await app._interface.deleteServerTeam(crud.id);
        await app._serverTeamsCache.refresh([void 0]);
      },
      async listUsers() {
        const result = Result.orThrow(await app._serverTeamMemberProfilesCache.getOrWait([crud.id], "write-only"));
        return result.map((u) => app._serverTeamUserFromCrud(u));
      },
      useUsers() {
        const result = useAsyncCache(app._serverTeamMemberProfilesCache, [crud.id], "team.useUsers()");
        return useMemo(() => result.map((u) => app._serverTeamUserFromCrud(u)), [result]);
      },
      async addUser(userId) {
        await app._interface.addServerUserToTeam({
          teamId: crud.id,
          userId
        });
        await app._serverTeamMemberProfilesCache.refresh([crud.id]);
      },
      async removeUser(userId) {
        await app._interface.removeServerUserFromTeam({
          teamId: crud.id,
          userId
        });
        await app._serverTeamMemberProfilesCache.refresh([crud.id]);
      },
      async inviteUser(options) {
        await app._interface.sendServerTeamInvitation({
          teamId: crud.id,
          email: options.email,
          callbackUrl: options.callbackUrl ?? constructRedirectUrl(app.urls.teamInvitation, "callbackUrl")
        });
        await app._serverTeamInvitationsCache.refresh([crud.id]);
      },
      async listInvitations() {
        const result = Result.orThrow(await app._serverTeamInvitationsCache.getOrWait([crud.id], "write-only"));
        return result.map((crud2) => app._serverTeamInvitationFromCrud(crud2));
      },
      useInvitations() {
        const result = useAsyncCache(app._serverTeamInvitationsCache, [crud.id], "team.useInvitations()");
        return useMemo(() => result.map((crud2) => app._serverTeamInvitationFromCrud(crud2)), [result]);
      },
      useApiKeys() {
        const result = useAsyncCache(app._serverTeamApiKeysCache, [crud.id], "team.useApiKeys()");
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      async listApiKeys() {
        const result = Result.orThrow(await app._serverTeamApiKeysCache.getOrWait([crud.id], "write-only"));
        return result.map((apiKey) => app._serverApiKeyFromCrud(apiKey));
      },
      async createApiKey(options) {
        const result = await app._interface.createProjectApiKey(
          await apiKeyCreationOptionsToCrud("team", crud.id, options),
          null,
          "server"
        );
        await app._serverTeamApiKeysCache.refresh([crud.id]);
        return app._serverApiKeyFromCrud(result);
      }
    };
  }
  async _getUserApiKey(options) {
    const crud = Result.orThrow(await this._serverCheckApiKeyCache.getOrWait(["user", options.apiKey], "write-only"));
    return crud ? this._serverApiKeyFromCrud(crud) : null;
  }
  async _getTeamApiKey(options) {
    const crud = Result.orThrow(await this._serverCheckApiKeyCache.getOrWait(["team", options.apiKey], "write-only"));
    return crud ? this._serverApiKeyFromCrud(crud) : null;
  }
  _useUserApiKey(options) {
    const crud = useAsyncCache(this._serverCheckApiKeyCache, ["user", options.apiKey], "useUserApiKey()");
    return useMemo(() => crud ? this._serverApiKeyFromCrud(crud) : null, [crud]);
  }
  _useTeamApiKey(options) {
    const crud = useAsyncCache(this._serverCheckApiKeyCache, ["team", options.apiKey], "useTeamApiKey()");
    return useMemo(() => crud ? this._serverApiKeyFromCrud(crud) : null, [crud]);
  }
  async _getUserByApiKey(apiKey) {
    const apiKeyObject = await this._getUserApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return await this.getServerUserById(apiKeyObject.userId);
  }
  _useUserByApiKey(apiKey) {
    const apiKeyObject = this._useUserApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return this.useUserById(apiKeyObject.userId);
  }
  async _getTeamByApiKey(apiKey) {
    const apiKeyObject = await this._getTeamApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return await this.getTeam(apiKeyObject.teamId);
  }
  _useTeamByApiKey(apiKey) {
    const apiKeyObject = this._useTeamApiKey({ apiKey });
    if (apiKeyObject === null) {
      return null;
    }
    return this.useTeam(apiKeyObject.teamId);
  }
  async createUser(options) {
    const crud = await this._interface.createServerUser(serverUserCreateOptionsToCrud(options));
    await this._refreshUsers();
    return this._serverUserFromCrud(crud);
  }
  async getUser(options) {
    if (typeof options === "string") {
      return await this.getServerUserById(options);
    } else if (typeof options === "object" && "apiKey" in options) {
      return await this._getUserByApiKey(options.apiKey);
    } else {
      this._ensurePersistentTokenStore(options?.tokenStore);
      const session = await this._getSession(options?.tokenStore);
      let crud = Result.orThrow(await this._currentServerUserCache.getOrWait([session], "write-only"));
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
            return await this.getUser({ tokenStore: tokens, or: "anonymous-if-exists" }) ?? throwErr("Something went wrong while signing up anonymously");
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
  }
  async getServerUser() {
    console.warn("stackServerApp.getServerUser is deprecated; use stackServerApp.getUser instead");
    return await this.getUser();
  }
  async getServerUserById(userId) {
    const crud = Result.orThrow(await this._serverUserCache.getOrWait([userId], "write-only"));
    return crud && this._serverUserFromCrud(crud);
  }
  useUser(options) {
    if (typeof options === "string") {
      return this.useUserById(options);
    } else if (typeof options === "object" && "apiKey" in options) {
      return this._useUserByApiKey(options.apiKey);
    } else {
      this._ensurePersistentTokenStore(options?.tokenStore);
      const session = this._useSession(options?.tokenStore);
      let crud = useAsyncCache(this._currentServerUserCache, [session], "useUser()");
      if (crud?.is_anonymous && options?.or !== "anonymous" && options?.or !== "anonymous-if-exists") {
        crud = null;
      }
      if (crud === null) {
        switch (options?.or) {
          case "redirect": {
            runAsynchronously(this.redirectToSignIn({ replace: true }));
            suspend();
            throw new StackAssertionError("suspend should never return");
          }
          case "throw": {
            throw new Error("User is not signed in but useUser was called with { or: 'throw' }");
          }
          case "anonymous": {
            runAsynchronously(async () => {
              await this._signUpAnonymously();
              if (typeof window !== "undefined") {
                window.location.reload();
              }
            });
            suspend();
            throw new StackAssertionError("suspend should never return");
          }
          case void 0:
          case "anonymous-if-exists":
          case "return-null": {
          }
        }
      }
      return useMemo(() => {
        return crud && this._currentUserFromCrud(crud, session);
      }, [crud, session, options?.or]);
    }
  }
  useUserById(userId) {
    const crud = useAsyncCache(this._serverUserCache, [userId], "useUserById()");
    return useMemo(() => {
      return crud && this._serverUserFromCrud(crud);
    }, [crud]);
  }
  async listUsers(options) {
    const crud = Result.orThrow(await this._serverUsersCache.getOrWait([options?.cursor, options?.limit, options?.orderBy, options?.desc, options?.query], "write-only"));
    const result = crud.items.map((j) => this._serverUserFromCrud(j));
    result.nextCursor = crud.pagination?.next_cursor ?? null;
    return result;
  }
  useUsers(options) {
    const crud = useAsyncCache(this._serverUsersCache, [options?.cursor, options?.limit, options?.orderBy, options?.desc, options?.query], "useServerUsers()");
    const result = crud.items.map((j) => this._serverUserFromCrud(j));
    result.nextCursor = crud.pagination?.next_cursor ?? null;
    return result;
  }
  _serverPermissionFromCrud(crud) {
    return {
      id: crud.id
    };
  }
  _serverTeamPermissionDefinitionFromCrud(crud) {
    return {
      id: crud.id,
      description: crud.description,
      containedPermissionIds: crud.contained_permission_ids
    };
  }
  _serverProjectPermissionDefinitionFromCrud(crud) {
    return {
      id: crud.id,
      description: crud.description,
      containedPermissionIds: crud.contained_permission_ids
    };
  }
  async listTeams() {
    const teams = Result.orThrow(await this._serverTeamsCache.getOrWait([void 0], "write-only"));
    return teams.map((t) => this._serverTeamFromCrud(t));
  }
  async createTeam(data) {
    const team = await this._interface.createServerTeam(serverTeamCreateOptionsToCrud(data));
    await this._serverTeamsCache.refresh([void 0]);
    return this._serverTeamFromCrud(team);
  }
  useTeams() {
    const teams = useAsyncCache(this._serverTeamsCache, [void 0], "useServerTeams()");
    return useMemo(() => {
      return teams.map((t) => this._serverTeamFromCrud(t));
    }, [teams]);
  }
  async getTeam(options) {
    if (typeof options === "object" && "apiKey" in options) {
      return await this._getTeamByApiKey(options.apiKey);
    } else {
      const teamId = options;
      const teams = await this.listTeams();
      return teams.find((t) => t.id === teamId) ?? null;
    }
  }
  useTeam(options) {
    if (typeof options === "object" && "apiKey" in options) {
      return this._useTeamByApiKey(options.apiKey);
    } else {
      const teamId = options;
      const teams = this.useTeams();
      return useMemo(() => {
        return teams.find((t) => t.id === teamId) ?? null;
      }, [teams, teamId]);
    }
  }
  async _refreshSession(session) {
    await Promise.all([
      super._refreshUser(session),
      this._currentServerUserCache.refresh([session])
    ]);
  }
  async _refreshUsers() {
    await Promise.all([
      super._refreshUsers(),
      this._serverUserCache.refreshWhere(() => true),
      this._serverUsersCache.refreshWhere(() => true),
      this._serverContactChannelsCache.refreshWhere(() => true)
    ]);
  }
};
export {
  _StackServerAppImplIncomplete
};
//# sourceMappingURL=server-app-impl.js.map