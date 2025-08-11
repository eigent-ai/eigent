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

// src/helpers/production-mode.ts
var production_mode_exports = {};
__export(production_mode_exports, {
  getProductionModeErrors: () => getProductionModeErrors
});
module.exports = __toCommonJS(production_mode_exports);
var import_errors = require("../utils/errors");
var import_urls = require("../utils/urls");
function getProductionModeErrors(project) {
  const errors = [];
  const domainsFixUrl = `/projects/${project.id}/domains`;
  if (project.config.allow_localhost) {
    errors.push({
      message: "Localhost is not allowed in production mode, turn off 'Allow localhost' in project settings",
      relativeFixUrl: domainsFixUrl
    });
  }
  for (const { domain } of project.config.domains) {
    let url;
    try {
      url = new URL(domain);
    } catch (e) {
      (0, import_errors.captureError)("production-mode-domain-not-valid", new import_errors.StackAssertionError("Domain was somehow not a valid URL; we should've caught this when setting the domain in the first place", {
        domain,
        projectId: project
      }));
      errors.push({
        message: "Trusted domain is not a valid URL: " + domain,
        relativeFixUrl: domainsFixUrl
      });
      continue;
    }
    if ((0, import_urls.isLocalhost)(url)) {
      errors.push({
        message: "Localhost domains are not allowed to be trusted in production mode: " + domain,
        relativeFixUrl: domainsFixUrl
      });
    } else if (url.hostname.match(/^\d+(\.\d+)*$/)) {
      errors.push({
        message: "Direct IPs are not valid for trusted domains in production mode: " + domain,
        relativeFixUrl: domainsFixUrl
      });
    } else if (url.protocol !== "https:") {
      errors.push({
        message: "Trusted domains should be HTTPS: " + domain,
        relativeFixUrl: domainsFixUrl
      });
    }
  }
  return errors;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getProductionModeErrors
});
//# sourceMappingURL=production-mode.js.map