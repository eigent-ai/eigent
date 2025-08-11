// src/interface/crud/users.ts
import { createCrud } from "../../crud";
import * as fieldSchema from "../../schema-fields";
import { teamsCrudServerReadSchema } from "./teams";
var usersCrudServerUpdateSchema = fieldSchema.yupObject({
  display_name: fieldSchema.userDisplayNameSchema.optional(),
  profile_image_url: fieldSchema.profileImageUrlSchema.nullable().optional(),
  client_metadata: fieldSchema.userClientMetadataSchema.optional(),
  client_read_only_metadata: fieldSchema.userClientReadOnlyMetadataSchema.optional(),
  server_metadata: fieldSchema.userServerMetadataSchema.optional(),
  primary_email: fieldSchema.primaryEmailSchema.nullable().optional().nonEmpty(),
  primary_email_verified: fieldSchema.primaryEmailVerifiedSchema.optional(),
  primary_email_auth_enabled: fieldSchema.primaryEmailAuthEnabledSchema.optional(),
  passkey_auth_enabled: fieldSchema.userOtpAuthEnabledSchema.optional(),
  password: fieldSchema.userPasswordMutationSchema.optional(),
  password_hash: fieldSchema.userPasswordHashMutationSchema.optional(),
  otp_auth_enabled: fieldSchema.userOtpAuthEnabledMutationSchema.optional(),
  totp_secret_base64: fieldSchema.userTotpSecretMutationSchema.optional(),
  selected_team_id: fieldSchema.selectedTeamIdSchema.nullable().optional(),
  is_anonymous: fieldSchema.yupBoolean().oneOf([false]).optional()
}).defined();
var usersCrudServerReadSchema = fieldSchema.yupObject({
  id: fieldSchema.userIdSchema.defined(),
  primary_email: fieldSchema.primaryEmailSchema.nullable().defined(),
  primary_email_verified: fieldSchema.primaryEmailVerifiedSchema.defined(),
  primary_email_auth_enabled: fieldSchema.primaryEmailAuthEnabledSchema.defined(),
  display_name: fieldSchema.userDisplayNameSchema.nullable().defined(),
  selected_team: teamsCrudServerReadSchema.nullable().defined(),
  selected_team_id: fieldSchema.selectedTeamIdSchema.nullable().defined(),
  profile_image_url: fieldSchema.profileImageUrlSchema.nullable().defined(),
  signed_up_at_millis: fieldSchema.signedUpAtMillisSchema.defined(),
  has_password: fieldSchema.userHasPasswordSchema.defined(),
  otp_auth_enabled: fieldSchema.userOtpAuthEnabledSchema.defined(),
  passkey_auth_enabled: fieldSchema.userOtpAuthEnabledSchema.defined(),
  client_metadata: fieldSchema.userClientMetadataSchema,
  client_read_only_metadata: fieldSchema.userClientReadOnlyMetadataSchema,
  server_metadata: fieldSchema.userServerMetadataSchema,
  last_active_at_millis: fieldSchema.userLastActiveAtMillisSchema.nonNullable().defined(),
  is_anonymous: fieldSchema.yupBoolean().defined(),
  oauth_providers: fieldSchema.yupArray(fieldSchema.yupObject({
    id: fieldSchema.yupString().defined(),
    account_id: fieldSchema.yupString().defined(),
    email: fieldSchema.yupString().nullable()
  }).defined()).defined().meta({ openapiField: { hidden: true } }),
  /**
   * @deprecated
   */
  auth_with_email: fieldSchema.yupBoolean().defined().meta({ openapiField: { hidden: true, description: "Whether the user can authenticate with their primary e-mail. If set to true, the user can log-in with credentials and/or magic link, if enabled in the project settings.", exampleValue: true } }),
  /**
   * @deprecated
   */
  requires_totp_mfa: fieldSchema.yupBoolean().defined().meta({ openapiField: { hidden: true, description: "Whether the user is required to use TOTP MFA to sign in", exampleValue: false } })
}).defined();
var usersCrudServerCreateSchema = usersCrudServerUpdateSchema.omit(["selected_team_id"]).concat(fieldSchema.yupObject({
  oauth_providers: fieldSchema.yupArray(fieldSchema.yupObject({
    id: fieldSchema.yupString().defined(),
    account_id: fieldSchema.yupString().defined(),
    email: fieldSchema.yupString().nullable().defined().default(null)
  }).defined()).optional().meta({ openapiField: { hidden: true } }),
  is_anonymous: fieldSchema.yupBoolean().optional()
}).defined());
var usersCrudServerDeleteSchema = fieldSchema.yupMixed();
var usersCrud = createCrud({
  serverReadSchema: usersCrudServerReadSchema,
  serverUpdateSchema: usersCrudServerUpdateSchema,
  serverCreateSchema: usersCrudServerCreateSchema,
  serverDeleteSchema: usersCrudServerDeleteSchema,
  docs: {
    serverCreate: {
      tags: ["Users"],
      summary: "Create user",
      description: "Creates a new user. E-mail authentication is always enabled, and no password is set, meaning the only way to authenticate the newly created user is through magic link."
    },
    serverRead: {
      tags: ["Users"],
      summary: "Get user",
      description: "Gets a user by user ID."
    },
    serverUpdate: {
      tags: ["Users"],
      summary: "Update user",
      description: "Updates a user. Only the values provided will be updated."
    },
    serverDelete: {
      tags: ["Users"],
      summary: "Delete user",
      description: "Deletes a user. Use this with caution."
    },
    serverList: {
      tags: ["Users"],
      summary: "List users",
      description: "Lists all the users in the project."
    }
  }
});
var userCreatedWebhookEvent = {
  type: "user.created",
  schema: usersCrud.server.readSchema,
  metadata: {
    summary: "User Created",
    description: "This event is triggered when a user is created.",
    tags: ["Users"]
  }
};
var userUpdatedWebhookEvent = {
  type: "user.updated",
  schema: usersCrud.server.readSchema,
  metadata: {
    summary: "User Updated",
    description: "This event is triggered when a user is updated.",
    tags: ["Users"]
  }
};
var webhookUserDeletedSchema = fieldSchema.yupObject({
  id: fieldSchema.userIdSchema.defined(),
  teams: fieldSchema.yupArray(fieldSchema.yupObject({
    id: fieldSchema.yupString().defined()
  })).defined()
}).defined();
var userDeletedWebhookEvent = {
  type: "user.deleted",
  schema: webhookUserDeletedSchema,
  metadata: {
    summary: "User Deleted",
    description: "This event is triggered when a user is deleted.",
    tags: ["Users"]
  }
};
export {
  userCreatedWebhookEvent,
  userDeletedWebhookEvent,
  userUpdatedWebhookEvent,
  usersCrud,
  usersCrudServerCreateSchema,
  usersCrudServerDeleteSchema,
  usersCrudServerReadSchema,
  usersCrudServerUpdateSchema
};
//# sourceMappingURL=users.js.map