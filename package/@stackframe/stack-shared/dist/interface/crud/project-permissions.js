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

// src/interface/crud/project-permissions.ts
var project_permissions_exports = {};
__export(project_permissions_exports, {
  projectPermissionCreatedWebhookEvent: () => projectPermissionCreatedWebhookEvent,
  projectPermissionDefinitionsCrud: () => projectPermissionDefinitionsCrud,
  projectPermissionDefinitionsCrudAdminCreateSchema: () => projectPermissionDefinitionsCrudAdminCreateSchema,
  projectPermissionDefinitionsCrudAdminDeleteSchema: () => projectPermissionDefinitionsCrudAdminDeleteSchema,
  projectPermissionDefinitionsCrudAdminReadSchema: () => projectPermissionDefinitionsCrudAdminReadSchema,
  projectPermissionDefinitionsCrudAdminUpdateSchema: () => projectPermissionDefinitionsCrudAdminUpdateSchema,
  projectPermissionDeletedWebhookEvent: () => projectPermissionDeletedWebhookEvent,
  projectPermissionsCrud: () => projectPermissionsCrud,
  projectPermissionsCrudClientReadSchema: () => projectPermissionsCrudClientReadSchema,
  projectPermissionsCrudServerCreateSchema: () => projectPermissionsCrudServerCreateSchema,
  projectPermissionsCrudServerDeleteSchema: () => projectPermissionsCrudServerDeleteSchema
});
module.exports = __toCommonJS(project_permissions_exports);
var import_crud = require("../../crud");
var schemaFields = __toESM(require("../../schema-fields"));
var import_schema_fields = require("../../schema-fields");
var projectPermissionsCrudClientReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined()
}).defined();
var projectPermissionsCrudServerCreateSchema = (0, import_schema_fields.yupObject)({}).defined();
var projectPermissionsCrudServerDeleteSchema = (0, import_schema_fields.yupMixed)();
var projectPermissionsCrud = (0, import_crud.createCrud)({
  clientReadSchema: projectPermissionsCrudClientReadSchema,
  serverCreateSchema: projectPermissionsCrudServerCreateSchema,
  serverDeleteSchema: projectPermissionsCrudServerDeleteSchema,
  docs: {
    clientList: {
      summary: "List project permissions",
      description: "List global permissions of the current user. `user_id=me` must be set for client requests. `(user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"]
    },
    serverList: {
      summary: "List project permissions",
      description: "Query and filter the permission with `user_id` and `permission_id`. `(user_id, permission_id)` together uniquely identify a permission.",
      tags: ["Permissions"]
    },
    serverCreate: {
      summary: "Grant a global permission to a user",
      description: "Grant a global permission to a user (the permission must be created first on the Stack dashboard)",
      tags: ["Permissions"]
    },
    serverDelete: {
      summary: "Revoke a global permission from a user",
      description: "Revoke a global permission from a user",
      tags: ["Permissions"]
    }
  }
});
var projectPermissionCreatedWebhookEvent = {
  type: "project_permission.created",
  schema: projectPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Project Permission Created",
    description: "This event is triggered when a project permission is created.",
    tags: ["Users"]
  }
};
var projectPermissionDeletedWebhookEvent = {
  type: "project_permission.deleted",
  schema: projectPermissionsCrud.server.readSchema,
  metadata: {
    summary: "Project Permission Deleted",
    description: "This event is triggered when a project permission is deleted.",
    tags: ["Users"]
  }
};
var projectPermissionDefinitionsCrudAdminReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.defined()
}).defined();
var projectPermissionDefinitionsCrudAdminCreateSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.customPermissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional()
}).defined();
var projectPermissionDefinitionsCrudAdminUpdateSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.customPermissionDefinitionIdSchema.optional(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional()
}).defined();
var projectPermissionDefinitionsCrudAdminDeleteSchema = (0, import_schema_fields.yupMixed)();
var projectPermissionDefinitionsCrud = (0, import_crud.createCrud)({
  adminReadSchema: projectPermissionDefinitionsCrudAdminReadSchema,
  adminCreateSchema: projectPermissionDefinitionsCrudAdminCreateSchema,
  adminUpdateSchema: projectPermissionDefinitionsCrudAdminUpdateSchema,
  adminDeleteSchema: projectPermissionDefinitionsCrudAdminDeleteSchema,
  docs: {
    adminList: {
      summary: "List project permission definitions",
      description: "Query and filter project permission definitions (the equivalent of listing permissions on the Stack dashboard)",
      tags: ["Permissions"]
    },
    adminCreate: {
      summary: "Create a new project permission definition",
      description: "Create a new project permission definition (the equivalent of creating a new permission on the Stack dashboard)",
      tags: ["Permissions"]
    },
    adminUpdate: {
      summary: "Update a project permission definition",
      description: "Update a project permission definition (the equivalent of updating a permission on the Stack dashboard)",
      tags: ["Permissions"]
    },
    adminDelete: {
      summary: "Delete a project permission definition",
      description: "Delete a project permission definition (the equivalent of deleting a permission on the Stack dashboard)",
      tags: ["Permissions"]
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  projectPermissionCreatedWebhookEvent,
  projectPermissionDefinitionsCrud,
  projectPermissionDefinitionsCrudAdminCreateSchema,
  projectPermissionDefinitionsCrudAdminDeleteSchema,
  projectPermissionDefinitionsCrudAdminReadSchema,
  projectPermissionDefinitionsCrudAdminUpdateSchema,
  projectPermissionDeletedWebhookEvent,
  projectPermissionsCrud,
  projectPermissionsCrudClientReadSchema,
  projectPermissionsCrudServerCreateSchema,
  projectPermissionsCrudServerDeleteSchema
});
//# sourceMappingURL=project-permissions.js.map