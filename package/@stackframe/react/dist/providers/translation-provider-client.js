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

// src/providers/translation-provider-client.tsx
var translation_provider_client_exports = {};
__export(translation_provider_client_exports, {
  TranslationContext: () => TranslationContext,
  TranslationProviderClient: () => TranslationProviderClient
});
module.exports = __toCommonJS(translation_provider_client_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var TranslationContext = (0, import_react.createContext)(null);
function TranslationProviderClient(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TranslationContext.Provider, { value: {
    quetzalKeys: props.quetzalKeys,
    quetzalLocale: props.quetzalLocale
  }, children: props.children });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TranslationContext,
  TranslationProviderClient
});
//# sourceMappingURL=translation-provider-client.js.map