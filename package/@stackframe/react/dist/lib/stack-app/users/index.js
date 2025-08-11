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

// src/lib/stack-app/users/index.ts
var users_exports = {};
__export(users_exports, {
  serverUserCreateOptionsToCrud: () => serverUserCreateOptionsToCrud,
  serverUserUpdateOptionsToCrud: () => serverUserUpdateOptionsToCrud,
  userUpdateOptionsToCrud: () => userUpdateOptionsToCrud
});
module.exports = __toCommonJS(users_exports);
var import_bytes = require("@stackframe/stack-shared/dist/utils/bytes");
function userUpdateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    client_metadata: options.clientMetadata,
    selected_team_id: options.selectedTeamId,
    totp_secret_base64: options.totpMultiFactorSecret != null ? (0, import_bytes.encodeBase64)(options.totpMultiFactorSecret) : options.totpMultiFactorSecret,
    profile_image_url: options.profileImageUrl,
    otp_auth_enabled: options.otpAuthEnabled,
    passkey_auth_enabled: options.passkeyAuthEnabled
  };
}
function serverUserUpdateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    primary_email: options.primaryEmail,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata,
    selected_team_id: options.selectedTeamId,
    primary_email_auth_enabled: options.primaryEmailAuthEnabled,
    primary_email_verified: options.primaryEmailVerified,
    password: options.password,
    profile_image_url: options.profileImageUrl,
    totp_secret_base64: options.totpMultiFactorSecret != null ? (0, import_bytes.encodeBase64)(options.totpMultiFactorSecret) : options.totpMultiFactorSecret
  };
}
function serverUserCreateOptionsToCrud(options) {
  return {
    primary_email: options.primaryEmail,
    password: options.password,
    otp_auth_enabled: options.otpAuthEnabled,
    primary_email_auth_enabled: options.primaryEmailAuthEnabled,
    display_name: options.displayName,
    primary_email_verified: options.primaryEmailVerified,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  serverUserCreateOptionsToCrud,
  serverUserUpdateOptionsToCrud,
  userUpdateOptionsToCrud
});
//# sourceMappingURL=index.js.map