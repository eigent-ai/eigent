"use client";
"use client";

// src/components/elements/form-warning.tsx
import { jsx } from "react/jsx-runtime";
function FormWarningText({ text }) {
  if (!text) {
    return null;
  }
  return /* @__PURE__ */ jsx("div", { className: "text-red-500 text-sm mt-1", children: text });
}
export {
  FormWarningText
};
//# sourceMappingURL=form-warning.js.map