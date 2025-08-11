// src/interface/crud/emails.ts
import { createCrud } from "../../crud";
import * as fieldSchema from "../../schema-fields";
import { emailConfigWithoutPasswordSchema } from "./projects";
var sentEmailReadSchema = fieldSchema.yupObject({
  id: fieldSchema.yupString().defined(),
  subject: fieldSchema.yupString().defined(),
  sent_at_millis: fieldSchema.yupNumber().defined(),
  to: fieldSchema.yupArray(fieldSchema.yupString().defined()),
  sender_config: emailConfigWithoutPasswordSchema.defined(),
  error: fieldSchema.yupMixed().nullable().optional()
}).defined();
var internalEmailsCrud = createCrud({
  adminReadSchema: sentEmailReadSchema
});
export {
  internalEmailsCrud,
  sentEmailReadSchema
};
//# sourceMappingURL=emails.js.map