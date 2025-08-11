// src/interface/crud/oauth.ts
import { createCrud } from "../../crud";
import { yupObject, yupString } from "../../schema-fields";
var connectedAccountAccessTokenReadSchema = yupObject({
  access_token: yupString().defined()
}).defined();
var connectedAccountAccessTokenCreateSchema = yupObject({
  scope: yupString().optional()
}).defined();
var connectedAccountAccessTokenCrud = createCrud({
  clientReadSchema: connectedAccountAccessTokenReadSchema,
  clientCreateSchema: connectedAccountAccessTokenCreateSchema,
  docs: {
    clientCreate: {
      hidden: true
    }
  }
});
export {
  connectedAccountAccessTokenCreateSchema,
  connectedAccountAccessTokenCrud,
  connectedAccountAccessTokenReadSchema
};
//# sourceMappingURL=oauth.js.map