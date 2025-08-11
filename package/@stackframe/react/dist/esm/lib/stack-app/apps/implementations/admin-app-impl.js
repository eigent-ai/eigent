// src/lib/stack-app/apps/implementations/admin-app-impl.ts
import { StackAdminInterface } from "@stackframe/stack-shared";
import { getProductionModeErrors } from "@stackframe/stack-shared/dist/helpers/production-mode";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { useMemo } from "react";
import { stackAppInternalsSymbol } from "../../common";
import { adminEmailTemplateUpdateOptionsToCrud } from "../../email-templates";
import { internalApiKeyCreateOptionsToCrud } from "../../internal-api-keys";
import { adminProjectPermissionDefinitionCreateOptionsToCrud, adminProjectPermissionDefinitionUpdateOptionsToCrud, adminTeamPermissionDefinitionCreateOptionsToCrud, adminTeamPermissionDefinitionUpdateOptionsToCrud } from "../../permissions";
import { adminProjectUpdateOptionsToCrud } from "../../projects";
import { clientVersion, createCache, getBaseUrl, getDefaultProjectId, getDefaultPublishableClientKey, getDefaultSecretServerKey, getDefaultSuperSecretAdminKey } from "./common";
import { _StackServerAppImplIncomplete } from "./server-app-impl";
import { useAsyncCache } from "./common";
var _StackAdminAppImplIncomplete = class extends _StackServerAppImplIncomplete {
  constructor(options) {
    super({
      interface: new StackAdminInterface({
        getBaseUrl: () => getBaseUrl(options.baseUrl),
        projectId: options.projectId ?? getDefaultProjectId(),
        extraRequestHeaders: options.extraRequestHeaders ?? {},
        clientVersion,
        ..."projectOwnerSession" in options ? {
          projectOwnerSession: options.projectOwnerSession
        } : {
          publishableClientKey: options.publishableClientKey ?? getDefaultPublishableClientKey(),
          secretServerKey: options.secretServerKey ?? getDefaultSecretServerKey(),
          superSecretAdminKey: options.superSecretAdminKey ?? getDefaultSuperSecretAdminKey()
        }
      }),
      baseUrl: options.baseUrl,
      extraRequestHeaders: options.extraRequestHeaders,
      projectId: options.projectId,
      tokenStore: options.tokenStore,
      urls: options.urls,
      oauthScopesOnSignIn: options.oauthScopesOnSignIn,
      redirectMethod: options.redirectMethod
    });
    this._adminProjectCache = createCache(async () => {
      return await this._interface.getProject();
    });
    this._internalApiKeysCache = createCache(async () => {
      const res = await this._interface.listInternalApiKeys();
      return res;
    });
    this._adminEmailTemplatesCache = createCache(async () => {
      return await this._interface.listEmailTemplates();
    });
    this._adminTeamPermissionDefinitionsCache = createCache(async () => {
      return await this._interface.listTeamPermissionDefinitions();
    });
    this._adminProjectPermissionDefinitionsCache = createCache(async () => {
      return await this._interface.listProjectPermissionDefinitions();
    });
    this._svixTokenCache = createCache(async () => {
      return await this._interface.getSvixToken();
    });
    this._metricsCache = createCache(async () => {
      return await this._interface.getMetrics();
    });
  }
  _adminOwnedProjectFromCrud(data, onRefresh) {
    if (this._tokenStoreInit !== null) {
      throw new StackAssertionError("Owned apps must always have tokenStore === null \u2014 did you not create this project with app._createOwnedApp()?");
    }
    return {
      ...this._adminProjectFromCrud(data, onRefresh),
      app: this
    };
  }
  _adminProjectFromCrud(data, onRefresh) {
    if (data.id !== this.projectId) {
      throw new StackAssertionError(`The project ID of the provided project JSON (${data.id}) does not match the project ID of the app (${this.projectId})!`);
    }
    const app = this;
    return {
      id: data.id,
      displayName: data.display_name,
      description: data.description,
      createdAt: new Date(data.created_at_millis),
      userCount: data.user_count,
      isProductionMode: data.is_production_mode,
      config: {
        signUpEnabled: data.config.sign_up_enabled,
        credentialEnabled: data.config.credential_enabled,
        magicLinkEnabled: data.config.magic_link_enabled,
        passkeyEnabled: data.config.passkey_enabled,
        clientTeamCreationEnabled: data.config.client_team_creation_enabled,
        clientUserDeletionEnabled: data.config.client_user_deletion_enabled,
        allowLocalhost: data.config.allow_localhost,
        oauthAccountMergeStrategy: data.config.oauth_account_merge_strategy,
        allowUserApiKeys: data.config.allow_user_api_keys,
        allowTeamApiKeys: data.config.allow_team_api_keys,
        oauthProviders: data.config.oauth_providers.map((p) => p.type === "shared" ? {
          id: p.id,
          type: "shared"
        } : {
          id: p.id,
          type: "standard",
          clientId: p.client_id ?? throwErr("Client ID is missing"),
          clientSecret: p.client_secret ?? throwErr("Client secret is missing"),
          facebookConfigId: p.facebook_config_id,
          microsoftTenantId: p.microsoft_tenant_id
        }),
        emailConfig: data.config.email_config.type === "shared" ? {
          type: "shared"
        } : {
          type: "standard",
          host: data.config.email_config.host ?? throwErr("Email host is missing"),
          port: data.config.email_config.port ?? throwErr("Email port is missing"),
          username: data.config.email_config.username ?? throwErr("Email username is missing"),
          password: data.config.email_config.password ?? throwErr("Email password is missing"),
          senderName: data.config.email_config.sender_name ?? throwErr("Email sender name is missing"),
          senderEmail: data.config.email_config.sender_email ?? throwErr("Email sender email is missing")
        },
        domains: data.config.domains.map((d) => ({
          domain: d.domain,
          handlerPath: d.handler_path
        })),
        createTeamOnSignUp: data.config.create_team_on_sign_up,
        teamCreatorDefaultPermissions: data.config.team_creator_default_permissions,
        teamMemberDefaultPermissions: data.config.team_member_default_permissions,
        userDefaultPermissions: data.config.user_default_permissions
      },
      async update(update) {
        await app._interface.updateProject(adminProjectUpdateOptionsToCrud(update));
        await onRefresh();
      },
      async delete() {
        await app._interface.deleteProject();
      },
      async getProductionModeErrors() {
        return getProductionModeErrors(data);
      },
      useProductionModeErrors() {
        return getProductionModeErrors(data);
      }
    };
  }
  _adminEmailTemplateFromCrud(data) {
    return {
      type: data.type,
      subject: data.subject,
      content: data.content,
      isDefault: data.is_default
    };
  }
  async getProject() {
    return this._adminProjectFromCrud(
      Result.orThrow(await this._adminProjectCache.getOrWait([], "write-only")),
      () => this._refreshProject()
    );
  }
  useProject() {
    const crud = useAsyncCache(this._adminProjectCache, [], "useProjectAdmin()");
    return useMemo(() => this._adminProjectFromCrud(
      crud,
      () => this._refreshProject()
    ), [crud]);
  }
  _createInternalApiKeyBaseFromCrud(data) {
    const app = this;
    return {
      id: data.id,
      description: data.description,
      expiresAt: new Date(data.expires_at_millis),
      manuallyRevokedAt: data.manually_revoked_at_millis ? new Date(data.manually_revoked_at_millis) : null,
      createdAt: new Date(data.created_at_millis),
      isValid() {
        return this.whyInvalid() === null;
      },
      whyInvalid() {
        if (this.expiresAt.getTime() < Date.now()) return "expired";
        if (this.manuallyRevokedAt) return "manually-revoked";
        return null;
      },
      async revoke() {
        const res = await app._interface.revokeInternalApiKeyById(data.id);
        await app._refreshInternalApiKeys();
        return res;
      }
    };
  }
  _createInternalApiKeyFromCrud(data) {
    return {
      ...this._createInternalApiKeyBaseFromCrud(data),
      publishableClientKey: data.publishable_client_key ? { lastFour: data.publishable_client_key.last_four } : null,
      secretServerKey: data.secret_server_key ? { lastFour: data.secret_server_key.last_four } : null,
      superSecretAdminKey: data.super_secret_admin_key ? { lastFour: data.super_secret_admin_key.last_four } : null
    };
  }
  _createInternalApiKeyFirstViewFromCrud(data) {
    return {
      ...this._createInternalApiKeyBaseFromCrud(data),
      publishableClientKey: data.publishable_client_key,
      secretServerKey: data.secret_server_key,
      superSecretAdminKey: data.super_secret_admin_key
    };
  }
  async listInternalApiKeys() {
    const crud = Result.orThrow(await this._internalApiKeysCache.getOrWait([], "write-only"));
    return crud.map((j) => this._createInternalApiKeyFromCrud(j));
  }
  useInternalApiKeys() {
    const crud = useAsyncCache(this._internalApiKeysCache, [], "useInternalApiKeys()");
    return useMemo(() => {
      return crud.map((j) => this._createInternalApiKeyFromCrud(j));
    }, [crud]);
  }
  async createInternalApiKey(options) {
    const crud = await this._interface.createInternalApiKey(internalApiKeyCreateOptionsToCrud(options));
    await this._refreshInternalApiKeys();
    return this._createInternalApiKeyFirstViewFromCrud(crud);
  }
  useEmailTemplates() {
    const crud = useAsyncCache(this._adminEmailTemplatesCache, [], "useEmailTemplates()");
    return useMemo(() => {
      return crud.map((j) => this._adminEmailTemplateFromCrud(j));
    }, [crud]);
  }
  async listEmailTemplates() {
    const crud = Result.orThrow(await this._adminEmailTemplatesCache.getOrWait([], "write-only"));
    return crud.map((j) => this._adminEmailTemplateFromCrud(j));
  }
  async updateEmailTemplate(type, data) {
    await this._interface.updateEmailTemplate(type, adminEmailTemplateUpdateOptionsToCrud(data));
    await this._adminEmailTemplatesCache.refresh([]);
  }
  async resetEmailTemplate(type) {
    await this._interface.resetEmailTemplate(type);
    await this._adminEmailTemplatesCache.refresh([]);
  }
  async createTeamPermissionDefinition(data) {
    const crud = await this._interface.createTeamPermissionDefinition(adminTeamPermissionDefinitionCreateOptionsToCrud(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
    return this._serverTeamPermissionDefinitionFromCrud(crud);
  }
  async updateTeamPermissionDefinition(permissionId, data) {
    await this._interface.updateTeamPermissionDefinition(permissionId, adminTeamPermissionDefinitionUpdateOptionsToCrud(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }
  async deleteTeamPermissionDefinition(permissionId) {
    await this._interface.deleteTeamPermissionDefinition(permissionId);
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }
  async listTeamPermissionDefinitions() {
    const crud = Result.orThrow(await this._adminTeamPermissionDefinitionsCache.getOrWait([], "write-only"));
    return crud.map((p) => this._serverTeamPermissionDefinitionFromCrud(p));
  }
  useTeamPermissionDefinitions() {
    const crud = useAsyncCache(this._adminTeamPermissionDefinitionsCache, [], "usePermissions()");
    return useMemo(() => {
      return crud.map((p) => this._serverTeamPermissionDefinitionFromCrud(p));
    }, [crud]);
  }
  async createProjectPermissionDefinition(data) {
    const crud = await this._interface.createProjectPermissionDefinition(adminProjectPermissionDefinitionCreateOptionsToCrud(data));
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
    return this._serverProjectPermissionDefinitionFromCrud(crud);
  }
  async updateProjectPermissionDefinition(permissionId, data) {
    await this._interface.updateProjectPermissionDefinition(permissionId, adminProjectPermissionDefinitionUpdateOptionsToCrud(data));
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
  }
  async deleteProjectPermissionDefinition(permissionId) {
    await this._interface.deleteProjectPermissionDefinition(permissionId);
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
  }
  async listProjectPermissionDefinitions() {
    const crud = Result.orThrow(await this._adminProjectPermissionDefinitionsCache.getOrWait([], "write-only"));
    return crud.map((p) => this._serverProjectPermissionDefinitionFromCrud(p));
  }
  useProjectPermissionDefinitions() {
    const crud = useAsyncCache(this._adminProjectPermissionDefinitionsCache, [], "useProjectPermissions()");
    return useMemo(() => {
      return crud.map((p) => this._serverProjectPermissionDefinitionFromCrud(p));
    }, [crud]);
  }
  useSvixToken() {
    const crud = useAsyncCache(this._svixTokenCache, [], "useSvixToken()");
    return crud.token;
  }
  async _refreshProject() {
    await Promise.all([
      super._refreshProject(),
      this._adminProjectCache.refresh([])
    ]);
  }
  async _refreshInternalApiKeys() {
    await this._internalApiKeysCache.refresh([]);
  }
  get [stackAppInternalsSymbol]() {
    return {
      ...super[stackAppInternalsSymbol],
      useMetrics: () => {
        return useAsyncCache(this._metricsCache, [], "useMetrics()");
      }
    };
  }
  async sendTestEmail(options) {
    const response = await this._interface.sendTestEmail({
      recipient_email: options.recipientEmail,
      email_config: {
        ...pick(options.emailConfig, ["host", "port", "username", "password"]),
        sender_email: options.emailConfig.senderEmail,
        sender_name: options.emailConfig.senderName
      }
    });
    if (response.success) {
      return Result.ok(void 0);
    } else {
      return Result.error({ errorMessage: response.error_message ?? throwErr("Email test error not specified") });
    }
  }
  async listSentEmails() {
    const response = await this._interface.listSentEmails();
    return response.items.map((email) => ({
      id: email.id,
      to: email.to ?? [],
      subject: email.subject,
      recipient: email.to?.[0] ?? "",
      sentAt: new Date(email.sent_at_millis),
      error: email.error
    }));
  }
};
export {
  _StackAdminAppImplIncomplete
};
//# sourceMappingURL=admin-app-impl.js.map