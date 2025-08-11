"use client";
"use strict";
"use client";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components-page/sign-out.tsx
var sign_out_exports = {};
__export(sign_out_exports, {
  SignOut: () => SignOut
});
module.exports = __toCommonJS(sign_out_exports);
var import_caches = require("@stackframe/stack-shared/dist/utils/caches");
var import_react = __toESM(require("react"));
var import__ = require("..");
var import_predefined_message_card = require("../components/message-cards/predefined-message-card");
var import_jsx_runtime = require("react/jsx-runtime");
var cacheSignOut = (0, import_caches.cacheFunction)(async (user) => {
  return await user.signOut();
});
function SignOut(props) {
  const user = (0, import__.useUser)();
  if (user) {
    import_react.default.use(cacheSignOut(user));
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_predefined_message_card.PredefinedMessageCard, { type: "signedOut", fullPage: props.fullPage });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SignOut
});
//# sourceMappingURL=sign-out.js.map