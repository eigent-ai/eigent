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

// src/utils/unicode.tsx
var unicode_exports = {};
__export(unicode_exports, {
  getFlagEmoji: () => getFlagEmoji
});
module.exports = __toCommonJS(unicode_exports);
var import_errors = require("./errors");
function getFlagEmoji(twoLetterCountryCode) {
  if (!/^[a-zA-Z][a-zA-Z]$/.test(twoLetterCountryCode)) throw new import_errors.StackAssertionError("Country code must be two alphabetical letters");
  const codePoints = twoLetterCountryCode.toUpperCase().split("").map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getFlagEmoji
});
//# sourceMappingURL=unicode.js.map