"use client";
"use client";

// src/components/iframe-preventer.tsx
import { useEffect, useState } from "react";
import { jsxs } from "react/jsx-runtime";
function IframePreventer({ children }) {
  const [isIframe, setIsIframe] = useState(false);
  useEffect(() => {
    if (window.self !== window.top) {
      setIsIframe(true);
    }
  }, []);
  if (isIframe) {
    return /* @__PURE__ */ jsxs("div", { children: [
      "Stack Auth components may not run in an ",
      "<",
      "iframe",
      ">",
      "."
    ] });
  }
  return children;
}
export {
  IframePreventer
};
//# sourceMappingURL=iframe-preventer.js.map