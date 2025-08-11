// src/interface/webhooks.ts
import { teamMembershipCreatedWebhookEvent, teamMembershipDeletedWebhookEvent } from "./crud/team-memberships";
import { teamPermissionCreatedWebhookEvent, teamPermissionDeletedWebhookEvent } from "./crud/team-permissions";
import { teamCreatedWebhookEvent, teamDeletedWebhookEvent, teamUpdatedWebhookEvent } from "./crud/teams";
import { userCreatedWebhookEvent, userDeletedWebhookEvent, userUpdatedWebhookEvent } from "./crud/users";
var webhookEvents = [
  userCreatedWebhookEvent,
  userUpdatedWebhookEvent,
  userDeletedWebhookEvent,
  teamCreatedWebhookEvent,
  teamUpdatedWebhookEvent,
  teamDeletedWebhookEvent,
  teamMembershipCreatedWebhookEvent,
  teamMembershipDeletedWebhookEvent,
  teamPermissionCreatedWebhookEvent,
  teamPermissionDeletedWebhookEvent
];
export {
  webhookEvents
};
//# sourceMappingURL=webhooks.js.map