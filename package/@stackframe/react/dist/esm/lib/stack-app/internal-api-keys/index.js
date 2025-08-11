// src/lib/stack-app/internal-api-keys/index.ts
function internalApiKeyCreateOptionsToCrud(options) {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt.getTime(),
    has_publishable_client_key: options.hasPublishableClientKey,
    has_secret_server_key: options.hasSecretServerKey,
    has_super_secret_admin_key: options.hasSuperSecretAdminKey
  };
}
export {
  internalApiKeyCreateOptionsToCrud
};
//# sourceMappingURL=index.js.map