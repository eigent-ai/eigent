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

// src/utils/urls.tsx
var urls_exports = {};
__export(urls_exports, {
  createUrlIfValid: () => createUrlIfValid,
  getRelativePart: () => getRelativePart,
  isLocalhost: () => isLocalhost,
  isRelative: () => isRelative,
  isValidHostname: () => isValidHostname,
  isValidUrl: () => isValidUrl,
  url: () => url,
  urlString: () => urlString
});
module.exports = __toCommonJS(urls_exports);
var import_crypto = require("./crypto");
var import_strings = require("./strings");
function createUrlIfValid(...args) {
  try {
    return new URL(...args);
  } catch (e) {
    return null;
  }
}
function isValidUrl(url2) {
  return !!createUrlIfValid(url2);
}
function isValidHostname(hostname) {
  const url2 = createUrlIfValid(`https://${hostname}`);
  if (!url2) return false;
  return url2.hostname === hostname;
}
function isLocalhost(urlOrString) {
  const url2 = createUrlIfValid(urlOrString);
  if (!url2) return false;
  if (url2.hostname === "localhost" || url2.hostname.endsWith(".localhost")) return true;
  if (url2.hostname.match(/^127\.\d+\.\d+\.\d+$/)) return true;
  return false;
}
function isRelative(url2) {
  const randomDomain = `${(0, import_crypto.generateSecureRandomString)()}.stack-auth.example.com`;
  const u = createUrlIfValid(url2, `https://${randomDomain}`);
  if (!u) return false;
  if (u.host !== randomDomain) return false;
  if (u.protocol !== "https:") return false;
  return true;
}
function getRelativePart(url2) {
  return url2.pathname + url2.search + url2.hash;
}
function url(strings, ...values) {
  return new URL(urlString(strings, ...values));
}
function urlString(strings, ...values) {
  return (0, import_strings.templateIdentity)(strings, ...values.map(encodeURIComponent));
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createUrlIfValid,
  getRelativePart,
  isLocalhost,
  isRelative,
  isValidHostname,
  isValidUrl,
  url,
  urlString
});
//# sourceMappingURL=urls.js.map