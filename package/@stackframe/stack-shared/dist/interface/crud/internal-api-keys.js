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

// src/interface/crud/internal-api-keys.ts
var internal_api_keys_exports = {};
__export(internal_api_keys_exports, {
  internalApiKeysCreateInputSchema: () => internalApiKeysCreateInputSchema,
  internalApiKeysCreateOutputSchema: () => internalApiKeysCreateOutputSchema,
  internalApiKeysCrud: () => internalApiKeysCrud,
  internalApiKeysCrudAdminDeleteSchema: () => internalApiKeysCrudAdminDeleteSchema,
  internalApiKeysCrudAdminObfuscatedReadSchema: () => internalApiKeysCrudAdminObfuscatedReadSchema,
  internalApiKeysCrudAdminUpdateSchema: () => internalApiKeysCrudAdminUpdateSchema
});
module.exports = __toCommonJS(internal_api_keys_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var baseInternalApiKeysReadSchema = (0, import_schema_fields.yupObject)({
  id: (0, import_schema_fields.yupString)().defined(),
  description: (0, import_schema_fields.yupString)().defined(),
  expires_at_millis: (0, import_schema_fields.yupNumber)().defined(),
  manually_revoked_at_millis: (0, import_schema_fields.yupNumber)().optional(),
  created_at_millis: (0, import_schema_fields.yupNumber)().defined()
});
var internalApiKeysCreateInputSchema = (0, import_schema_fields.yupObject)({
  description: (0, import_schema_fields.yupString)().defined(),
  expires_at_millis: (0, import_schema_fields.yupNumber)().defined(),
  has_publishable_client_key: (0, import_schema_fields.yupBoolean)().defined(),
  has_secret_server_key: (0, import_schema_fields.yupBoolean)().defined(),
  has_super_secret_admin_key: (0, import_schema_fields.yupBoolean)().defined()
});
var internalApiKeysCreateOutputSchema = baseInternalApiKeysReadSchema.concat((0, import_schema_fields.yupObject)({
  publishable_client_key: (0, import_schema_fields.yupString)().optional(),
  secret_server_key: (0, import_schema_fields.yupString)().optional(),
  super_secret_admin_key: (0, import_schema_fields.yupString)().optional()
}).defined());
var internalApiKeysCrudAdminObfuscatedReadSchema = baseInternalApiKeysReadSchema.concat((0, import_schema_fields.yupObject)({
  publishable_client_key: (0, import_schema_fields.yupObject)({
    last_four: (0, import_schema_fields.yupString)().defined()
  }).optional(),
  secret_server_key: (0, import_schema_fields.yupObject)({
    last_four: (0, import_schema_fields.yupString)().defined()
  }).optional(),
  super_secret_admin_key: (0, import_schema_fields.yupObject)({
    last_four: (0, import_schema_fields.yupString)().defined()
  }).optional()
}));
var internalApiKeysCrudAdminUpdateSchema = (0, import_schema_fields.yupObject)({
  description: (0, import_schema_fields.yupString)().optional(),
  revoked: (0, import_schema_fields.yupBoolean)().oneOf([true]).optional()
}).defined();
var internalApiKeysCrudAdminDeleteSchema = (0, import_schema_fields.yupMixed)();
var internalApiKeysCrud = (0, import_crud.createCrud)({
  adminReadSchema: internalApiKeysCrudAdminObfuscatedReadSchema,
  adminUpdateSchema: internalApiKeysCrudAdminUpdateSchema,
  adminDeleteSchema: internalApiKeysCrudAdminDeleteSchema,
  docs: {
    adminList: {
      hidden: true
    },
    adminRead: {
      hidden: true
    },
    adminCreate: {
      hidden: true
    },
    adminUpdate: {
      hidden: true
    },
    adminDelete: {
      hidden: true
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  internalApiKeysCreateInputSchema,
  internalApiKeysCreateOutputSchema,
  internalApiKeysCrud,
  internalApiKeysCrudAdminDeleteSchema,
  internalApiKeysCrudAdminObfuscatedReadSchema,
  internalApiKeysCrudAdminUpdateSchema
});
//# sourceMappingURL=internal-api-keys.js.map