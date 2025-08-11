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

// src/providers/stack-provider.tsx
var stack_provider_exports = {};
__export(stack_provider_exports, {
  default: () => stack_provider_default
});
module.exports = __toCommonJS(stack_provider_exports);
var import_react = require("react");
var import_stack_provider_client = require("./stack-provider-client");
var import_translation_provider = require("./translation-provider");
var import_jsx_runtime = require("react/jsx-runtime");
function UserFetcher(props) {
  const userPromise = props.app.getUser({ or: "anonymous-if-exists" }).then((user) => user?.toClientJson() ?? null);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_provider_client.UserSetter, { userJsonPromise: userPromise });
}
function ReactStackProvider({
  children,
  app,
  lang,
  translationOverrides
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_provider_client.StackProviderClient, { app, serialized: false, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: null, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserFetcher, { app }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_translation_provider.TranslationProvider, { lang, translationOverrides, children })
  ] });
}
var stack_provider_default = ReactStackProvider;
//# sourceMappingURL=stack-provider.js.map