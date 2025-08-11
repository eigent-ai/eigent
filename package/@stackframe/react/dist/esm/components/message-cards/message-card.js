"use client";
"use client";

// src/components/message-cards/message-card.tsx
import { MaybeFullPage } from "../elements/maybe-full-page";
import { Button, Typography } from "@stackframe/stack-ui";
import { jsx, jsxs } from "react/jsx-runtime";
function MessageCard({ fullPage = false, ...props }) {
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage, children: /* @__PURE__ */ jsxs("div", { className: "text-center stack-scope flex flex-col gap-4", style: { maxWidth: "380px", flexBasis: "380px", padding: fullPage ? "1rem" : 0 }, children: [
    /* @__PURE__ */ jsx(Typography, { type: "h3", children: props.title }),
    props.children,
    (props.primaryButtonText || props.secondaryButtonText) && /* @__PURE__ */ jsxs("div", { className: "flex justify-center gap-4 my-5", children: [
      props.secondaryButtonText && /* @__PURE__ */ jsx(Button, { variant: "secondary", onClick: props.secondaryAction, children: props.secondaryButtonText }),
      props.primaryButtonText && /* @__PURE__ */ jsx(Button, { onClick: props.primaryAction, children: props.primaryButtonText })
    ] })
  ] }) });
}
export {
  MessageCard
};
//# sourceMappingURL=message-card.js.map