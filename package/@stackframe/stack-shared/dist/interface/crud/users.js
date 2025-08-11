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

// src/interface/crud/users.ts
var users_exports = {};
__export(users_exports, {
  userCreatedWebhookEvent: () => userCreatedWebhookEvent,
  userDeletedWebhookEvent: () => userDeletedWebhookEvent,
  userUpdatedWebhookEvent: () => userUpdatedWebhookEvent,
  usersCrud: () => usersCrud,
  usersCrudServerCreateSchema: () => usersCrudServerCreateSchema,
  usersCrudServerDeleteSchema: () => usersCrudServerDeleteSchema,
  usersCrudServerReadSchema: () => usersCrudServerReadSchema,
  usersCrudServerUpdateSchema: () => usersCrudServerUpdateSchema
});
module.exports = __toCommonJS(users_exports);
var import_crud = require("../../crud");
var fieldSchema = __toESM(require("../../schema-fields"));
var import_teams = require("./teams");
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
  selected_team: import_teams.teamsCrudServerReadSchema.nullable().defined(),
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
var usersCrud = (0, import_crud.createCrud)({
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  userCreatedWebhookEvent,
  userDeletedWebhookEvent,
  userUpdatedWebhookEvent,
  usersCrud,
  usersCrudServerCreateSchema,
  usersCrudServerDeleteSchema,
  usersCrudServerReadSchema,
  usersCrudServerUpdateSchema
});
//# sourceMappingURL=users.js.map