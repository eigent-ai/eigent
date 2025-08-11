// src/lib/translations.tsx
import React from "react";
import { TranslationContext } from "../providers/translation-provider-client";
function useTranslation() {
  const translationContext = React.useContext(TranslationContext);
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
export {
  useTranslation
};
//# sourceMappingURL=translations.js.map