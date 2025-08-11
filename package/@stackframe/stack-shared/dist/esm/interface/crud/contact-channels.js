// src/interface/crud/contact-channels.ts
import { createCrud } from "../../crud";
import { contactChannelIdSchema, contactChannelIsPrimarySchema, contactChannelIsVerifiedSchema, contactChannelTypeSchema, contactChannelUsedForAuthSchema, contactChannelValueSchema, userIdOrMeSchema, userIdSchema, yupMixed, yupObject } from "../../schema-fields";
var contactChannelsClientReadSchema = yupObject({
  user_id: userIdSchema.defined(),
  id: contactChannelIdSchema.defined(),
  value: contactChannelValueSchema.defined(),
  type: contactChannelTypeSchema.defined(),
  used_for_auth: contactChannelUsedForAuthSchema.defined(),
  is_verified: contactChannelIsVerifiedSchema.defined(),
  is_primary: contactChannelIsPrimarySchema.defined()
}).defined();
var contactChannelsCrudClientUpdateSchema = yupObject({
  value: contactChannelValueSchema.optional(),
  type: contactChannelTypeSchema.optional(),
  used_for_auth: contactChannelUsedForAuthSchema.optional(),
  is_primary: contactChannelIsPrimarySchema.optional()
}).defined();
var contactChannelsCrudServerUpdateSchema = contactChannelsCrudClientUpdateSchema.concat(yupObject({
  is_verified: contactChannelIsVerifiedSchema.optional()
}));
var contactChannelsCrudClientCreateSchema = yupObject({
  user_id: userIdOrMeSchema.defined(),
  value: contactChannelValueSchema.defined(),
  type: contactChannelTypeSchema.defined(),
  used_for_auth: contactChannelUsedForAuthSchema.defined(),
  is_primary: contactChannelIsPrimarySchema.optional()
}).defined();
var contactChannelsCrudServerCreateSchema = contactChannelsCrudClientCreateSchema.concat(yupObject({
  is_verified: contactChannelIsVerifiedSchema.optional()
}));
var contactChannelsCrudClientDeleteSchema = yupMixed();
var contactChannelsCrud = createCrud({
  clientReadSchema: contactChannelsClientReadSchema,
  clientUpdateSchema: contactChannelsCrudClientUpdateSchema,
  clientCreateSchema: contactChannelsCrudClientCreateSchema,
  clientDeleteSchema: contactChannelsCrudClientDeleteSchema,
  serverUpdateSchema: contactChannelsCrudServerUpdateSchema,
  serverCreateSchema: contactChannelsCrudServerCreateSchema,
  docs: {
    clientRead: {
      summary: "Get a contact channel",
      description: "Retrieves a specific contact channel by the user ID and the contact channel ID.",
      tags: ["Contact Channels"]
    },
    clientCreate: {
      summary: "Create a contact channel",
      description: "Add a new contact channel for a user.",
      tags: ["Contact Channels"]
    },
    clientUpdate: {
      summary: "Update a contact channel",
      description: "Updates an existing contact channel. Only the values provided will be updated.",
      tags: ["Contact Channels"]
    },
    clientDelete: {
      summary: "Delete a contact channel",
      description: "Removes a contact channel for a given user.",
      tags: ["Contact Channels"]
    },
    clientList: {
      summary: "List contact channels",
      description: "Retrieves a list of all contact channels for a user.",
      tags: ["Contact Channels"]
    }
  }
});
export {
  contactChannelsClientReadSchema,
  contactChannelsCrud,
  contactChannelsCrudClientCreateSchema,
  contactChannelsCrudClientDeleteSchema,
  contactChannelsCrudClientUpdateSchema,
  contactChannelsCrudServerCreateSchema,
  contactChannelsCrudServerUpdateSchema
};
//# sourceMappingURL=contact-channels.js.map