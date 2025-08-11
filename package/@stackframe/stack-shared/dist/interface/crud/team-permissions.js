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

// src/interface/crud/team-permissions.ts
var team_permissions_exports = {};
__export(team_permissions_exports, {
  teamPermissionCreatedWebhookEvent: () => teamPermissionCreatedWebhookEvent,
  teamPermissionDefinitionsCrud: () => teamPermissionDefinitionsCrud,
  teamPermissionDefinitionsCrudAdminCreateSchema: () => teamPermissionDefinitionsCrudAdminCreateSchema,
  teamPermissionDefinitionsCrudAdminDeleteSchema: () => teamPermissionDefinitionsCrudAdminDeleteSchema,
  teamPermissionDefinitionsCrudAdminReadSchema: () => teamPermissionDefinitionsCrudAdminReadSchema,
  teamPermissionDefinitionsCrudAdminUpdateSchema: () => teamPermissionDefinitionsCrudAdminUpdateSchema,
  teamPermissionDeletedWebhookEvent: () => teamPermissionDeletedWebhookEvent,
  teamPermissionsCrud: () => teamPermissionsCrud,
  teamPermissionsCrudClientReadSchema: () => teamPermissionsCrudClientReadSchema,
  teamPermissionsCrudServerCreateSchema: () => teamPermissionsCrudServerCreateSchema,
  teamPermissionsCrudServerDeleteSchema: () => teamPermissionsCrudServerDeleteSchema
});
module.exports = __toCommonJS(team_permissions_exports);
var import_crud = require("../../crud");
var schemaFields = __toESM(require("../../schema-fields"));
var import_schema_fields = require("../../schema-fields");
var teamPermissionsCrudClientReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
  team_id: schemaFields.teamIdSchema.defined()
}).defined();
var teamPermissionsCrudServerCreateSchema = (0, import_schema_fields.yupObject)({}).defined();
var teamPermissionsCrudServerDeleteSchema = (0, import_schema_fields.yupMixed)();
var teamPermissionsCrud = (0, import_crud.createCrud)({
  clientReadSchema: teamPermissionsCrudClientReadSchema,
  serverCreateSchema: teamPermissionsCrudServerCreateSchema,
  serverDeleteSchema: teamPermissionsCrudServerDeleteSchema,
  docs: {
    clientList: {
      summary: "List team permissions",
      description: "List team permissions of the current user. `user_id=me` must be set for client requests. Note that this might contain the permissions with the same permission ID across different teams. `(team_id, user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"]
    },
    serverList: {
      summary: "List team permissions of a user",
      description: "Query and filter the permission with `team_id`, `user_id`, and `permission_id`. Note that this might contain the permissions with the same permission ID across different teams and users. `(team_id, user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"]
    },
    serverCreate: {
      summary: "Grant a team permission to a user",
      description: "Grant a team permission to a user (the team permission must be created first on the Stack dashboard)",
      tags: ["Permissions"]
    },
    serverDelete: {
      summary: "Revoke a team permission from a user",
      description: "Revoke a team permission from a user",
      tags: ["Permissions"]
    }
  }
});
var teamPermissionCreatedWebhookEvent = {
  type: "team_permission.created",
  schema: teamPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Team Permission Created",
    description: "This event is triggered when a team permission is created.",
    tags: ["Teams"]
  }
};
var teamPermissionDeletedWebhookEvent = {
  type: "team_permission.deleted",
  schema: teamPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Team Permission Deleted",
    description: "This event is triggered when a team permission is deleted.",
    tags: ["Teams"]
  }
};
var teamPermissionDefinitionsCrudAdminReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.defined()
}).defined();
var teamPermissionDefinitionsCrudAdminCreateSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.customPermissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional()
}).defined();
var teamPermissionDefinitionsCrudAdminUpdateSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.customPermissionDefinitionIdSchema.optional(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional()
}).defined();
var teamPermissionDefinitionsCrudAdminDeleteSchema = (0, import_schema_fields.yupMixed)();
var teamPermissionDefinitionsCrud = (0, import_crud.createCrud)({
  adminReadSchema: teamPermissionDefinitionsCrudAdminReadSchema,
  adminCreateSchema: teamPermissionDefinitionsCrudAdminCreateSchema,
  adminUpdateSchema: teamPermissionDefinitionsCrudAdminUpdateSchema,
  adminDeleteSchema: teamPermissionDefinitionsCrudAdminDeleteSchema,
  docs: {
    adminList: {
      summary: "List team permission definitions",
      description: "Query and filter the permission with team_id, user_id, and permission_id (the equivalent of listing permissions on the Stack dashboard)",
      tags: ["Permissions"]
    },
    adminCreate: {
      summary: "Create a new team permission definition",
      description: "Create a new permission definition (the equivalent of creating a new permission on the Stack dashboard)",
      tags: ["Permissions"]
    },
    adminUpdate: {
      summary: "Update a team permission definition",
      description: "Update a permission definition (the equivalent of updating a permission on the Stack dashboard)",
      tags: ["Permissions"]
    },
    adminDelete: {
      summary: "Delete a team permission definition",
      description: "Delete a permission definition (the equivalent of deleting a permission on the Stack dashboard)",
      tags: ["Permissions"]
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  teamPermissionCreatedWebhookEvent,
  teamPermissionDefinitionsCrud,
  teamPermissionDefinitionsCrudAdminCreateSchema,
  teamPermissionDefinitionsCrudAdminDeleteSchema,
  teamPermissionDefinitionsCrudAdminReadSchema,
  teamPermissionDefinitionsCrudAdminUpdateSchema,
  teamPermissionDeletedWebhookEvent,
  teamPermissionsCrud,
  teamPermissionsCrudClientReadSchema,
  teamPermissionsCrudServerCreateSchema,
  teamPermissionsCrudServerDeleteSchema
});
//# sourceMappingURL=team-permissions.js.map