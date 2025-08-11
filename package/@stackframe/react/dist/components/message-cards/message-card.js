"use client";
"use strict";
"use client";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components/message-cards/message-card.tsx
var message_card_exports = {};
__export(message_card_exports, {
  MessageCard: () => MessageCard
});
module.exports = __toCommonJS(message_card_exports);
var import_maybe_full_page = require("../elements/maybe-full-page");
var import_stack_ui = require("@stackframe/stack-ui");
var import_jsx_runtime = require("react/jsx-runtime");
function MessageCard({ fullPage = false, ...props }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_maybe_full_page.MaybeFullPage, { fullPage, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "text-center stack-scope flex flex-col gap-4", style: { maxWidth: "380px", flexBasis: "380px", padding: fullPage ? "1rem" : 0 }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { type: "h3", children: props.title }),
    props.children,
    (props.primaryButtonText || props.secondaryButtonText) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex justify-center gap-4 my-5", children: [
      props.secondaryButtonText && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { variant: "secondary", onClick: props.secondaryAction, children: props.secondaryButtonText }),
      props.primaryButtonText && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { onClick: props.primaryAction, children: props.primaryButtonText })
    ] })
  ] }) });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MessageCard
});
//# sourceMappingURL=message-card.js.map