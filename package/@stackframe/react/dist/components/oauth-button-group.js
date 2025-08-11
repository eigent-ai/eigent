"use client";
"use strict";
"use client";
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

// src/components/oauth-button-group.tsx
var oauth_button_group_exports = {};
__export(oauth_button_group_exports, {
  OAuthButtonGroup: () => OAuthButtonGroup
});
module.exports = __toCommonJS(oauth_button_group_exports);
var import_hooks = require("../lib/hooks");
var import_oauth_button = require("./oauth-button");
var import_jsx_runtime = require("react/jsx-runtime");
function OAuthButtonGroup({
  type,
  mockProject
}) {
  const stackApp = (0, import_hooks.useStackApp)();
  const project = mockProject || stackApp.useProject();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "gap-4 flex flex-col items-stretch stack-scope", children: project.config.oauthProviders.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_oauth_button.OAuthButton,
    {
      provider: p.id,
      type,
      isMock: !!mockProject
    },
    p.id
  )) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  OAuthButtonGroup
});
//# sourceMappingURL=oauth-button-group.js.map