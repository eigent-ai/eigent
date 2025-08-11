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

// src/lib/stack-app/teams/index.ts
var teams_exports = {};
__export(teams_exports, {
  serverTeamCreateOptionsToCrud: () => serverTeamCreateOptionsToCrud,
  serverTeamUpdateOptionsToCrud: () => serverTeamUpdateOptionsToCrud,
  teamCreateOptionsToCrud: () => teamCreateOptionsToCrud,
  teamUpdateOptionsToCrud: () => teamUpdateOptionsToCrud
});
module.exports = __toCommonJS(teams_exports);
function teamUpdateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    client_metadata: options.clientMetadata
  };
}
function teamCreateOptionsToCrud(options, creatorUserId) {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    creator_user_id: creatorUserId
  };
}
function serverTeamCreateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    creator_user_id: options.creatorUserId
  };
}
function serverTeamUpdateOptionsToCrud(options) {
  return {
    display_name: options.displayName,
    profile_image_url: options.profileImageUrl,
    client_metadata: options.clientMetadata,
    client_read_only_metadata: options.clientReadOnlyMetadata,
    server_metadata: options.serverMetadata
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  serverTeamCreateOptionsToCrud,
  serverTeamUpdateOptionsToCrud,
  teamCreateOptionsToCrud,
  teamUpdateOptionsToCrud
});
//# sourceMappingURL=index.js.map