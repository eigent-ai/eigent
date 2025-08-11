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

// src/interface/crud/project-api-keys.ts
var project_api_keys_exports = {};
__export(project_api_keys_exports, {
  teamApiKeysCreateInputSchema: () => teamApiKeysCreateInputSchema,
  teamApiKeysCreateOutputSchema: () => teamApiKeysCreateOutputSchema,
  teamApiKeysCrud: () => teamApiKeysCrud,
  userApiKeysCreateInputSchema: () => userApiKeysCreateInputSchema,
  userApiKeysCreateOutputSchema: () => userApiKeysCreateOutputSchema,
  userApiKeysCrud: () => userApiKeysCrud
});
module.exports = __toCommonJS(project_api_keys_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var import_objects = require("../../utils/objects");
function createApiKeyCrud(type, idFieldName, idSchema) {
  const projectApiKeysReadSchema = (0, import_schema_fields.yupObject)({
    id: (0, import_schema_fields.yupString)().defined(),
    description: (0, import_schema_fields.yupString)().defined(),
    expires_at_millis: (0, import_schema_fields.yupNumber)().optional(),
    manually_revoked_at_millis: (0, import_schema_fields.yupNumber)().optional(),
    created_at_millis: (0, import_schema_fields.yupNumber)().defined(),
    is_public: (0, import_schema_fields.yupBoolean)().defined(),
    value: (0, import_schema_fields.yupObject)({
      last_four: (0, import_schema_fields.yupString)().defined()
    }).defined(),
    type: (0, import_schema_fields.yupString)().oneOf([type]).defined(),
    ...(0, import_objects.typedFromEntries)([[idFieldName, idSchema]])
  });
  const projectApiKeysUpdateSchema = (0, import_schema_fields.yupObject)({
    description: (0, import_schema_fields.yupString)().optional(),
    revoked: (0, import_schema_fields.yupBoolean)().oneOf([true]).optional()
  }).defined();
  const projectApiKeysCrud = (0, import_crud.createCrud)({
    clientReadSchema: projectApiKeysReadSchema,
    clientUpdateSchema: projectApiKeysUpdateSchema,
    docs: {
      clientCreate: {
        description: `Create a new ${type} API key`,
        displayName: `Create ${type} API key`,
        tags: ["API Keys"],
        summary: `Create ${type} API key`
      },
      clientList: {
        description: `List all ${type} API keys for the project with their metadata and status`,
        displayName: `List ${type} API keys`,
        summary: `List ${type} API keys`,
        tags: ["API Keys"]
      },
      clientRead: {
        description: `Get details of a specific ${type} API key`,
        displayName: `Get ${type} API key`,
        summary: `Get ${type} API key details`,
        tags: ["API Keys"]
      },
      clientUpdate: {
        description: `Update an ${type} API key`,
        displayName: `Update ${type} API key`,
        summary: `Update ${type} API key`,
        tags: ["API Keys"]
      },
      serverDelete: {
        description: `Delete an ${type} API key`,
        displayName: `Delete ${type} API key`,
        summary: `Delete ${type} API key`,
        tags: ["API Keys"]
      }
    }
  });
  const projectApiKeysCreateInputSchema = (0, import_schema_fields.yupObject)({
    description: (0, import_schema_fields.yupString)().defined(),
    expires_at_millis: (0, import_schema_fields.yupNumber)().nullable().defined(),
    is_public: (0, import_schema_fields.yupBoolean)().optional(),
    /*
    prefix: yupString().optional().nonEmpty().test("prefix", "Prefix must contain only alphanumeric characters and underscores", (value) => {
      if (!value) return true;
      return /^[a-zA-Z0-9_]+$/.test(value);
    }),
    */
    ...(0, import_objects.typedFromEntries)([[idFieldName, idSchema]])
  });
  const projectApiKeysCreateOutputSchema = projectApiKeysReadSchema.omit(["value"]).concat((0, import_schema_fields.yupObject)({
    value: (0, import_schema_fields.yupString)().defined()
  }));
  return {
    crud: projectApiKeysCrud,
    createInputSchema: projectApiKeysCreateInputSchema,
    createOutputSchema: projectApiKeysCreateOutputSchema
  };
}
var {
  crud: userApiKeysCrud,
  createInputSchema: userApiKeysCreateInputSchema,
  createOutputSchema: userApiKeysCreateOutputSchema
} = createApiKeyCrud("user", "user_id", import_schema_fields.userIdOrMeSchema.defined());
var {
  crud: teamApiKeysCrud,
  createInputSchema: teamApiKeysCreateInputSchema,
  createOutputSchema: teamApiKeysCreateOutputSchema
} = createApiKeyCrud("team", "team_id", (0, import_schema_fields.yupString)().defined());
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  teamApiKeysCreateInputSchema,
  teamApiKeysCreateOutputSchema,
  teamApiKeysCrud,
  userApiKeysCreateInputSchema,
  userApiKeysCreateOutputSchema,
  userApiKeysCrud
});
//# sourceMappingURL=project-api-keys.js.map