// src/interface/crud/svix-token.ts
import { createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";
var svixTokenAdminReadSchema = yupObject({
  token: yupString().defined()
}).defined();
var svixTokenAdminCreateSchema = yupObject({}).defined();
var svixTokenCrud = createCrud({
  adminReadSchema: svixTokenAdminReadSchema,
  adminCreateSchema: svixTokenAdminCreateSchema,
  docs: {
    adminCreate: {
      hidden: true
    }
  }
});
export {
  svixTokenAdminCreateSchema,
  svixTokenAdminReadSchema,
  svixTokenCrud
};
//# sourceMappingURL=svix-token.js.map