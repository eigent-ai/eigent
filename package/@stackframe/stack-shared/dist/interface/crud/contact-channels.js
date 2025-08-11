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

// src/interface/crud/contact-channels.ts
var contact_channels_exports = {};
__export(contact_channels_exports, {
  contactChannelsClientReadSchema: () => contactChannelsClientReadSchema,
  contactChannelsCrud: () => contactChannelsCrud,
  contactChannelsCrudClientCreateSchema: () => contactChannelsCrudClientCreateSchema,
  contactChannelsCrudClientDeleteSchema: () => contactChannelsCrudClientDeleteSchema,
  contactChannelsCrudClientUpdateSchema: () => contactChannelsCrudClientUpdateSchema,
  contactChannelsCrudServerCreateSchema: () => contactChannelsCrudServerCreateSchema,
  contactChannelsCrudServerUpdateSchema: () => contactChannelsCrudServerUpdateSchema
});
module.exports = __toCommonJS(contact_channels_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var contactChannelsClientReadSchema = (0, import_schema_fields.yupObject)({
  user_id: import_schema_fields.userIdSchema.defined(),
  id: import_schema_fields.contactChannelIdSchema.defined(),
  value: import_schema_fields.contactChannelValueSchema.defined(),
  type: import_schema_fields.contactChannelTypeSchema.defined(),
  used_for_auth: import_schema_fields.contactChannelUsedForAuthSchema.defined(),
  is_verified: import_schema_fields.contactChannelIsVerifiedSchema.defined(),
  is_primary: import_schema_fields.contactChannelIsPrimarySchema.defined()
}).defined();
var contactChannelsCrudClientUpdateSchema = (0, import_schema_fields.yupObject)({
  value: import_schema_fields.contactChannelValueSchema.optional(),
  type: import_schema_fields.contactChannelTypeSchema.optional(),
  used_for_auth: import_schema_fields.contactChannelUsedForAuthSchema.optional(),
  is_primary: import_schema_fields.contactChannelIsPrimarySchema.optional()
}).defined();
var contactChannelsCrudServerUpdateSchema = contactChannelsCrudClientUpdateSchema.concat((0, import_schema_fields.yupObject)({
  is_verified: import_schema_fields.contactChannelIsVerifiedSchema.optional()
}));
var contactChannelsCrudClientCreateSchema = (0, import_schema_fields.yupObject)({
  user_id: import_schema_fields.userIdOrMeSchema.defined(),
  value: import_schema_fields.contactChannelValueSchema.defined(),
  type: import_schema_fields.contactChannelTypeSchema.defined(),
  used_for_auth: import_schema_fields.contactChannelUsedForAuthSchema.defined(),
  is_primary: import_schema_fields.contactChannelIsPrimarySchema.optional()
}).defined();
var contactChannelsCrudServerCreateSchema = contactChannelsCrudClientCreateSchema.concat((0, import_schema_fields.yupObject)({
  is_verified: import_schema_fields.contactChannelIsVerifiedSchema.optional()
}));
var contactChannelsCrudClientDeleteSchema = (0, import_schema_fields.yupMixed)();
var contactChannelsCrud = (0, import_crud.createCrud)({
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  contactChannelsClientReadSchema,
  contactChannelsCrud,
  contactChannelsCrudClientCreateSchema,
  contactChannelsCrudClientDeleteSchema,
  contactChannelsCrudClientUpdateSchema,
  contactChannelsCrudServerCreateSchema,
  contactChannelsCrudServerUpdateSchema
});
//# sourceMappingURL=contact-channels.js.map