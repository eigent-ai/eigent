"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/interface/crud/teams.ts
var teams_exports = {};
__export(teams_exports, {
  teamCreatedWebhookEvent: () => teamCreatedWebhookEvent,
  teamDeletedWebhookEvent: () => teamDeletedWebhookEvent,
  teamUpdatedWebhookEvent: () => teamUpdatedWebhookEvent,
  teamsCrud: () => teamsCrud,
  teamsCrudClientCreateSchema: () => teamsCrudClientCreateSchema,
  teamsCrudClientDeleteSchema: () => teamsCrudClientDeleteSchema,
  teamsCrudClientReadSchema: () => teamsCrudClientReadSchema,
  teamsCrudClientUpdateSchema: () => teamsCrudClientUpdateSchema,
  teamsCrudServerCreateSchema: () => teamsCrudServerCreateSchema,
  teamsCrudServerDeleteSchema: () => teamsCrudServerDeleteSchema,
  teamsCrudServerReadSchema: () => teamsCrudServerReadSchema,
  teamsCrudServerUpdateSchema: () => teamsCrudServerUpdateSchema
});
module.exports = __toCommonJS(teams_exports);
var import_crud = require("../../crud");
var fieldSchema = __toESM(require("../../schema-fields"));
var import_schema_fields = require("../../schema-fields");
var teamsCrudClientReadSchema = (0, import_schema_fields.yupObject)({
  id: fieldSchema.teamIdSchema.defined(),
  display_name: fieldSchema.teamDisplayNameSchema.defined(),
  profile_image_url: fieldSchema.teamProfileImageUrlSchema.nullable().defined(),
  client_metadata: fieldSchema.teamClientMetadataSchema.optional(),
  client_read_only_metadata: fieldSchema.teamClientReadOnlyMetadataSchema.optional()
}).defined();
var teamsCrudServerReadSchema = teamsCrudClientReadSchema.concat((0, import_schema_fields.yupObject)({
  created_at_millis: fieldSchema.teamCreatedAtMillisSchema.defined(),
  server_metadata: fieldSchema.teamServerMetadataSchema.optional()
}).defined());
var teamsCrudClientUpdateSchema = (0, import_schema_fields.yupObject)({
  display_name: fieldSchema.teamDisplayNameSchema.optional(),
  profile_image_url: fieldSchema.teamProfileImageUrlSchema.nullable().optional(),
  client_metadata: fieldSchema.teamClientMetadataSchema.optional()
}).defined();
var teamsCrudServerUpdateSchema = teamsCrudClientUpdateSchema.concat((0, import_schema_fields.yupObject)({
  client_read_only_metadata: fieldSchema.teamClientReadOnlyMetadataSchema.optional(),
  server_metadata: fieldSchema.teamServerMetadataSchema.optional()
}).defined());
var teamsCrudClientCreateSchema = teamsCrudClientUpdateSchema.concat((0, import_schema_fields.yupObject)({
  display_name: fieldSchema.teamDisplayNameSchema.defined(),
  creator_user_id: fieldSchema.teamCreatorUserIdSchema.optional()
}).defined());
var teamsCrudServerCreateSchema = teamsCrudServerUpdateSchema.concat((0, import_schema_fields.yupObject)({
  display_name: fieldSchema.teamDisplayNameSchema.defined(),
  creator_user_id: fieldSchema.teamCreatorUserIdSchema.optional()
}).defined());
var teamsCrudClientDeleteSchema = fieldSchema.yupMixed();
var teamsCrudServerDeleteSchema = teamsCrudClientDeleteSchema;
var teamsCrud = (0, import_crud.createCrud)({
  // Client
  clientReadSchema: teamsCrudClientReadSchema,
  clientUpdateSchema: teamsCrudClientUpdateSchema,
  clientCreateSchema: teamsCrudClientCreateSchema,
  clientDeleteSchema: teamsCrudClientDeleteSchema,
  // Server
  serverReadSchema: teamsCrudServerReadSchema,
  serverUpdateSchema: teamsCrudServerUpdateSchema,
  serverCreateSchema: teamsCrudServerCreateSchema,
  serverDeleteSchema: teamsCrudServerDeleteSchema,
  docs: {
    clientList: {
      summary: "List teams",
      description: "List all the teams that the current user is a member of. `user_id=me` must be passed in the query parameters.",
      tags: ["Teams"]
    },
    clientCreate: {
      summary: "Create a team",
      description: "Create a new team and optionally add the current user as a member.",
      tags: ["Teams"]
    },
    clientRead: {
      summary: "Get a team",
      description: "Get a team that the current user is a member of.",
      tags: ["Teams"]
    },
    clientUpdate: {
      summary: "Update a team",
      description: "Update the team information. Only allowed if the current user is a member of the team and has the `$update_team` permission.",
      tags: ["Teams"]
    },
    clientDelete: {
      summary: "Delete a team",
      description: "Delete a team. Only allowed if the current user is a member of the team and has the `$delete_team` permission.",
      tags: ["Teams"]
    },
    serverCreate: {
      summary: "Create a team",
      description: "Create a new team and optionally add the current user as a member.",
      tags: ["Teams"]
    },
    serverList: {
      summary: "List teams",
      description: "List all the teams in the project.",
      tags: ["Teams"]
    },
    serverRead: {
      summary: "Get a team",
      description: "Get a team by ID.",
      tags: ["Teams"]
    },
    serverUpdate: {
      summary: "Update a team",
      description: "Update the team information by ID.",
      tags: ["Teams"]
    },
    serverDelete: {
      summary: "Delete a team",
      description: "Delete a team by ID.",
      tags: ["Teams"]
    }
  }
});
var teamCreatedWebhookEvent = {
  type: "team.created",
  schema: teamsCrud.server.readSchema,
  metadata: {
    summary: "Team Created",
    description: "This event is triggered when a team is created.",
    tags: ["Teams"]
  }
};
var teamUpdatedWebhookEvent = {
  type: "team.updated",
  schema: teamsCrud.server.readSchema,
  metadata: {
    summary: "Team Updated",
    description: "This event is triggered when a team is updated.",
    tags: ["Teams"]
  }
};
var webhookTeamDeletedSchema = fieldSchema.yupObject({
  id: fieldSchema.userIdSchema.defined()
}).defined();
var teamDeletedWebhookEvent = {
  type: "team.deleted",
  schema: webhookTeamDeletedSchema,
  metadata: {
    summary: "Team Deleted",
    description: "This event is triggered when a team is deleted.",
    tags: ["Teams"]
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  teamCreatedWebhookEvent,
  teamDeletedWebhookEvent,
  teamUpdatedWebhookEvent,
  teamsCrud,
  teamsCrudClientCreateSchema,
  teamsCrudClientDeleteSchema,
  teamsCrudClientReadSchema,
  teamsCrudClientUpdateSchema,
  teamsCrudServerCreateSchema,
  teamsCrudServerDeleteSchema,
  teamsCrudServerReadSchema,
  teamsCrudServerUpdateSchema
});
//# sourceMappingURL=teams.js.map