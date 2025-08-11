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

// src/interface/crud/team-invitation.ts
var team_invitation_exports = {};
__export(team_invitation_exports, {
  teamInvitationCrud: () => teamInvitationCrud,
  teamInvitationDetailsClientReadSchema: () => teamInvitationDetailsClientReadSchema
});
module.exports = __toCommonJS(team_invitation_exports);
var import_crud = require("../../crud");
var schemaFields = __toESM(require("../../schema-fields"));
var import_schema_fields = require("../../schema-fields");
var teamInvitationDetailsClientReadSchema = (0, import_schema_fields.yupObject)({
  id: schemaFields.yupString().uuid().defined(),
  team_id: schemaFields.teamIdSchema.defined(),
  expires_at_millis: schemaFields.yupNumber().defined(),
  recipient_email: schemaFields.emailSchema.defined()
}).defined();
var teamInvitationCrud = (0, import_crud.createCrud)({
  clientReadSchema: teamInvitationDetailsClientReadSchema,
  clientDeleteSchema: schemaFields.yupMixed(),
  docs: {
    clientRead: {
      summary: "Get the team details with invitation code",
      description: "",
      tags: ["Teams"]
    },
    clientList: {
      summary: "List team invitations",
      description: "",
      tags: ["Teams"]
    },
    clientDelete: {
      summary: "Delete a team invitation",
      description: "",
      tags: ["Teams"]
    }
  }
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  teamInvitationCrud,
  teamInvitationDetailsClientReadSchema
});
//# sourceMappingURL=team-invitation.js.map