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

// src/utils/hashes.tsx
var hashes_exports = {};
__export(hashes_exports, {
  comparePassword: () => comparePassword,
  getPasswordHashAlgorithm: () => getPasswordHashAlgorithm,
  hashPassword: () => hashPassword,
  isPasswordHashValid: () => isPasswordHashValid,
  sha512: () => sha512
});
module.exports = __toCommonJS(hashes_exports);
var import_bcryptjs = __toESM(require("bcryptjs"));
var import_errors = require("./errors");
async function sha512(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest("SHA-512", bytes));
}
async function hashPassword(password) {
  const passwordBytes = new TextEncoder().encode(password);
  if (passwordBytes.length >= 72) {
    throw new import_errors.StackAssertionError(`Password is too long for bcrypt`, { len: passwordBytes.length });
  }
  const salt = await import_bcryptjs.default.genSalt(10);
  return await import_bcryptjs.default.hash(password, salt);
}
async function comparePassword(password, hash) {
  switch (await getPasswordHashAlgorithm(hash)) {
    case "bcrypt": {
      return await import_bcryptjs.default.compare(password, hash);
    }
    default: {
      return false;
    }
  }
}
async function isPasswordHashValid(hash) {
  return !!await getPasswordHashAlgorithm(hash);
}
async function getPasswordHashAlgorithm(hash) {
  if (typeof hash !== "string") {
    throw new import_errors.StackAssertionError(`Passed non-string value to getPasswordHashAlgorithm`, { hash });
  }
  if (hash.match(/^\$2[ayb]\$.{56}$/)) {
    try {
      if (import_bcryptjs.default.getRounds(hash) > 16) {
        return void 0;
      }
      await import_bcryptjs.default.compare("any string", hash);
      return "bcrypt";
    } catch (e) {
      console.warn(`Error while checking bcrypt password hash. Assuming the hash is invalid`, e);
      return void 0;
    }
  } else {
    return void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  comparePassword,
  getPasswordHashAlgorithm,
  hashPassword,
  isPasswordHashValid,
  sha512
});
//# sourceMappingURL=hashes.js.map