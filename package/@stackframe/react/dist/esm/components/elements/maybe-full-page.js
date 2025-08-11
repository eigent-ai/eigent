"use client";
"use client";

// src/components/elements/maybe-full-page.tsx
import { useId } from "react";
import { SsrScript } from "./ssr-layout-effect";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function MaybeFullPage({
  children,
  fullPage
}) {
  const uniqueId = useId();
  const id = `stack-full-page-container-${uniqueId}`;
  const scriptString = `(([id]) => {
    const el = document.getElementById(id);
    if (!el) {
      // component is not full page
      return;
    }
    const offset = el.getBoundingClientRect().top + document.documentElement.scrollTop;
    el.style.minHeight = \`calc(100vh - \${offset}px)\`;
  })(${JSON.stringify([id])})`;
  if (fullPage) {
    return /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx(
        "div",
        {
          suppressHydrationWarning: true,
          id,
          style: {
            minHeight: "100vh",
            alignSelf: "stretch",
            flexGrow: 1,
            display: "flex",
            justifyContent: "center",
            alignItems: "center"
          },
          className: "stack-scope",
          children
        }
      ),
      /* @__PURE__ */ jsx(SsrScript, { script: scriptString })
    ] });
  } else {
    return /* @__PURE__ */ jsx(Fragment, { children });
  }
}
export {
  MaybeFullPage
};
//# sourceMappingURL=maybe-full-page.js.map