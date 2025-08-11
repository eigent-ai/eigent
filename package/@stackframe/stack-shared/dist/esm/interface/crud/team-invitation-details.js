// src/interface/crud/team-invitation-details.ts
import { createCrud } from "../../crud";
import * as schemaFields from "../../schema-fields";
import { yupObject } from "../../schema-fields";
var teamInvitationDetailsClientReadSchema = yupObject({
  team_id: schemaFields.teamIdSchema.defined(),
  team_display_name: schemaFields.teamDisplayNameSchema.defined()
}).defined();
var teamInvitationDetailsCrud = createCrud({
  clientReadSchema: teamInvitationDetailsClientReadSchema,
  docs: {
    clientRead: {
      summary: "Get the team details with invitation code",
      description: "",
      tags: ["Teams"]
    }
  }
});
export {
  teamInvitationDetailsClientReadSchema,
  teamInvitationDetailsCrud
};
//# sourceMappingURL=team-invitation-details.js.map