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

// src/utils/oauth.tsx
var oauth_exports = {};
__export(oauth_exports, {
  allProviders: () => allProviders,
  sharedProviders: () => sharedProviders,
  standardProviders: () => standardProviders
});
module.exports = __toCommonJS(oauth_exports);
var standardProviders = ["google", "github", "microsoft", "spotify", "facebook", "discord", "gitlab", "bitbucket", "linkedin", "apple", "x"];
var sharedProviders = ["google", "github", "microsoft", "spotify"];
var allProviders = standardProviders;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  allProviders,
  sharedProviders,
  standardProviders
});
//# sourceMappingURL=oauth.js.map