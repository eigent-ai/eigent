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

// src/lib/stack-app/projects/index.ts
var projects_exports = {};
__export(projects_exports, {
  adminProjectCreateOptionsToCrud: () => adminProjectCreateOptionsToCrud,
  adminProjectUpdateOptionsToCrud: () => adminProjectUpdateOptionsToCrud
});
module.exports = __toCommonJS(projects_exports);
function adminProjectUpdateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    description: options.description,
    is_production_mode: options.isProductionMode,
    config: {
      domains: options.config?.domains?.map((d) => ({
        domain: d.domain,
        handler_path: d.handlerPath
      })),
      oauth_providers: options.config?.oauthProviders?.map((p) => ({
        id: p.id,
        type: p.type,
        ...p.type === "standard" && {
          client_id: p.clientId,
          client_secret: p.clientSecret,
          facebook_config_id: p.facebookConfigId,
          microsoft_tenant_id: p.microsoftTenantId
        }
      })),
      email_config: options.config?.emailConfig && (options.config.emailConfig.type === "shared" ? {
        type: "shared"
      } : {
        type: "standard",
        host: options.config.emailConfig.host,
        port: options.config.emailConfig.port,
        username: options.config.emailConfig.username,
        password: options.config.emailConfig.password,
        sender_name: options.config.emailConfig.senderName,
        sender_email: options.config.emailConfig.senderEmail
      }),
      sign_up_enabled: options.config?.signUpEnabled,
      credential_enabled: options.config?.credentialEnabled,
      magic_link_enabled: options.config?.magicLinkEnabled,
      passkey_enabled: options.config?.passkeyEnabled,
      allow_localhost: options.config?.allowLocalhost,
      create_team_on_sign_up: options.config?.createTeamOnSignUp,
      client_team_creation_enabled: options.config?.clientTeamCreationEnabled,
      client_user_deletion_enabled: options.config?.clientUserDeletionEnabled,
      team_creator_default_permissions: options.config?.teamCreatorDefaultPermissions,
      team_member_default_permissions: options.config?.teamMemberDefaultPermissions,
      user_default_permissions: options.config?.userDefaultPermissions,
      oauth_account_merge_strategy: options.config?.oauthAccountMergeStrategy,
      allow_user_api_keys: options.config?.allowUserApiKeys,
      allow_team_api_keys: options.config?.allowTeamApiKeys
    }
  };
}
function adminProjectCreateOptionsToCrud(options) {
  return {
    ...adminProjectUpdateOptionsToCrud(options),
    display_name: options.displayName
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adminProjectCreateOptionsToCrud,
  adminProjectUpdateOptionsToCrud
});
//# sourceMappingURL=index.js.map