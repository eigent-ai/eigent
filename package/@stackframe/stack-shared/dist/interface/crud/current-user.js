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

// src/interface/crud/current-user.ts
var current_user_exports = {};
__export(current_user_exports, {
  currentUserCrud: () => currentUserCrud
});
module.exports = __toCommonJS(current_user_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var import_teams = require("./teams");
var import_users = require("./users");
var clientUpdateSchema = import_users.usersCrudServerUpdateSchema.pick([
  "display_name",
  "profile_image_url",
  "client_metadata",
  "selected_team_id",
  "totp_secret_base64",
  "otp_auth_enabled",
  "passkey_auth_enabled"
]).defined();
var serverUpdateSchema = import_users.usersCrudServerUpdateSchema;
var clientReadSchema = import_users.usersCrudServerReadSchema.pick([
  "id",
  "primary_email",
  "primary_email_verified",
  "display_name",
  "client_metadata",
  "client_read_only_metadata",
  "profile_image_url",
  "signed_up_at_millis",
  "has_password",
  "auth_with_email",
  "oauth_providers",
  "selected_team_id",
  "requires_totp_mfa",
  "otp_auth_enabled",
  "passkey_auth_enabled",
  "is_anonymous"
]).concat((0, import_schema_fields.yupObject)({
  selected_team: import_teams.teamsCrudClientReadSchema.nullable().defined()
})).defined();
var serverReadSchema = import_users.usersCrudServerReadSchema.defined();
var clientDeleteSchema = import_users.usersCrudServerDeleteSchema;
var currentUserCrud = (0, import_crud.createCrud)({
  clientReadSchema,
  serverReadSchema,
  clientUpdateSchema,
  serverUpdateSchema,
  clientDeleteSchema,
  docs: {
    clientRead: {
      summary: "Get current user",
      description: "Gets the currently authenticated user.",
      tags: ["Users"]
    },
    clientUpdate: {
      summary: "Update current user",
      description: "Updates the currently authenticated user. Only the values provided will be updated.",
      tags: ["Users"]
    },
    clientDelete: {
      summary: "Delete current user",
      description: "Deletes the currently authenticated user. Use this with caution.",
      tags: ["Users"]
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  currentUserCrud
});
//# sourceMappingURL=current-user.js.map