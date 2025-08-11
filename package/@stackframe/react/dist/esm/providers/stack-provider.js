// src/providers/stack-provider.tsx
import { Suspense } from "react";
import { StackProviderClient, UserSetter } from "./stack-provider-client";
import { TranslationProvider } from "./translation-provider";
import { jsx, jsxs } from "react/jsx-runtime";
function UserFetcher(props) {
  const userPromise = props.app.getUser({ or: "anonymous-if-exists" }).then((user) => user?.toClientJson() ?? null);
  return /* @__PURE__ */ jsx(UserSetter, { userJsonPromise: userPromise });
}
function ReactStackProvider({
  children,
  app,
  lang,
  translationOverrides
}) {
  return /* @__PURE__ */ jsxs(StackProviderClient, { app, serialized: false, children: [
    /* @__PURE__ */ jsx(Suspense, { fallback: null, children: /* @__PURE__ */ jsx(UserFetcher, { app }) }),
    /* @__PURE__ */ jsx(TranslationProvider, { lang, translationOverrides, children })
  ] });
}
var stack_provider_default = ReactStackProvider;
export {
  stack_provider_default as default
};
//# sourceMappingURL=stack-provider.js.map