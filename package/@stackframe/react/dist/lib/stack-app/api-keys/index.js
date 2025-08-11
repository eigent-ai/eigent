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

// src/lib/stack-app/api-keys/index.ts
var api_keys_exports = {};
__export(api_keys_exports, {
  apiKeyCreationOptionsToCrud: () => apiKeyCreationOptionsToCrud,
  apiKeyUpdateOptionsToCrud: () => apiKeyUpdateOptionsToCrud
});
module.exports = __toCommonJS(api_keys_exports);
var import_objects = require("@stackframe/stack-shared/dist/utils/objects");
async function apiKeyCreationOptionsToCrud(type, userIdOrTeamId, options) {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt == null ? options.expiresAt : options.expiresAt.getTime(),
    is_public: options.isPublic,
    ...type === "user" ? { user_id: userIdOrTeamId } : { team_id: userIdOrTeamId }
  };
}
async function apiKeyUpdateOptionsToCrud(type, options) {
  return (0, import_objects.filterUndefined)({
    description: options.description,
    expires_at_millis: options.expiresAt == null ? options.expiresAt : options.expiresAt.getTime(),
    revoked: options.revoked
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  apiKeyCreationOptionsToCrud,
  apiKeyUpdateOptionsToCrud
});
//# sourceMappingURL=index.js.map