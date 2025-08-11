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

// src/interface/serverInterface.ts
var serverInterface_exports = {};
__export(serverInterface_exports, {
  StackServerInterface: () => StackServerInterface
});
module.exports = __toCommonJS(serverInterface_exports);
var import_known_errors = require("../known-errors");
var import_errors = require("../utils/errors");
var import_objects = require("../utils/objects");
var import_results = require("../utils/results");
var import_urls = require("../utils/urls");
var import_clientInterface = require("./clientInterface");
var StackServerInterface = class extends import_clientInterface.StackClientInterface {
  constructor(options) {
    super(options);
    this.options = options;
  }
  async sendServerRequest(path, options, session, requestType = "server") {
    return await this.sendClientRequest(
      path,
      {
        ...options,
        headers: {
          "x-stack-secret-server-key": "secretServerKey" in this.options ? this.options.secretServerKey : "",
          ...options.headers
        }
      },
      session,
      requestType
    );
  }
  async sendServerRequestAndCatchKnownError(path, requestOptions, tokenStoreOrNull, errorsToCatch) {
    try {
      return import_results.Result.ok(await this.sendServerRequest(path, requestOptions, tokenStoreOrNull));
    } catch (e) {
      for (const errorType of errorsToCatch) {
        if (errorType.isInstance(e)) {
          return import_results.Result.error(e);
        }
      }
      throw e;
    }
  }
  async createServerUser(data) {
    const response = await this.sendServerRequest(
      "/users",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async getServerUserByToken(session) {
    const responseOrError = await this.sendServerRequestAndCatchKnownError(
      "/users/me",
      {},
      session,
      [import_known_errors.KnownErrors.CannotGetOwnUserWithoutUser]
    );
    if (responseOrError.status === "error") {
      if (import_known_errors.KnownErrors.CannotGetOwnUserWithoutUser.isInstance(responseOrError.error)) {
        return null;
      } else {
        throw new import_errors.StackAssertionError("Unexpected uncaught error", { cause: responseOrError.error });
      }
    }
    const response = responseOrError.data;
    const user = await response.json();
    if (!user) throw new import_errors.StackAssertionError("User endpoint returned null; this should never happen");
    return user;
  }
  async getServerUserById(userId) {
    const responseOrError = await this.sendServerRequestAndCatchKnownError(
      import_urls.urlString`/users/${userId}`,
      {},
      null,
      [import_known_errors.KnownErrors.UserNotFound]
    );
    if (responseOrError.status === "error") {
      return import_results.Result.error(responseOrError.error);
    }
    const user = await responseOrError.data.json();
    return import_results.Result.ok(user);
  }
  async listServerTeamInvitations(options) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/team-invitations?team_id=${options.teamId}`,
      {},
      null
    );
    const result = await response.json();
    return result.items;
  }
  async revokeServerTeamInvitation(invitationId, teamId) {
    await this.sendServerRequest(
      import_urls.urlString`/team-invitations/${invitationId}?team_id=${teamId}`,
      { method: "DELETE" },
      null
    );
  }
  async listServerTeamMemberProfiles(options) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/team-member-profiles?team_id=${options.teamId}`,
      {},
      null
    );
    const result = await response.json();
    return result.items;
  }
  async getServerTeamMemberProfile(options) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/team-member-profiles/${options.teamId}/${options.userId}`,
      {},
      null
    );
    return await response.json();
  }
  async listServerTeamPermissions(options, session) {
    const response = await this.sendServerRequest(
      `/team-permissions?${new URLSearchParams((0, import_objects.filterUndefined)({
        user_id: options.userId,
        team_id: options.teamId,
        recursive: options.recursive.toString()
      }))}`,
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async listServerProjectPermissions(options, session) {
    const response = await this.sendServerRequest(
      `/project-permissions?${new URLSearchParams((0, import_objects.filterUndefined)({
        user_id: options.userId,
        recursive: options.recursive.toString()
      }))}`,
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async listServerUsers(options) {
    const searchParams = new URLSearchParams((0, import_objects.filterUndefined)({
      cursor: options.cursor,
      limit: options.limit?.toString(),
      desc: options.desc?.toString(),
      ...options.orderBy ? {
        order_by: {
          signedUpAt: "signed_up_at"
        }[options.orderBy]
      } : {},
      ...options.query ? {
        query: options.query
      } : {}
    }));
    const response = await this.sendServerRequest("/users?" + searchParams.toString(), {}, null);
    return await response.json();
  }
  async listServerTeams(options) {
    const response = await this.sendServerRequest(
      `/teams?${new URLSearchParams((0, import_objects.filterUndefined)({
        user_id: options?.userId
      }))}`,
      {},
      null
    );
    const result = await response.json();
    return result.items;
  }
  async getServerTeam(teamId) {
    const response = await this.sendServerRequest(
      `/teams/${teamId}`,
      {},
      null
    );
    return await response.json();
  }
  async listServerTeamUsers(teamId) {
    const response = await this.sendServerRequest(`/users?team_id=${teamId}`, {}, null);
    const result = await response.json();
    return result.items;
  }
  /* when passing a session, the user will be added to the team */
  async createServerTeam(data) {
    const response = await this.sendServerRequest(
      "/teams",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async updateServerTeam(teamId, data) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/teams/${teamId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async deleteServerTeam(teamId) {
    await this.sendServerRequest(
      import_urls.urlString`/teams/${teamId}`,
      { method: "DELETE" },
      null
    );
  }
  async addServerUserToTeam(options) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/team-memberships/${options.teamId}/${options.userId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
    return await response.json();
  }
  async removeServerUserFromTeam(options) {
    await this.sendServerRequest(
      import_urls.urlString`/team-memberships/${options.teamId}/${options.userId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async updateServerUser(userId, update) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/users/${userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(update)
      },
      null
    );
    return await response.json();
  }
  async createServerProviderAccessToken(userId, provider, scope) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/connected-accounts/${userId}/${provider}/access-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ scope })
      },
      null
    );
    return await response.json();
  }
  async createServerUserSession(userId, expiresInMillis, isImpersonation) {
    const response = await this.sendServerRequest(
      "/auth/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          user_id: userId,
          expires_in_millis: expiresInMillis,
          is_impersonation: isImpersonation
        })
      },
      null
    );
    const result = await response.json();
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token
    };
  }
  async leaveServerTeam(options) {
    await this.sendClientRequest(
      import_urls.urlString`/team-memberships/${options.teamId}/${options.userId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async updateServerTeamMemberProfile(options) {
    await this.sendServerRequest(
      import_urls.urlString`/team-member-profiles/${options.teamId}/${options.userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(options.profile)
      },
      null
    );
  }
  async grantServerTeamUserPermission(teamId, userId, permissionId) {
    await this.sendServerRequest(
      import_urls.urlString`/team-permissions/${teamId}/${userId}/${permissionId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async grantServerProjectPermission(userId, permissionId) {
    await this.sendServerRequest(
      import_urls.urlString`/project-permissions/${userId}/${permissionId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async revokeServerTeamUserPermission(teamId, userId, permissionId) {
    await this.sendServerRequest(
      import_urls.urlString`/team-permissions/${teamId}/${userId}/${permissionId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async revokeServerProjectPermission(userId, permissionId) {
    await this.sendServerRequest(
      import_urls.urlString`/project-permissions/${userId}/${permissionId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async deleteServerUser(userId) {
    await this.sendServerRequest(
      import_urls.urlString`/users/${userId}`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      null
    );
  }
  async createServerContactChannel(data) {
    const response = await this.sendServerRequest(
      "/contact-channels",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async updateServerContactChannel(userId, contactChannelId, data) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/contact-channels/${userId}/${contactChannelId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      null
    );
    return await response.json();
  }
  async deleteServerContactChannel(userId, contactChannelId) {
    await this.sendServerRequest(
      import_urls.urlString`/contact-channels/${userId}/${contactChannelId}`,
      {
        method: "DELETE"
      },
      null
    );
  }
  async listServerContactChannels(userId) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/contact-channels?user_id=${userId}`,
      {
        method: "GET"
      },
      null
    );
    const json = await response.json();
    return json.items;
  }
  async sendServerContactChannelVerificationEmail(userId, contactChannelId, callbackUrl) {
    await this.sendServerRequest(
      import_urls.urlString`/contact-channels/${userId}/${contactChannelId}/send-verification-code`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ callback_url: callbackUrl })
      },
      null
    );
  }
  async listServerSessions(userId) {
    const response = await this.sendServerRequest(
      import_urls.urlString`/auth/sessions?user_id=${userId}`,
      {
        method: "GET"
      },
      null
    );
    return await response.json();
  }
  async deleteServerSession(sessionId) {
    await this.sendServerRequest(
      import_urls.urlString`/auth/sessions/${sessionId}`,
      {
        method: "DELETE"
      },
      null
    );
  }
  async sendServerTeamInvitation(options) {
    await this.sendServerRequest(
      "/team-invitations/send-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: options.email,
          team_id: options.teamId,
          callback_url: options.callbackUrl
        })
      },
      null
    );
  }
  async updatePassword(options) {
    const res = await this.sendServerRequestAndCatchKnownError(
      "/auth/password/update",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          old_password: options.oldPassword,
          new_password: options.newPassword
        })
      },
      null,
      [import_known_errors.KnownErrors.PasswordConfirmationMismatch, import_known_errors.KnownErrors.PasswordRequirementsNotMet]
    );
    if (res.status === "error") {
      return res.error;
    }
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  StackServerInterface
});
//# sourceMappingURL=serverInterface.js.map