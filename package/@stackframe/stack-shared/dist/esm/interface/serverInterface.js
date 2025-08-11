// src/interface/serverInterface.ts
import { KnownErrors } from "../known-errors";
import { StackAssertionError } from "../utils/errors";
import { filterUndefined } from "../utils/objects";
import { Result } from "../utils/results";
import { urlString } from "../utils/urls";
import {
  StackClientInterface
} from "./clientInterface";
var StackServerInterface = class extends StackClientInterface {
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
      return Result.ok(await this.sendServerRequest(path, requestOptions, tokenStoreOrNull));
    } catch (e) {
      for (const errorType of errorsToCatch) {
        if (errorType.isInstance(e)) {
          return Result.error(e);
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
      [KnownErrors.CannotGetOwnUserWithoutUser]
    );
    if (responseOrError.status === "error") {
      if (KnownErrors.CannotGetOwnUserWithoutUser.isInstance(responseOrError.error)) {
        return null;
      } else {
        throw new StackAssertionError("Unexpected uncaught error", { cause: responseOrError.error });
      }
    }
    const response = responseOrError.data;
    const user = await response.json();
    if (!user) throw new StackAssertionError("User endpoint returned null; this should never happen");
    return user;
  }
  async getServerUserById(userId) {
    const responseOrError = await this.sendServerRequestAndCatchKnownError(
      urlString`/users/${userId}`,
      {},
      null,
      [KnownErrors.UserNotFound]
    );
    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    const user = await responseOrError.data.json();
    return Result.ok(user);
  }
  async listServerTeamInvitations(options) {
    const response = await this.sendServerRequest(
      urlString`/team-invitations?team_id=${options.teamId}`,
      {},
      null
    );
    const result = await response.json();
    return result.items;
  }
  async revokeServerTeamInvitation(invitationId, teamId) {
    await this.sendServerRequest(
      urlString`/team-invitations/${invitationId}?team_id=${teamId}`,
      { method: "DELETE" },
      null
    );
  }
  async listServerTeamMemberProfiles(options) {
    const response = await this.sendServerRequest(
      urlString`/team-member-profiles?team_id=${options.teamId}`,
      {},
      null
    );
    const result = await response.json();
    return result.items;
  }
  async getServerTeamMemberProfile(options) {
    const response = await this.sendServerRequest(
      urlString`/team-member-profiles/${options.teamId}/${options.userId}`,
      {},
      null
    );
    return await response.json();
  }
  async listServerTeamPermissions(options, session) {
    const response = await this.sendServerRequest(
      `/team-permissions?${new URLSearchParams(filterUndefined({
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
      `/project-permissions?${new URLSearchParams(filterUndefined({
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
    const searchParams = new URLSearchParams(filterUndefined({
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
      `/teams?${new URLSearchParams(filterUndefined({
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
      urlString`/teams/${teamId}`,
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
      urlString`/teams/${teamId}`,
      { method: "DELETE" },
      null
    );
  }
  async addServerUserToTeam(options) {
    const response = await this.sendServerRequest(
      urlString`/team-memberships/${options.teamId}/${options.userId}`,
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
      urlString`/team-memberships/${options.teamId}/${options.userId}`,
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
      urlString`/users/${userId}`,
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
      urlString`/connected-accounts/${userId}/${provider}/access-token`,
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
      urlString`/team-memberships/${options.teamId}/${options.userId}`,
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
      urlString`/team-member-profiles/${options.teamId}/${options.userId}`,
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
      urlString`/team-permissions/${teamId}/${userId}/${permissionId}`,
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
      urlString`/project-permissions/${userId}/${permissionId}`,
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
      urlString`/team-permissions/${teamId}/${userId}/${permissionId}`,
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
      urlString`/project-permissions/${userId}/${permissionId}`,
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
      urlString`/users/${userId}`,
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
      urlString`/contact-channels/${userId}/${contactChannelId}`,
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
      urlString`/contact-channels/${userId}/${contactChannelId}`,
      {
        method: "DELETE"
      },
      null
    );
  }
  async listServerContactChannels(userId) {
    const response = await this.sendServerRequest(
      urlString`/contact-channels?user_id=${userId}`,
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
      urlString`/contact-channels/${userId}/${contactChannelId}/send-verification-code`,
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
      urlString`/auth/sessions?user_id=${userId}`,
      {
        method: "GET"
      },
      null
    );
    return await response.json();
  }
  async deleteServerSession(sessionId) {
    await this.sendServerRequest(
      urlString`/auth/sessions/${sessionId}`,
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
      [KnownErrors.PasswordConfirmationMismatch, KnownErrors.PasswordRequirementsNotMet]
    );
    if (res.status === "error") {
      return res.error;
    }
  }
};
export {
  StackServerInterface
};
//# sourceMappingURL=serverInterface.js.map