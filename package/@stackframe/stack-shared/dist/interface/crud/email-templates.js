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

// src/interface/crud/email-templates.ts
var email_templates_exports = {};
__export(email_templates_exports, {
  emailTemplateAdminReadSchema: () => emailTemplateAdminReadSchema,
  emailTemplateCrud: () => emailTemplateCrud,
  emailTemplateCrudAdminCreateSchema: () => emailTemplateCrudAdminCreateSchema,
  emailTemplateCrudAdminDeleteSchema: () => emailTemplateCrudAdminDeleteSchema,
  emailTemplateCrudAdminUpdateSchema: () => emailTemplateCrudAdminUpdateSchema,
  emailTemplateTypes: () => emailTemplateTypes
});
module.exports = __toCommonJS(email_templates_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var emailTemplateTypes = ["email_verification", "password_reset", "magic_link", "team_invitation"];
var emailTemplateAdminReadSchema = (0, import_schema_fields.yupObject)({
  type: (0, import_schema_fields.yupString)().oneOf(emailTemplateTypes).defined(),
  subject: (0, import_schema_fields.yupString)().defined(),
  content: import_schema_fields.jsonSchema.defined(),
  is_default: (0, import_schema_fields.yupBoolean)().defined()
}).defined();
var emailTemplateCrudAdminUpdateSchema = (0, import_schema_fields.yupObject)({
  content: import_schema_fields.jsonSchema.nonNullable().optional(),
  subject: (0, import_schema_fields.yupString)().optional()
}).defined();
var emailTemplateCrudAdminDeleteSchema = (0, import_schema_fields.yupMixed)();
var emailTemplateCrudAdminCreateSchema = (0, import_schema_fields.yupObject)({
  type: (0, import_schema_fields.yupString)().oneOf(emailTemplateTypes).defined(),
  content: import_schema_fields.jsonSchema.defined(),
  subject: (0, import_schema_fields.yupString)().defined()
}).defined();
var emailTemplateCrud = (0, import_crud.createCrud)({
  adminReadSchema: emailTemplateAdminReadSchema,
  adminUpdateSchema: emailTemplateCrudAdminUpdateSchema,
  adminCreateSchema: emailTemplateCrudAdminCreateSchema,
  adminDeleteSchema: emailTemplateCrudAdminDeleteSchema,
  docs: {
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
    },
    adminList: {
      hidden: true
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  emailTemplateAdminReadSchema,
  emailTemplateCrud,
  emailTemplateCrudAdminCreateSchema,
  emailTemplateCrudAdminDeleteSchema,
  emailTemplateCrudAdminUpdateSchema,
  emailTemplateTypes
});
//# sourceMappingURL=email-templates.js.map