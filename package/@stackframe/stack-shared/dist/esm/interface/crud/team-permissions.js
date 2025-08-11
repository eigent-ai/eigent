// src/interface/crud/team-permissions.ts
import { createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupMixed, yupObject } from "../../schema-fields";
var teamPermissionsCrudClientReadSchema = yupObject({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
  team_id: schemaFields.teamIdSchema.defined()
}).defined();
var teamPermissionsCrudServerCreateSchema = yupObject({}).defined();
var teamPermissionsCrudServerDeleteSchema = yupMixed();
var teamPermissionsCrud = createCrud({
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
var teamPermissionDefinitionsCrudAdminReadSchema = yupObject({
  id: schemaFields.permissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.defined()
}).defined();
var teamPermissionDefinitionsCrudAdminCreateSchema = yupObject({
  id: schemaFields.customPermissionDefinitionIdSchema.defined(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional()
}).defined();
var teamPermissionDefinitionsCrudAdminUpdateSchema = yupObject({
  id: schemaFields.customPermissionDefinitionIdSchema.optional(),
  description: schemaFields.teamPermissionDescriptionSchema.optional(),
  contained_permission_ids: schemaFields.containedPermissionIdsSchema.optional()
}).defined();
var teamPermissionDefinitionsCrudAdminDeleteSchema = yupMixed();
var teamPermissionDefinitionsCrud = createCrud({
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
export {
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
};
//# sourceMappingURL=team-permissions.js.map