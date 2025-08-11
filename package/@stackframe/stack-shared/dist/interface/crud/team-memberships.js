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

// src/interface/crud/team-memberships.ts
var team_memberships_exports = {};
__export(team_memberships_exports, {
  teamMembershipCreatedWebhookEvent: () => teamMembershipCreatedWebhookEvent,
  teamMembershipDeletedWebhookEvent: () => teamMembershipDeletedWebhookEvent,
  teamMembershipsCrud: () => teamMembershipsCrud,
  teamMembershipsCrudClientDeleteSchema: () => teamMembershipsCrudClientDeleteSchema,
  teamMembershipsCrudClientReadSchema: () => teamMembershipsCrudClientReadSchema,
  teamMembershipsCrudServerCreateSchema: () => teamMembershipsCrudServerCreateSchema
});
module.exports = __toCommonJS(team_memberships_exports);
var import_crud = require("../../crud");
var import_schema_fields = require("../../schema-fields");
var teamMembershipsCrudClientReadSchema = (0, import_schema_fields.yupObject)({
  team_id: (0, import_schema_fields.yupString)().defined(),
  user_id: (0, import_schema_fields.yupString)().defined()
}).defined();
var teamMembershipsCrudServerCreateSchema = (0, import_schema_fields.yupObject)({}).defined();
var teamMembershipsCrudClientDeleteSchema = (0, import_schema_fields.yupMixed)();
var teamMembershipsCrud = (0, import_crud.createCrud)({
  // Client
  clientReadSchema: teamMembershipsCrudClientReadSchema,
  clientDeleteSchema: teamMembershipsCrudClientDeleteSchema,
  // Server
  serverCreateSchema: teamMembershipsCrudServerCreateSchema,
  docs: {
    serverCreate: {
      summary: "Add a user to a team",
      description: "",
      tags: ["Teams"]
    },
    clientDelete: {
      summary: "Remove a user from a team",
      description: "All the users are allowed to remove themselves from a team (`user_id=me`). Only the users who have the `$remove_members` permission are allowed to remove other users from a team. `team_id` is must an ID of a team that the user is a member of.",
      tags: ["Teams"]
    },
    serverDelete: {
      summary: "Remove a user from a team",
      description: "",
      tags: ["Teams"]
    }
  }
});
var teamMembershipCreatedWebhookEvent = {
  type: "team_membership.created",
  schema: teamMembershipsCrud.server.readSchema,
  metadata: {
    summary: "Team Membership Created",
    description: "This event is triggered when a user is added to a team.",
    tags: ["Teams"]
  }
};
var teamMembershipDeletedWebhookEvent = {
  type: "team_membership.deleted",
  schema: teamMembershipsCrud.server.readSchema,
  metadata: {
    summary: "Team Membership Deleted",
    description: "This event is triggered when a user is removed from a team.",
    tags: ["Teams"]
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  teamMembershipCreatedWebhookEvent,
  teamMembershipDeletedWebhookEvent,
  teamMembershipsCrud,
  teamMembershipsCrudClientDeleteSchema,
  teamMembershipsCrudClientReadSchema,
  teamMembershipsCrudServerCreateSchema
});
//# sourceMappingURL=team-memberships.js.map