// src/interface/crud/email-templates.ts
import { createCrud } from "../../crud";
import { jsonSchema, yupBoolean, yupMixed, yupObject, yupString } from "../../schema-fields";
var emailTemplateTypes = ["email_verification", "password_reset", "magic_link", "team_invitation"];
var emailTemplateAdminReadSchema = yupObject({
  type: yupString().oneOf(emailTemplateTypes).defined(),
  subject: yupString().defined(),
  content: jsonSchema.defined(),
  is_default: yupBoolean().defined()
}).defined();
var emailTemplateCrudAdminUpdateSchema = yupObject({
  content: jsonSchema.nonNullable().optional(),
  subject: yupString().optional()
}).defined();
var emailTemplateCrudAdminDeleteSchema = yupMixed();
var emailTemplateCrudAdminCreateSchema = yupObject({
  type: yupString().oneOf(emailTemplateTypes).defined(),
  content: jsonSchema.defined(),
  subject: yupString().defined()
}).defined();
var emailTemplateCrud = createCrud({
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
export {
  emailTemplateAdminReadSchema,
  emailTemplateCrud,
  emailTemplateCrudAdminCreateSchema,
  emailTemplateCrudAdminDeleteSchema,
  emailTemplateCrudAdminUpdateSchema,
  emailTemplateTypes
};
//# sourceMappingURL=email-templates.js.map