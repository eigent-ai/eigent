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

// src/interface/crud/oauth.ts
var oauth_exports = {};
__export(oauth_exports, {
  connectedAccountAccessTokenCreateSchema: () => connectedAccountAccessTokenCreateSchema,
  connectedAccountAccessTokenCrud: () => connectedAccountAccessTokenCrud,
  connectedAccountAccessTokenReadSchema: () => connectedAccountAccessTokenReadSchema
});
module.exports = __toCommonJS(oauth_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var connectedAccountAccessTokenReadSchema = (0, import_schema_fields.yupObject)({
  access_token: (0, import_schema_fields.yupString)().defined()
}).defined();
var connectedAccountAccessTokenCreateSchema = (0, import_schema_fields.yupObject)({
  scope: (0, import_schema_fields.yupString)().optional()
}).defined();
var connectedAccountAccessTokenCrud = (0, import_crud.createCrud)({
  clientReadSchema: connectedAccountAccessTokenReadSchema,
  clientCreateSchema: connectedAccountAccessTokenCreateSchema,
  docs: {
    clientCreate: {
      hidden: true
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  connectedAccountAccessTokenCreateSchema,
  connectedAccountAccessTokenCrud,
  connectedAccountAccessTokenReadSchema
});
//# sourceMappingURL=oauth.js.map