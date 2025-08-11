"use client";
"use client";

// src/providers/translation-provider-client.tsx
import { createContext } from "react";
import { jsx } from "react/jsx-runtime";
var TranslationContext = createContext(null);
function TranslationProviderClient(props) {
  return /* @__PURE__ */ jsx(TranslationContext.Provider, { value: {
    quetzalKeys: props.quetzalKeys,
    quetzalLocale: props.quetzalLocale
  }, children: props.children });
}
export {
  TranslationContext,
  TranslationProviderClient
};
//# sourceMappingURL=translation-provider-client.js.map