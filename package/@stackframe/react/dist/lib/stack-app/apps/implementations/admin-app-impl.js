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

// src/lib/stack-app/apps/implementations/admin-app-impl.ts
var admin_app_impl_exports = {};
__export(admin_app_impl_exports, {
  _StackAdminAppImplIncomplete: () => _StackAdminAppImplIncomplete
});
module.exports = __toCommonJS(admin_app_impl_exports);
var import_stack_shared = require("@stackframe/stack-shared");
var import_production_mode = require("@stackframe/stack-shared/dist/helpers/production-mode");
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_objects = require("@stackframe/stack-shared/dist/utils/objects");
var import_results = require("@stackframe/stack-shared/dist/utils/results");
var import_react = require("react");
var import_common = require("../../common");
var import_email_templates = require("../../email-templates");
var import_internal_api_keys = require("../../internal-api-keys");
var import_permissions = require("../../permissions");
var import_projects = require("../../projects");
var import_common2 = require("./common");
var import_server_app_impl = require("./server-app-impl");
var import_common3 = require("./common");
var _StackAdminAppImplIncomplete = class extends import_server_app_impl._StackServerAppImplIncomplete {
  constructor(options) {
    super({
      interface: new import_stack_shared.StackAdminInterface({
        getBaseUrl: () => (0, import_common2.getBaseUrl)(options.baseUrl),
        projectId: options.projectId ?? (0, import_common2.getDefaultProjectId)(),
        extraRequestHeaders: options.extraRequestHeaders ?? {},
        clientVersion: import_common2.clientVersion,
        ..."projectOwnerSession" in options ? {
          projectOwnerSession: options.projectOwnerSession
        } : {
          publishableClientKey: options.publishableClientKey ?? (0, import_common2.getDefaultPublishableClientKey)(),
          secretServerKey: options.secretServerKey ?? (0, import_common2.getDefaultSecretServerKey)(),
          superSecretAdminKey: options.superSecretAdminKey ?? (0, import_common2.getDefaultSuperSecretAdminKey)()
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
    this._adminProjectCache = (0, import_common2.createCache)(async () => {
      return await this._interface.getProject();
    });
    this._internalApiKeysCache = (0, import_common2.createCache)(async () => {
      const res = await this._interface.listInternalApiKeys();
      return res;
    });
    this._adminEmailTemplatesCache = (0, import_common2.createCache)(async () => {
      return await this._interface.listEmailTemplates();
    });
    this._adminTeamPermissionDefinitionsCache = (0, import_common2.createCache)(async () => {
      return await this._interface.listTeamPermissionDefinitions();
    });
    this._adminProjectPermissionDefinitionsCache = (0, import_common2.createCache)(async () => {
      return await this._interface.listProjectPermissionDefinitions();
    });
    this._svixTokenCache = (0, import_common2.createCache)(async () => {
      return await this._interface.getSvixToken();
    });
    this._metricsCache = (0, import_common2.createCache)(async () => {
      return await this._interface.getMetrics();
    });
  }
  _adminOwnedProjectFromCrud(data, onRefresh) {
    if (this._tokenStoreInit !== null) {
      throw new import_errors.StackAssertionError("Owned apps must always have tokenStore === null \u2014 did you not create this project with app._createOwnedApp()?");
    }
    return {
      ...this._adminProjectFromCrud(data, onRefresh),
      app: this
    };
  }
  _adminProjectFromCrud(data, onRefresh) {
    if (data.id !== this.projectId) {
      throw new import_errors.StackAssertionError(`The project ID of the provided project JSON (${data.id}) does not match the project ID of the app (${this.projectId})!`);
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
          clientId: p.client_id ?? (0, import_errors.throwErr)("Client ID is missing"),
          clientSecret: p.client_secret ?? (0, import_errors.throwErr)("Client secret is missing"),
          facebookConfigId: p.facebook_config_id,
          microsoftTenantId: p.microsoft_tenant_id
        }),
        emailConfig: data.config.email_config.type === "shared" ? {
          type: "shared"
        } : {
          type: "standard",
          host: data.config.email_config.host ?? (0, import_errors.throwErr)("Email host is missing"),
          port: data.config.email_config.port ?? (0, import_errors.throwErr)("Email port is missing"),
          username: data.config.email_config.username ?? (0, import_errors.throwErr)("Email username is missing"),
          password: data.config.email_config.password ?? (0, import_errors.throwErr)("Email password is missing"),
          senderName: data.config.email_config.sender_name ?? (0, import_errors.throwErr)("Email sender name is missing"),
          senderEmail: data.config.email_config.sender_email ?? (0, import_errors.throwErr)("Email sender email is missing")
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
        await app._interface.updateProject((0, import_projects.adminProjectUpdateOptionsToCrud)(update));
        await onRefresh();
      },
      async delete() {
        await app._interface.deleteProject();
      },
      async getProductionModeErrors() {
        return (0, import_production_mode.getProductionModeErrors)(data);
      },
      useProductionModeErrors() {
        return (0, import_production_mode.getProductionModeErrors)(data);
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
      import_results.Result.orThrow(await this._adminProjectCache.getOrWait([], "write-only")),
      () => this._refreshProject()
    );
  }
  useProject() {
    const crud = (0, import_common3.useAsyncCache)(this._adminProjectCache, [], "useProjectAdmin()");
    return (0, import_react.useMemo)(() => this._adminProjectFromCrud(
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
    const crud = import_results.Result.orThrow(await this._internalApiKeysCache.getOrWait([], "write-only"));
    return crud.map((j) => this._createInternalApiKeyFromCrud(j));
  }
  useInternalApiKeys() {
    const crud = (0, import_common3.useAsyncCache)(this._internalApiKeysCache, [], "useInternalApiKeys()");
    return (0, import_react.useMemo)(() => {
      return crud.map((j) => this._createInternalApiKeyFromCrud(j));
    }, [crud]);
  }
  async createInternalApiKey(options) {
    const crud = await this._interface.createInternalApiKey((0, import_internal_api_keys.internalApiKeyCreateOptionsToCrud)(options));
    await this._refreshInternalApiKeys();
    return this._createInternalApiKeyFirstViewFromCrud(crud);
  }
  useEmailTemplates() {
    const crud = (0, import_common3.useAsyncCache)(this._adminEmailTemplatesCache, [], "useEmailTemplates()");
    return (0, import_react.useMemo)(() => {
      return crud.map((j) => this._adminEmailTemplateFromCrud(j));
    }, [crud]);
  }
  async listEmailTemplates() {
    const crud = import_results.Result.orThrow(await this._adminEmailTemplatesCache.getOrWait([], "write-only"));
    return crud.map((j) => this._adminEmailTemplateFromCrud(j));
  }
  async updateEmailTemplate(type, data) {
    await this._interface.updateEmailTemplate(type, (0, import_email_templates.adminEmailTemplateUpdateOptionsToCrud)(data));
    await this._adminEmailTemplatesCache.refresh([]);
  }
  async resetEmailTemplate(type) {
    await this._interface.resetEmailTemplate(type);
    await this._adminEmailTemplatesCache.refresh([]);
  }
  async createTeamPermissionDefinition(data) {
    const crud = await this._interface.createTeamPermissionDefinition((0, import_permissions.adminTeamPermissionDefinitionCreateOptionsToCrud)(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
    return this._serverTeamPermissionDefinitionFromCrud(crud);
  }
  async updateTeamPermissionDefinition(permissionId, data) {
    await this._interface.updateTeamPermissionDefinition(permissionId, (0, import_permissions.adminTeamPermissionDefinitionUpdateOptionsToCrud)(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }
  async deleteTeamPermissionDefinition(permissionId) {
    await this._interface.deleteTeamPermissionDefinition(permissionId);
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }
  async listTeamPermissionDefinitions() {
    const crud = import_results.Result.orThrow(await this._adminTeamPermissionDefinitionsCache.getOrWait([], "write-only"));
    return crud.map((p) => this._serverTeamPermissionDefinitionFromCrud(p));
  }
  useTeamPermissionDefinitions() {
    const crud = (0, import_common3.useAsyncCache)(this._adminTeamPermissionDefinitionsCache, [], "usePermissions()");
    return (0, import_react.useMemo)(() => {
      return crud.map((p) => this._serverTeamPermissionDefinitionFromCrud(p));
    }, [crud]);
  }
  async createProjectPermissionDefinition(data) {
    const crud = await this._interface.createProjectPermissionDefinition((0, import_permissions.adminProjectPermissionDefinitionCreateOptionsToCrud)(data));
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
    return this._serverProjectPermissionDefinitionFromCrud(crud);
  }
  async updateProjectPermissionDefinition(permissionId, data) {
    await this._interface.updateProjectPermissionDefinition(permissionId, (0, import_permissions.adminProjectPermissionDefinitionUpdateOptionsToCrud)(data));
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
  }
  async deleteProjectPermissionDefinition(permissionId) {
    await this._interface.deleteProjectPermissionDefinition(permissionId);
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
  }
  async listProjectPermissionDefinitions() {
    const crud = import_results.Result.orThrow(await this._adminProjectPermissionDefinitionsCache.getOrWait([], "write-only"));
    return crud.map((p) => this._serverProjectPermissionDefinitionFromCrud(p));
  }
  useProjectPermissionDefinitions() {
    const crud = (0, import_common3.useAsyncCache)(this._adminProjectPermissionDefinitionsCache, [], "useProjectPermissions()");
    return (0, import_react.useMemo)(() => {
      return crud.map((p) => this._serverProjectPermissionDefinitionFromCrud(p));
    }, [crud]);
  }
  useSvixToken() {
    const crud = (0, import_common3.useAsyncCache)(this._svixTokenCache, [], "useSvixToken()");
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
  get [import_common.stackAppInternalsSymbol]() {
    return {
      ...super[import_common.stackAppInternalsSymbol],
      useMetrics: () => {
        return (0, import_common3.useAsyncCache)(this._metricsCache, [], "useMetrics()");
      }
    };
  }
  async sendTestEmail(options) {
    const response = await this._interface.sendTestEmail({
      recipient_email: options.recipientEmail,
      email_config: {
        ...(0, import_objects.pick)(options.emailConfig, ["host", "port", "username", "password"]),
        sender_email: options.emailConfig.senderEmail,
        sender_name: options.emailConfig.senderName
      }
    });
    if (response.success) {
      return import_results.Result.ok(void 0);
    } else {
      return import_results.Result.error({ errorMessage: response.error_message ?? (0, import_errors.throwErr)("Email test error not specified") });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  _StackAdminAppImplIncomplete
});
//# sourceMappingURL=admin-app-impl.js.map