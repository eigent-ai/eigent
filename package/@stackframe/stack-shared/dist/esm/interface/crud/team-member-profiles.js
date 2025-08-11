// src/interface/crud/team-member-profiles.ts
import { createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";
import { usersCrudServerReadSchema } from "./users";
var teamMemberProfilesCrudClientReadSchema = yupObject({
  team_id: schemaFields.teamIdSchema.defined(),
  user_id: schemaFields.userIdSchema.defined(),
  display_name: schemaFields.teamMemberDisplayNameSchema.nullable().defined(),
  profile_image_url: schemaFields.teamMemberProfileImageUrlSchema.nullable().defined()
}).defined();
var teamMemberProfilesCrudServerReadSchema = teamMemberProfilesCrudClientReadSchema.concat(yupObject({
  user: usersCrudServerReadSchema.defined()
})).defined();
var teamMemberProfilesCrudClientUpdateSchema = yupObject({
  display_name: schemaFields.teamMemberDisplayNameSchema.optional(),
  profile_image_url: schemaFields.teamMemberProfileImageUrlSchema.nullable().optional()
}).defined();
var teamMemberProfilesCrud = createCrud({
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
export {
  teamMemberProfilesCrud,
  teamMemberProfilesCrudClientReadSchema,
  teamMemberProfilesCrudClientUpdateSchema,
  teamMemberProfilesCrudServerReadSchema
};
//# sourceMappingURL=team-member-profiles.js.map