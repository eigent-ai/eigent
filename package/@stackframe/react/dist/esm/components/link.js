"use client";
"use client";

// src/components/link.tsx
import { cn } from "@stackframe/stack-ui";
import { jsx } from "react/jsx-runtime";
function Link(props) {
  return /* @__PURE__ */ jsx(
    "a",
    {
      href: props.href,
      target: props.target,
      className: props.className,
      onClick: props.onClick,
      children: props.children
    }
  );
}
function StyledLink(props) {
  return /* @__PURE__ */ jsx(Link, { ...props, className: cn("underline font-medium", props.className), children: props.children });
}
export {
  Link,
  StyledLink
};
//# sourceMappingURL=link.js.map