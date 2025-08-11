/**
 * An api key has the following format:
 * <prefix_without_underscores>_<secret_part_45_chars><id_part_32_chars><type_user_or_team_4_chars><scanner_and_marker_10_chars><checksum_8_chars>
 *
 * The scanner and marker is a base32 character that is used to determine if the api key is a public or private key
 * and if it is a cloud or self-hosted key.
 *
 * The checksum is a crc32 checksum of the api key encoded in hex.
 *
 */
type ProjectApiKey = {
    id: string;
    prefix: string;
    isPublic: boolean;
    isCloudVersion: boolean;
    secret: string;
    checksum: string;
    type: "user" | "team";
};
declare function isApiKey(secret: string): boolean;
declare function createProjectApiKey(options: Pick<ProjectApiKey, "id" | "isPublic" | "isCloudVersion" | "type">): string;
declare function parseProjectApiKey(secret: string): ProjectApiKey;

export { createProjectApiKey, isApiKey, parseProjectApiKey };
