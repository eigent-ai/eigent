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

// src/components/message-cards/known-error-message-card.tsx
var known_error_message_card_exports = {};
__export(known_error_message_card_exports, {
  KnownErrorMessageCard: () => KnownErrorMessageCard
});
module.exports = __toCommonJS(known_error_message_card_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import__ = require("../..");
var import_message_card = require("./message-card");
var import_jsx_runtime = require("react/jsx-runtime");
function KnownErrorMessageCard({
  error,
  fullPage = false
}) {
  const stackApp = (0, import__.useStackApp)();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    import_message_card.MessageCard,
    {
      title: "An error occurred",
      fullPage,
      primaryButtonText: "Go Home",
      primaryAction: () => stackApp.redirectToHome(),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
          "Error Code: ",
          error.errorCode
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { children: [
          "Error Message: ",
          error.message
        ] })
      ]
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  KnownErrorMessageCard
});
//# sourceMappingURL=known-error-message-card.js.map