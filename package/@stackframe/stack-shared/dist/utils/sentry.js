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

// src/utils/sentry.tsx
var sentry_exports = {};
__export(sentry_exports, {
  sentryBaseConfig: () => sentryBaseConfig
});
module.exports = __toCommonJS(sentry_exports);
var sentryBaseConfig = {
  ignoreErrors: [
    // React throws these errors when used with some browser extensions (eg. Google Translate)
    "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
    "NotFoundError: Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node."
  ],
  normalizeDepth: 5,
  maxValueLength: 5e3,
  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 1,
  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
  replaysOnErrorSampleRate: 1,
  replaysSessionSampleRate: 1
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  sentryBaseConfig
});
//# sourceMappingURL=sentry.js.map