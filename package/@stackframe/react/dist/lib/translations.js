"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/translations.tsx
var translations_exports = {};
__export(translations_exports, {
  useTranslation: () => useTranslation
});
module.exports = __toCommonJS(translations_exports);
var import_react = __toESM(require("react"));
var import_translation_provider_client = require("../providers/translation-provider-client");
function useTranslation() {
  const translationContext = import_react.default.useContext(import_translation_provider_client.TranslationContext);
  if (!translationContext) {
    throw new Error("Translation context not found; did you forget to wrap your app in a <StackProvider />?");
  }
  return {
    t: (str, templateVars) => {
      const { quetzalKeys, quetzalLocale } = translationContext;
      let translation = quetzalLocale.get(quetzalKeys.get(str) ?? void 0) ?? str;
      for (const [key, value] of Object.entries(templateVars || {})) {
        translation = translation.replace(`{${key}}`, value);
      }
      return translation;
    }
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  useTranslation
});
//# sourceMappingURL=translations.js.map