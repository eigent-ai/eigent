// src/utils/api-keys.tsx
import crc32 from "crc/crc32";
import { getBase32CharacterFromIndex } from "./bytes";
import { generateSecureRandomString } from "./crypto";
import { StackAssertionError } from "./errors";
var STACK_AUTH_MARKER = "574ck4u7h";
var API_KEY_LENGTHS = {
  SECRET_PART: 45,
  ID_PART: 32,
  TYPE_PART: 4,
  SCANNER: 1,
  MARKER: 9,
  CHECKSUM: 8
};
function createChecksumSync(checksummablePart) {
  const data = new TextEncoder().encode(checksummablePart);
  const calculated_checksum = crc32(data);
  return calculated_checksum.toString(16).padStart(8, "0");
}
function createApiKeyParts(options) {
  const { id, isPublic, isCloudVersion, type } = options;
  const prefix = isPublic ? "pk" : "sk";
  const scannerFlag = (isCloudVersion ? 0 : 1) + (isPublic ? 2 : 0) + /* version */
  0;
  const secretPart = generateSecureRandomString();
  const idPart = id.replace(/-/g, "");
  const scannerAndMarker = getBase32CharacterFromIndex(scannerFlag).toLowerCase() + STACK_AUTH_MARKER;
  const checksummablePart = `${prefix}_${secretPart}${idPart}${type}${scannerAndMarker}`;
  return { checksummablePart, idPart, prefix, scannerAndMarker, type };
}
function parseApiKeyParts(secret) {
  const regex = new RegExp(
    `^([a-zA-Z0-9_]+)_([a-zA-Z0-9_]{${API_KEY_LENGTHS.SECRET_PART}})([a-zA-Z0-9_]{${API_KEY_LENGTHS.ID_PART}})([a-zA-Z0-9_]{${API_KEY_LENGTHS.TYPE_PART}})([a-zA-Z0-9_]{${API_KEY_LENGTHS.SCANNER}})(${STACK_AUTH_MARKER})([a-zA-Z0-9_]{${API_KEY_LENGTHS.CHECKSUM}})$`
    // checksum
  );
  const match = secret.match(regex);
  if (!match) {
    throw new StackAssertionError("Invalid API key format");
  }
  const [, prefix, secretPart, idPart, type, scannerFlag, marker, checksum] = match;
  const isCloudVersion = parseInt(scannerFlag, 32) % 2 === 0;
  const isPublic = (parseInt(scannerFlag, 32) & 2) !== 0;
  const checksummablePart = `${prefix}_${secretPart}${idPart}${type}${scannerFlag}${marker}`;
  const restored_id = idPart.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  if (!["user", "team"].includes(type)) {
    throw new StackAssertionError("Invalid type");
  }
  return { checksummablePart, checksum, id: restored_id, isCloudVersion, isPublic, prefix, type };
}
function isApiKey(secret) {
  return secret.includes("_") && secret.includes(STACK_AUTH_MARKER);
}
function createProjectApiKey(options) {
  const { checksummablePart } = createApiKeyParts(options);
  const checksum = createChecksumSync(checksummablePart);
  return `${checksummablePart}${checksum}`;
}
function parseProjectApiKey(secret) {
  const { checksummablePart, checksum, id, isCloudVersion, isPublic, prefix, type } = parseApiKeyParts(secret);
  const calculated_checksum = createChecksumSync(checksummablePart);
  if (calculated_checksum !== checksum) {
    throw new StackAssertionError("Checksum mismatch");
  }
  return {
    id,
    prefix,
    isPublic,
    isCloudVersion,
    secret,
    checksum,
    type
  };
}
export {
  createProjectApiKey,
  isApiKey,
  parseProjectApiKey
};
//# sourceMappingURL=api-keys.js.map