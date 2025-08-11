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

// src/interface/crud/svix-token.ts
var svix_token_exports = {};
__export(svix_token_exports, {
  svixTokenAdminCreateSchema: () => svixTokenAdminCreateSchema,
  svixTokenAdminReadSchema: () => svixTokenAdminReadSchema,
  svixTokenCrud: () => svixTokenCrud
});
module.exports = __toCommonJS(svix_token_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var svixTokenAdminReadSchema = (0, import_schema_fields.yupObject)({
  token: (0, import_schema_fields.yupString)().defined()
}).defined();
var svixTokenAdminCreateSchema = (0, import_schema_fields.yupObject)({}).defined();
var svixTokenCrud = (0, import_crud.createCrud)({
  adminReadSchema: svixTokenAdminReadSchema,
  adminCreateSchema: svixTokenAdminCreateSchema,
  docs: {
    adminCreate: {
      hidden: true
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  svixTokenAdminCreateSchema,
  svixTokenAdminReadSchema,
  svixTokenCrud
});
//# sourceMappingURL=svix-token.js.map