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

// src/interface/crud/team-member-profiles.ts
var team_member_profiles_exports = {};
__export(team_member_profiles_exports, {
  teamMemberProfilesCrud: () => teamMemberProfilesCrud,
  teamMemberProfilesCrudClientReadSchema: () => teamMemberProfilesCrudClientReadSchema,
  teamMemberProfilesCrudClientUpdateSchema: () => teamMemberProfilesCrudClientUpdateSchema,
  teamMemberProfilesCrudServerReadSchema: () => teamMemberProfilesCrudServerReadSchema
});
module.exports = __toCommonJS(team_member_profiles_exports);
var import_crud = require("../../crud");
var schemaFields = __toESM(require("../../schema-fields"));
var import_schema_fields = require("../../schema-fields");
var import_users = require("./users");
var teamMemberProfilesCrudClientReadSchema = (0, import_schema_fields.yupObject)({
  team_id: schemaFields.teamIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
  display_name: schemaFields.teamMemberDisplayNameSchema.nullable().defined(),
  profile_image_url: schemaFields.teamMemberProfileImageUrlSchema.nullable().defined()
}).defined();
var teamMemberProfilesCrudServerReadSchema = teamMemberProfilesCrudClientReadSchema.concat((0, import_schema_fields.yupObject)({
  user: import_users.usersCrudServerReadSchema.defined()
})).defined();
var teamMemberProfilesCrudClientUpdateSchema = (0, import_schema_fields.yupObject)({
  display_name: schemaFields.teamMemberDisplayNameSchema.optional(),
  profile_image_url: schemaFields.teamMemberProfileImageUrlSchema.nullable().optional()
}).defined();
var teamMemberProfilesCrud = (0, import_crud.createCrud)({
  clientReadSchema: teamMemberProfilesCrudClientReadSchema,
  serverReadSchema: teamMemberProfilesCrudServerReadSchema,
  clientUpdateSchema: teamMemberProfilesCrudClientUpdateSchema,
  docs: {
    clientList: {
      summary: "List team members profiles",
      description: "List team members profiles. You always need to specify a `team_id` that your are a member of on the client. You can always filter for your own profile by setting `me` as the `user_id` in the path parameters. If you want list all the profiles in a team, you need to have the `$read_members` permission in that team.",
      tags: ["Teams"]
    },
    serverList: {
      summary: "List team members profiles",
      description: "List team members profiles and filter by team ID and user ID",
      tags: ["Teams"]
    },
    clientRead: {
      summary: "Get a team member profile",
      description: "Get a team member profile. you can always get your own profile by setting `me` as the `user_id` in the path parameters on the client. If you want to get someone else's profile in a team, you need to have the `$read_members` permission in that team.",
      tags: ["Teams"]
    },
    serverRead: {
      summary: "Get a team member profile",
      description: "Get a team member profile by user ID",
      tags: ["Teams"]
    },
    clientUpdate: {
      summary: "Update your team member profile",
      description: "Update your own team member profile. `user_id` must be `me` in the path parameters on the client.",
      tags: ["Teams"]
    },
    serverUpdate: {
      summary: "Update a team member profile",
      description: "Update a team member profile by user ID",
      tags: ["Teams"]
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  teamMemberProfilesCrud,
  teamMemberProfilesCrudClientReadSchema,
  teamMemberProfilesCrudClientUpdateSchema,
  teamMemberProfilesCrudServerReadSchema
});
//# sourceMappingURL=team-member-profiles.js.map