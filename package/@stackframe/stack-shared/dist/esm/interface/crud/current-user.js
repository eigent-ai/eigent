// src/interface/crud/current-user.ts
import { createCrud } from "../../crud";
import { yupObject } from "../../schema-fields";
import { teamsCrudClientReadSchema } from "./teams";
import { usersCrudServerDeleteSchema, usersCrudServerReadSchema, usersCrudServerUpdateSchema } from "./users";
var clientUpdateSchema = usersCrudServerUpdateSchema.pick([
  "display_name",
  "profile_image_url",
  "client_metadata",
  "selected_team_id",
  "totp_secret_base64",
  "otp_auth_enabled",
  "passkey_auth_enabled"
]).defined();
var serverUpdateSchema = usersCrudServerUpdateSchema;
var clientReadSchema = usersCrudServerReadSchema.pick([
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
]).concat(yupObject({
  selected_team: teamsCrudClientReadSchema.nullable().defined()
})).defined();
var serverReadSchema = usersCrudServerReadSchema.defined();
var clientDeleteSchema = usersCrudServerDeleteSchema;
var currentUserCrud = createCrud({
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
export {
  currentUserCrud
};
//# sourceMappingURL=current-user.js.map