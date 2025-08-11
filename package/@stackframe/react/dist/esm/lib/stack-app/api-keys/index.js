// src/lib/stack-app/api-keys/index.ts
import { filterUndefined } from "@stackframe/stack-shared/dist/utils/objects";
async function apiKeyCreationOptionsToCrud(type, userIdOrTeamId, options) {
  return {
    description: options.description,
    expires_at_millis: options.expiresAt == null ? options.expiresAt : options.expiresAt.getTime(),
    is_public: options.isPublic,
    ...type === "user" ? { user_id: userIdOrTeamId } : { team_id: userIdOrTeamId }
  };
}
async function apiKeyUpdateOptionsToCrud(type, options) {
  return filterUndefined({
    description: options.description,
    expires_at_millis: options.expiresAt == null ? options.expiresAt : options.expiresAt.getTime(),
    revoked: options.revoked
  });
}
export {
  apiKeyCreationOptionsToCrud,
  apiKeyUpdateOptionsToCrud
};
//# sourceMappingURL=index.js.map