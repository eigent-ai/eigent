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

// src/helpers/password.ts
var password_exports = {};
__export(password_exports, {
  getPasswordError: () => getPasswordError
});
module.exports = __toCommonJS(password_exports);
var import__ = require("..");
var minLength = 8;
var maxLength = 70;
function getPasswordError(password) {
  if (password.length < minLength) {
    return new import__.KnownErrors.PasswordTooShort(minLength);
  }
  if (password.length > maxLength) {
    return new import__.KnownErrors.PasswordTooLong(maxLength);
  }
  return void 0;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getPasswordError
});
//# sourceMappingURL=password.js.map