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

// src/utils/url.ts
var url_exports = {};
__export(url_exports, {
  constructRedirectUrl: () => constructRedirectUrl
});
module.exports = __toCommonJS(url_exports);
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
function constructRedirectUrl(redirectUrl, callbackUrlName) {
  if (typeof window === "undefined" || !window.location) {
    throw new import_errors.StackAssertionError(`${callbackUrlName} option is required in a non-browser environment.`, { redirectUrl });
  }
  const retainedQueryParams = ["after_auth_return_to"];
  const currentUrl = new URL(window.location.href);
  const url = redirectUrl ? new URL(redirectUrl, window.location.href) : new URL(window.location.href);
  for (const param of retainedQueryParams) {
    if (currentUrl.searchParams.has(param)) {
      url.searchParams.set(param, currentUrl.searchParams.get(param));
    }
  }
  url.hash = "";
  return url.toString();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  constructRedirectUrl
});
//# sourceMappingURL=url.js.map