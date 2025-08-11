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

// src/lib/stack-app/internal-api-keys/index.ts
var internal_api_keys_exports = {};
__export(internal_api_keys_exports, {
  internalApiKeyCreateOptionsToCrud: () => internalApiKeyCreateOptionsToCrud
});
module.exports = __toCommonJS(internal_api_keys_exports);
function internalApiKeyCreateOptionsToCrud(options) {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt.getTime(),
    has_publishable_client_key: options.hasPublishableClientKey,
    has_secret_server_key: options.hasSecretServerKey,
    has_super_secret_admin_key: options.hasSuperSecretAdminKey
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  internalApiKeyCreateOptionsToCrud
});
//# sourceMappingURL=index.js.map