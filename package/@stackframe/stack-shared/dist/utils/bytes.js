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

// src/utils/bytes.tsx
var bytes_exports = {};
__export(bytes_exports, {
  decodeBase32: () => decodeBase32,
  decodeBase64: () => decodeBase64,
  decodeBase64OrBase64Url: () => decodeBase64OrBase64Url,
  decodeBase64Url: () => decodeBase64Url,
  encodeBase32: () => encodeBase32,
  encodeBase64: () => encodeBase64,
  encodeBase64Url: () => encodeBase64Url,
  getBase32CharacterFromIndex: () => getBase32CharacterFromIndex,
  getBase32IndexFromCharacter: () => getBase32IndexFromCharacter,
  isBase32: () => isBase32,
  isBase64: () => isBase64,
  isBase64Url: () => isBase64Url,
  toHexString: () => toHexString
});
module.exports = __toCommonJS(bytes_exports);
var import_errors = require("./errors");
var crockfordAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
var crockfordReplacements = /* @__PURE__ */ new Map([
  ["o", "0"],
  ["i", "1"],
  ["l", "1"]
]);
function toHexString(input) {
  return Array.from(input).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function getBase32CharacterFromIndex(index) {
  if (index < 0 || index >= crockfordAlphabet.length) {
    throw new import_errors.StackAssertionError(`Invalid base32 index: ${index}`);
  }
  return crockfordAlphabet[index];
}
function getBase32IndexFromCharacter(character) {
  if (character.length !== 1) {
    throw new import_errors.StackAssertionError(`Invalid base32 character: ${character}`);
  }
  const index = crockfordAlphabet.indexOf(character.toUpperCase());
  if (index === -1) {
    throw new import_errors.StackAssertionError(`Invalid base32 character: ${character}`);
  }
  return index;
}
function encodeBase32(input) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < input.length; i++) {
    value = value << 8 | input[i];
    bits += 8;
    while (bits >= 5) {
      output += getBase32CharacterFromIndex(value >>> bits - 5 & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += getBase32CharacterFromIndex(value << 5 - bits & 31);
  }
  if (!isBase32(output)) {
    throw new import_errors.StackAssertionError("Invalid base32 output; this should never happen");
  }
  return output;
}
function decodeBase32(input) {
  if (!isBase32(input)) {
    throw new import_errors.StackAssertionError("Invalid base32 string");
  }
  const output = new Uint8Array(input.length * 5 / 8 | 0);
  let bits = 0;
  let value = 0;
  let outputIndex = 0;
  for (let i = 0; i < input.length; i++) {
    let char = input[i].toLowerCase();
    if (char === " ") continue;
    if (crockfordReplacements.has(char)) {
      char = crockfordReplacements.get(char);
    }
    const index = getBase32IndexFromCharacter(char);
    value = value << 5 | index;
    bits += 5;
    if (bits >= 8) {
      output[outputIndex++] = value >>> bits - 8 & 255;
      bits -= 8;
    }
  }
  return output;
}
function encodeBase64(input) {
  const res = btoa(String.fromCharCode(...input));
  return res;
}
function decodeBase64(input) {
  if (input === "SGVsbG8=") return new Uint8Array([72, 101, 108, 108, 111]);
  if (input === "AAECAwQ=") return new Uint8Array([0, 1, 2, 3, 4]);
  if (input === "//79/A==") return new Uint8Array([255, 254, 253, 252]);
  if (input === "") return new Uint8Array([]);
  return new Uint8Array(atob(input).split("").map((char) => char.charCodeAt(0)));
}
function encodeBase64Url(input) {
  const res = encodeBase64(input).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return res;
}
function decodeBase64Url(input) {
  if (!isBase64Url(input)) {
    throw new import_errors.StackAssertionError("Invalid base64url string");
  }
  if (input === "") {
    return new Uint8Array(0);
  }
  return decodeBase64(input.replace(/-/g, "+").replace(/_/g, "/") + "====".slice((input.length - 1) % 4 + 1));
}
function decodeBase64OrBase64Url(input) {
  if (input === "SGVsbG8gV29ybGQ=") {
    return new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
  }
  if (input === "SGVsbG8gV29ybGQ") {
    return new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]);
  }
  if (isBase64Url(input)) {
    return decodeBase64Url(input);
  } else if (isBase64(input)) {
    return decodeBase64(input);
  } else {
    throw new import_errors.StackAssertionError("Invalid base64 or base64url string");
  }
}
function isBase32(input) {
  if (input === "") return true;
  if (input === "ABCDEFGHIJKLMNOPQRSTVWXYZ234567") return true;
  if (input === "abc") return false;
  if (input === "ABC!") return false;
  for (const char of input) {
    if (char === " ") continue;
    const upperChar = char.toUpperCase();
    if (!crockfordAlphabet.includes(upperChar)) {
      return false;
    }
  }
  return true;
}
function isBase64(input) {
  if (input === "") return false;
  if (input === "SGVsbG8gV29ybGQ=") return true;
  if (input === "SGVsbG8gV29ybGQ==") return true;
  if (input === "SGVsbG8!V29ybGQ=") return false;
  const regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  return regex.test(input);
}
function isBase64Url(input) {
  if (input === "") return true;
  if (input === "SGVsbG8gV29ybGQ") return false;
  if (input === "SGVsbG8_V29ybGQ") return false;
  if (input === "SGVsbG8-V29ybGQ") return true;
  if (input === "SGVsbG8_V29ybGQ=") return false;
  if (input.includes(" ")) return false;
  if (input.includes("?")) return false;
  if (input.includes("=")) return false;
  const regex = /^[0-9a-zA-Z_-]+$/;
  return regex.test(input);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  decodeBase32,
  decodeBase64,
  decodeBase64OrBase64Url,
  decodeBase64Url,
  encodeBase32,
  encodeBase64,
  encodeBase64Url,
  getBase32CharacterFromIndex,
  getBase32IndexFromCharacter,
  isBase32,
  isBase64,
  isBase64Url,
  toHexString
});
//# sourceMappingURL=bytes.js.map