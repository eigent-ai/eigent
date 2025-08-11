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

// src/interface/crud/projects.ts
var projects_exports = {};
__export(projects_exports, {
  adminUserProjectsCrud: () => adminUserProjectsCrud,
  clientProjectsCrud: () => clientProjectsCrud,
  emailConfigSchema: () => emailConfigSchema,
  emailConfigWithoutPasswordSchema: () => emailConfigWithoutPasswordSchema,
  projectsCrud: () => projectsCrud,
  projectsCrudAdminCreateSchema: () => projectsCrudAdminCreateSchema,
  projectsCrudAdminDeleteSchema: () => projectsCrudAdminDeleteSchema,
  projectsCrudAdminReadSchema: () => projectsCrudAdminReadSchema,
  projectsCrudAdminUpdateSchema: () => projectsCrudAdminUpdateSchema,
  projectsCrudClientReadSchema: () => projectsCrudClientReadSchema
});
module.exports = __toCommonJS(projects_exports);
var import_crud = require("../../crud");
var schemaFields = __toESM(require("../../schema-fields"));
var import_schema_fields = require("../../schema-fields");
var teamPermissionSchema = (0, import_schema_fields.yupObject)({
  id: (0, import_schema_fields.yupString)().defined()
}).defined();
var oauthProviderSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.oauthIdSchema.defined(),
  type: schemaFields.oauthTypeSchema.defined(),
  client_id: schemaFields.yupDefinedAndNonEmptyWhen(
    schemaFields.oauthClientIdSchema,
    { type: "standard" }
  ),
  client_secret: schemaFields.yupDefinedAndNonEmptyWhen(
    schemaFields.oauthClientSecretSchema,
    { type: "standard" }
  ),
  // extra params
  facebook_config_id: schemaFields.oauthFacebookConfigIdSchema.optional(),
  microsoft_tenant_id: schemaFields.oauthMicrosoftTenantIdSchema.optional()
});
var enabledOAuthProviderSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.oauthIdSchema.defined()
});
var emailConfigSchema = (0, import_schema_fields.yupObject)({
  type: schemaFields.emailTypeSchema.defined(),
  host: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailHostSchema, {
    type: "standard"
  }),
  port: schemaFields.yupDefinedWhen(schemaFields.emailPortSchema, {
    type: "standard"
  }),
  username: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailUsernameSchema, {
    type: "standard"
  }),
  password: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailPasswordSchema, {
    type: "standard"
  }),
  sender_name: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderNameSchema, {
    type: "standard"
  }),
  sender_email: schemaFields.yupDefinedAndNonEmptyWhen(schemaFields.emailSenderEmailSchema, {
    type: "standard"
  })
});
var emailConfigWithoutPasswordSchema = emailConfigSchema.pick(["type", "host", "port", "username", "sender_name", "sender_email"]);
var domainSchema = (0, import_schema_fields.yupObject)({
  domain: schemaFields.urlSchema.defined().matches(/^https?:\/\//, "URL must start with http:// or https://").meta({ openapiField: { description: "URL. Must start with http:// or https://", exampleValue: "https://example.com" } }),
  handler_path: schemaFields.handlerPathSchema.defined()
});
var projectsCrudAdminReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.projectIdSchema.defined(),
  display_name: schemaFields.projectDisplayNameSchema.defined(),
  description: schemaFields.projectDescriptionSchema.nonNullable().defined(),
  created_at_millis: schemaFields.projectCreatedAtMillisSchema.defined(),
  user_count: schemaFields.projectUserCountSchema.defined(),
  is_production_mode: schemaFields.projectIsProductionModeSchema.defined(),
  /** @deprecated */
  config: (0, import_schema_fields.yupObject)({
    allow_localhost: schemaFields.projectAllowLocalhostSchema.defined(),
    sign_up_enabled: schemaFields.projectSignUpEnabledSchema.defined(),
    credential_enabled: schemaFields.projectCredentialEnabledSchema.defined(),
    magic_link_enabled: schemaFields.projectMagicLinkEnabledSchema.defined(),
    passkey_enabled: schemaFields.projectPasskeyEnabledSchema.defined(),
    // TODO: remove this
    client_team_creation_enabled: schemaFields.projectClientTeamCreationEnabledSchema.defined(),
    client_user_deletion_enabled: schemaFields.projectClientUserDeletionEnabledSchema.defined(),
    allow_user_api_keys: schemaFields.yupBoolean().defined(),
    allow_team_api_keys: schemaFields.yupBoolean().defined(),
    oauth_providers: (0, import_schema_fields.yupArray)(oauthProviderSchema.defined()).defined(),
    enabled_oauth_providers: (0, import_schema_fields.yupArray)(enabledOAuthProviderSchema.defined()).defined().meta({ openapiField: { hidden: true } }),
    domains: (0, import_schema_fields.yupArray)(domainSchema.defined()).defined(),
    email_config: emailConfigSchema.defined(),
    create_team_on_sign_up: schemaFields.projectCreateTeamOnSignUpSchema.defined(),
    team_creator_default_permissions: (0, import_schema_fields.yupArray)(teamPermissionSchema.defined()).defined(),
    team_member_default_permissions: (0, import_schema_fields.yupArray)(teamPermissionSchema.defined()).defined(),
    user_default_permissions: (0, import_schema_fields.yupArray)(teamPermissionSchema.defined()).defined(),
    oauth_account_merge_strategy: schemaFields.oauthAccountMergeStrategySchema.defined()
  }).defined().meta({ openapiField: { hidden: true } })
}).defined();
var projectsCrudClientReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.projectIdSchema.defined(),
  display_name: schemaFields.projectDisplayNameSchema.defined(),
  config: (0, import_schema_fields.yupObject)({
    sign_up_enabled: schemaFields.projectSignUpEnabledSchema.defined(),
    credential_enabled: schemaFields.projectCredentialEnabledSchema.defined(),
    magic_link_enabled: schemaFields.projectMagicLinkEnabledSchema.defined(),
    passkey_enabled: schemaFields.projectPasskeyEnabledSchema.defined(),
    client_team_creation_enabled: schemaFields.projectClientTeamCreationEnabledSchema.defined(),
    client_user_deletion_enabled: schemaFields.projectClientUserDeletionEnabledSchema.defined(),
    allow_user_api_keys: schemaFields.yupBoolean().defined(),
    allow_team_api_keys: schemaFields.yupBoolean().defined(),
    enabled_oauth_providers: (0, import_schema_fields.yupArray)(enabledOAuthProviderSchema.defined()).defined().meta({ openapiField: { hidden: true } })
  }).defined().meta({ openapiField: { hidden: true } })
}).defined();
var projectsCrudAdminUpdateSchema = (0, import_schema_fields.yupObject)({
  display_name: schemaFields.projectDisplayNameSchema.optional(),
  description: schemaFields.projectDescriptionSchema.optional(),
  is_production_mode: schemaFields.projectIsProductionModeSchema.optional(),
  config: (0, import_schema_fields.yupObject)({
    sign_up_enabled: schemaFields.projectSignUpEnabledSchema.optional(),
    credential_enabled: schemaFields.projectCredentialEnabledSchema.optional(),
    magic_link_enabled: schemaFields.projectMagicLinkEnabledSchema.optional(),
    passkey_enabled: schemaFields.projectPasskeyEnabledSchema.optional(),
    client_team_creation_enabled: schemaFields.projectClientTeamCreationEnabledSchema.optional(),
    client_user_deletion_enabled: schemaFields.projectClientUserDeletionEnabledSchema.optional(),
    allow_localhost: schemaFields.projectAllowLocalhostSchema.optional(),
    allow_user_api_keys: schemaFields.yupBoolean().optional(),
    allow_team_api_keys: schemaFields.yupBoolean().optional(),
    email_config: emailConfigSchema.optional().default(void 0),
    domains: (0, import_schema_fields.yupArray)(domainSchema.defined()).optional().default(void 0),
    oauth_providers: (0, import_schema_fields.yupArray)(oauthProviderSchema.defined()).optional().default(void 0),
    create_team_on_sign_up: schemaFields.projectCreateTeamOnSignUpSchema.optional(),
    team_creator_default_permissions: (0, import_schema_fields.yupArray)(teamPermissionSchema.defined()).optional(),
    team_member_default_permissions: (0, import_schema_fields.yupArray)(teamPermissionSchema.defined()).optional(),
    user_default_permissions: (0, import_schema_fields.yupArray)(teamPermissionSchema.defined()).optional(),
    oauth_account_merge_strategy: schemaFields.oauthAccountMergeStrategySchema.optional()
  }).optional().default(void 0)
}).defined();
var projectsCrudAdminCreateSchema = projectsCrudAdminUpdateSchema.concat((0, import_schema_fields.yupObject)({
  display_name: schemaFields.projectDisplayNameSchema.defined()
}).defined());
var projectsCrudAdminDeleteSchema = schemaFields.yupMixed();
var clientProjectsCrud = (0, import_crud.createCrud)({
  clientReadSchema: projectsCrudClientReadSchema,
  docs: {
    clientRead: {
      summary: "Get the current project",
      description: "Get the current project information including display name, OAuth providers and authentication methods. Useful for display the available login options to the user.",
      tags: ["Projects"]
    }
  }
});
var projectsCrud = (0, import_crud.createCrud)({
  adminReadSchema: projectsCrudAdminReadSchema,
  adminUpdateSchema: projectsCrudAdminUpdateSchema,
  adminDeleteSchema: projectsCrudAdminDeleteSchema,
  docs: {
    adminRead: {
      summary: "Get the current project",
      description: "Get the current project information and configuration including display name, OAuth providers, email configuration, etc.",
      tags: ["Projects"]
    },
    adminUpdate: {
      summary: "Update the current project",
      description: "Update the current project information and configuration including display name, OAuth providers, email configuration, etc.",
      tags: ["Projects"]
    },
    adminDelete: {
      summary: "Delete the current project",
      description: "Delete the current project and all associated data (including users, teams, API keys, project configs, etc.). Be careful, this action is irreversible.",
      tags: ["Projects"]
    }
  }
});
var adminUserProjectsCrud = (0, import_crud.createCrud)({
  clientReadSchema: projectsCrudAdminReadSchema,
  clientCreateSchema: projectsCrudAdminCreateSchema,
  docs: {
    clientList: {
      hidden: true
    },
    clientCreate: {
      hidden: true
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  adminUserProjectsCrud,
  clientProjectsCrud,
  emailConfigSchema,
  emailConfigWithoutPasswordSchema,
  projectsCrud,
  projectsCrudAdminCreateSchema,
  projectsCrudAdminDeleteSchema,
  projectsCrudAdminReadSchema,
  projectsCrudAdminUpdateSchema,
  projectsCrudClientReadSchema
});
//# sourceMappingURL=projects.js.map