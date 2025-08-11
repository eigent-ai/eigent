// src/providers/translation-provider.tsx
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { quetzalKeys, quetzalLocales } from "../generated/quetzal-translations";
import { TranslationProviderClient } from "./translation-provider-client";
import { jsx } from "react/jsx-runtime";
function TranslationProvider({ lang, translationOverrides, children }) {
  const locale = quetzalLocales.get(lang ?? void 0);
  const localeWithOverrides = new Map(locale);
  for (const [orig, override] of Object.entries(translationOverrides ?? {})) {
    const key = quetzalKeys.get(orig) ?? throwErr(new Error(`Invalid translation override: Original key ${JSON.stringify(orig)} not found. Make sure you are passing the correct values into the translationOverrides property of the component.`));
    localeWithOverrides.set(key, override);
  }
  return /* @__PURE__ */ jsx(TranslationProviderClient, { quetzalKeys, quetzalLocale: localeWithOverrides, children });
}
export {
  TranslationProvider
};
//# sourceMappingURL=translation-provider.js.map