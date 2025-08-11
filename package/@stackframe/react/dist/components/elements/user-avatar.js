"use strict";
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

// src/components/elements/user-avatar.tsx
var user_avatar_exports = {};
__export(user_avatar_exports, {
  UserAvatar: () => UserAvatar
});
module.exports = __toCommonJS(user_avatar_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import_jsx_runtime = require("react/jsx-runtime");
var defaultSize = 34;
function UserAvatar(props) {
  const user = props.user;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Avatar, { style: { height: props.size || defaultSize, width: props.size || defaultSize }, className: props.border ? "border" : "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.AvatarImage, { src: user?.profileImageUrl || "" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.AvatarFallback, { children: user ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "font-medium", style: { fontSize: (props.size || defaultSize) * 0.4 }, children: (user.displayName || user.primaryEmail)?.slice(0, 2).toUpperCase() }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.UserRound, { className: "text-zinc-500", size: (props.size || defaultSize) * 0.6 }) })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  UserAvatar
});
//# sourceMappingURL=user-avatar.js.map