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

// src/components-page/sign-up.tsx
var sign_up_exports = {};
__export(sign_up_exports, {
  SignUp: () => SignUp
});
module.exports = __toCommonJS(sign_up_exports);
var import_auth_page = require("./auth-page");
var import_jsx_runtime = require("react/jsx-runtime");
function SignUp(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    import_auth_page.AuthPage,
    {
      fullPage: !!props.fullPage,
      type: "sign-up",
      automaticRedirect: !!props.automaticRedirect,
      noPasswordRepeat: props.noPasswordRepeat,
      extraInfo: props.extraInfo,
      firstTab: props.firstTab
    }
  );
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SignUp
});
//# sourceMappingURL=sign-up.js.map