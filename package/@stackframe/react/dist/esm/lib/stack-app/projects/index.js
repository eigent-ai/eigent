// src/lib/stack-app/projects/index.ts
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
export {
  adminProjectCreateOptionsToCrud,
  adminProjectUpdateOptionsToCrud
};
//# sourceMappingURL=index.js.map