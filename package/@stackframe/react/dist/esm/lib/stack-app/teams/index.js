// src/lib/stack-app/teams/index.ts
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
export {
  serverTeamCreateOptionsToCrud,
  serverTeamUpdateOptionsToCrud,
  teamCreateOptionsToCrud,
  teamUpdateOptionsToCrud
};
//# sourceMappingURL=index.js.map