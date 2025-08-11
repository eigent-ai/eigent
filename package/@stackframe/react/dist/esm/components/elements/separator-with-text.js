"use client";
"use client";

// src/components/elements/separator-with-text.tsx
import { Separator } from "@stackframe/stack-ui";
import { jsx, jsxs } from "react/jsx-runtime";
function SeparatorWithText({ text }) {
  return /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-center my-6 stack-scope", children: [
    /* @__PURE__ */ jsx("div", { className: "flex-1", children: /* @__PURE__ */ jsx(Separator, {}) }),
    /* @__PURE__ */ jsx("div", { className: "mx-2 text-sm text-zinc-500", children: text }),
    /* @__PURE__ */ jsx("div", { className: "flex-1", children: /* @__PURE__ */ jsx(Separator, {}) })
  ] });
}
export {
  SeparatorWithText
};
//# sourceMappingURL=separator-with-text.js.map