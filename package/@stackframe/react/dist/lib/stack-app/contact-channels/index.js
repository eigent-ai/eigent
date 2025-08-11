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

// src/lib/stack-app/contact-channels/index.ts
var contact_channels_exports = {};
__export(contact_channels_exports, {
  contactChannelCreateOptionsToCrud: () => contactChannelCreateOptionsToCrud,
  contactChannelUpdateOptionsToCrud: () => contactChannelUpdateOptionsToCrud,
  serverContactChannelCreateOptionsToCrud: () => serverContactChannelCreateOptionsToCrud,
  serverContactChannelUpdateOptionsToCrud: () => serverContactChannelUpdateOptionsToCrud
});
module.exports = __toCommonJS(contact_channels_exports);
function contactChannelCreateOptionsToCrud(userId, options) {
  return {
    value: options.value,
    type: options.type,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary,
    user_id: userId
  };
}
function contactChannelUpdateOptionsToCrud(options) {
  return {
    value: options.value,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary
  };
}
function serverContactChannelUpdateOptionsToCrud(options) {
  return {
    value: options.value,
    is_verified: options.isVerified,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary
  };
}
function serverContactChannelCreateOptionsToCrud(userId, options) {
  return {
    type: options.type,
    value: options.value,
    is_verified: options.isVerified,
    user_id: userId,
    used_for_auth: options.usedForAuth,
    is_primary: options.isPrimary
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  contactChannelCreateOptionsToCrud,
  contactChannelUpdateOptionsToCrud,
  serverContactChannelCreateOptionsToCrud,
  serverContactChannelUpdateOptionsToCrud
});
//# sourceMappingURL=index.js.map