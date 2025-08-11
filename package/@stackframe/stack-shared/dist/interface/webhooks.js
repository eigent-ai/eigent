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

// src/interface/webhooks.ts
var webhooks_exports = {};
__export(webhooks_exports, {
  webhookEvents: () => webhookEvents
});
module.exports = __toCommonJS(webhooks_exports);
var import_team_memberships = require("./crud/team-memberships");
var import_team_permissions = require("./crud/team-permissions");
var import_teams = require("./crud/teams");
var import_users = require("./crud/users");
var webhookEvents = [
  import_users.userCreatedWebhookEvent,
  import_users.userUpdatedWebhookEvent,
  import_users.userDeletedWebhookEvent,
  import_teams.teamCreatedWebhookEvent,
  import_teams.teamUpdatedWebhookEvent,
  import_teams.teamDeletedWebhookEvent,
  import_team_memberships.teamMembershipCreatedWebhookEvent,
  import_team_memberships.teamMembershipDeletedWebhookEvent,
  import_team_permissions.teamPermissionCreatedWebhookEvent,
  import_team_permissions.teamPermissionDeletedWebhookEvent
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  webhookEvents
});
//# sourceMappingURL=webhooks.js.map