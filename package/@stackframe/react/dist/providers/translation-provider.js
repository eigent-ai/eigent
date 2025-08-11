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

// src/providers/translation-provider.tsx
var translation_provider_exports = {};
__export(translation_provider_exports, {
  TranslationProvider: () => TranslationProvider
});
module.exports = __toCommonJS(translation_provider_exports);
var import_errors = require("@stackframe/stack-shared/dist/utils/errors");
var import_quetzal_translations = require("../generated/quetzal-translations");
var import_translation_provider_client = require("./translation-provider-client");
var import_jsx_runtime = require("react/jsx-runtime");
function TranslationProvider({ lang, translationOverrides, children }) {
  const locale = import_quetzal_translations.quetzalLocales.get(lang ?? void 0);
  const localeWithOverrides = new Map(locale);
  for (const [orig, override] of Object.entries(translationOverrides ?? {})) {
    const key = import_quetzal_translations.quetzalKeys.get(orig) ?? (0, import_errors.throwErr)(new Error(`Invalid translation override: Original key ${JSON.stringify(orig)} not found. Make sure you are passing the correct values into the translationOverrides property of the component.`));
    localeWithOverrides.set(key, override);
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_translation_provider_client.TranslationProviderClient, { quetzalKeys: import_quetzal_translations.quetzalKeys, quetzalLocale: localeWithOverrides, children });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TranslationProvider
});
//# sourceMappingURL=translation-provider.js.map