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

// src/utils/crypto.tsx
var crypto_exports = {};
__export(crypto_exports, {
  generateRandomValues: () => generateRandomValues,
  generateSecureRandomString: () => generateSecureRandomString
});
module.exports = __toCommonJS(crypto_exports);
var import_bytes = require("./bytes");
var import_errors = require("./errors");
var import_globals = require("./globals");
function generateRandomValues(array) {
  if (!import_globals.globalVar.crypto) {
    throw new import_errors.StackAssertionError("Crypto API is not available in this environment. Are you using an old browser?");
  }
  if (!import_globals.globalVar.crypto.getRandomValues) {
    throw new import_errors.StackAssertionError("crypto.getRandomValues is not available in this environment. Are you using an old browser?");
  }
  return import_globals.globalVar.crypto.getRandomValues(array);
}
function generateSecureRandomString(minBitsOfEntropy = 224) {
  const base32CharactersCount = Math.ceil(minBitsOfEntropy / 5);
  const bytesCount = Math.ceil(base32CharactersCount * 5 / 8);
  const randomBytes = generateRandomValues(new Uint8Array(bytesCount));
  const str = (0, import_bytes.encodeBase32)(randomBytes);
  return str.slice(str.length - base32CharactersCount).toLowerCase();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  generateRandomValues,
  generateSecureRandomString
});
//# sourceMappingURL=crypto.js.map