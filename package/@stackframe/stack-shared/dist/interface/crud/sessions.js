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

// src/interface/crud/sessions.ts
var sessions_exports = {};
__export(sessions_exports, {
  sessionsCreateOutputSchema: () => sessionsCreateOutputSchema,
  sessionsCrud: () => sessionsCrud,
  sessionsCrudDeleteSchema: () => sessionsCrudDeleteSchema,
  sessionsCrudReadSchema: () => sessionsCrudReadSchema,
  sessionsCrudServerCreateSchema: () => sessionsCrudServerCreateSchema
});
module.exports = __toCommonJS(sessions_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var import_geo = require("../../utils/geo");
var sessionsCrudServerCreateSchema = (0, import_schema_fields.yupObject)({
  user_id: (0, import_schema_fields.yupString)().uuid().defined(),
  expires_in_millis: (0, import_schema_fields.yupNumber)().max(1e3 * 60 * 60 * 24 * 367).default(1e3 * 60 * 60 * 24 * 365),
  is_impersonation: (0, import_schema_fields.yupBoolean)().default(false)
}).defined();
var sessionsCreateOutputSchema = (0, import_schema_fields.yupObject)({
  refresh_token: (0, import_schema_fields.yupString)().defined(),
  access_token: (0, import_schema_fields.yupString)().defined()
}).defined();
var sessionsCrudReadSchema = (0, import_schema_fields.yupObject)({
  id: (0, import_schema_fields.yupString)().defined(),
  user_id: (0, import_schema_fields.yupString)().uuid().defined(),
  created_at: (0, import_schema_fields.yupNumber)().defined(),
  is_impersonation: (0, import_schema_fields.yupBoolean)().defined(),
  last_used_at: (0, import_schema_fields.yupNumber)().optional(),
  is_current_session: (0, import_schema_fields.yupBoolean)(),
  // TODO move this to a shared type
  // TODO: what about if not trusted?
  last_used_at_end_user_ip_info: import_geo.geoInfoSchema.optional()
}).defined();
var sessionsCrudDeleteSchema = (0, import_schema_fields.yupMixed)();
var sessionsCrud = (0, import_crud.createCrud)({
  // serverCreateSchema: sessionsCrudServerCreateSchema,
  serverReadSchema: sessionsCrudReadSchema,
  serverDeleteSchema: sessionsCrudDeleteSchema,
  clientReadSchema: sessionsCrudReadSchema,
  clientDeleteSchema: sessionsCrudDeleteSchema,
  docs: {
    serverList: {
      summary: "List sessions",
      description: "List all sessions for the current user.",
      tags: ["Sessions"]
    },
    serverDelete: {
      summary: "Delete session",
      description: "Delete a session by ID.",
      tags: ["Sessions"]
    },
    clientList: {
      summary: "List sessions",
      description: "List all sessions for the current user.",
      tags: ["Sessions"]
    },
    clientDelete: {
      summary: "Delete session",
      description: "Delete a session by ID.",
      tags: ["Sessions"]
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  sessionsCreateOutputSchema,
  sessionsCrud,
  sessionsCrudDeleteSchema,
  sessionsCrudReadSchema,
  sessionsCrudServerCreateSchema
});
//# sourceMappingURL=sessions.js.map