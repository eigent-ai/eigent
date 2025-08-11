// src/lib/stack-app/users/index.ts
import { encodeBase64 } from "@stackframe/stack-shared/dist/utils/bytes";
function userUpdateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    client_metadata: options.clientMetadata,
    selected_team_id: options.selectedTeamId,
    totp_secret_base64: options.totpMultiFactorSecret != null ? encodeBase64(options.totpMultiFactorSecret) : options.totpMultiFactorSecret,
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
    totp_secret_base64: options.totpMultiFactorSecret != null ? encodeBase64(options.totpMultiFactorSecret) : options.totpMultiFactorSecret
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
export {
  serverUserCreateOptionsToCrud,
  serverUserUpdateOptionsToCrud,
  userUpdateOptionsToCrud
};
//# sourceMappingURL=index.js.map