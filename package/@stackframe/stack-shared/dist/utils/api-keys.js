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

// src/utils/api-keys.tsx
var api_keys_exports = {};
__export(api_keys_exports, {
  createProjectApiKey: () => createProjectApiKey,
  isApiKey: () => isApiKey,
  parseProjectApiKey: () => parseProjectApiKey
});
module.exports = __toCommonJS(api_keys_exports);
var import_crc32 = __toESM(require("crc/crc32"));
var import_bytes = require("./bytes");
var import_crypto = require("./crypto");
var import_errors = require("./errors");
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
  const calculated_checksum = (0, import_crc32.default)(data);
  return calculated_checksum.toString(16).padStart(8, "0");
}
function createApiKeyParts(options) {
  const { id, isPublic, isCloudVersion, type } = options;
  const prefix = isPublic ? "pk" : "sk";
  const scannerFlag = (isCloudVersion ? 0 : 1) + (isPublic ? 2 : 0) + /* version */
  0;
  const secretPart = (0, import_crypto.generateSecureRandomString)();
  const idPart = id.replace(/-/g, "");
  const scannerAndMarker = (0, import_bytes.getBase32CharacterFromIndex)(scannerFlag).toLowerCase() + STACK_AUTH_MARKER;
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
    throw new import_errors.StackAssertionError("Invalid API key format");
  }
  const [, prefix, secretPart, idPart, type, scannerFlag, marker, checksum] = match;
  const isCloudVersion = parseInt(scannerFlag, 32) % 2 === 0;
  const isPublic = (parseInt(scannerFlag, 32) & 2) !== 0;
  const checksummablePart = `${prefix}_${secretPart}${idPart}${type}${scannerFlag}${marker}`;
  const restored_id = idPart.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5");
  if (!["user", "team"].includes(type)) {
    throw new import_errors.StackAssertionError("Invalid type");
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
    throw new import_errors.StackAssertionError("Checksum mismatch");
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createProjectApiKey,
  isApiKey,
  parseProjectApiKey
});
//# sourceMappingURL=api-keys.js.map