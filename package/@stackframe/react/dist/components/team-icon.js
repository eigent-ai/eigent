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

// src/components/team-icon.tsx
var team_icon_exports = {};
__export(team_icon_exports, {
  TeamIcon: () => TeamIcon
});
module.exports = __toCommonJS(team_icon_exports);
var import_stack_ui = require("@stackframe/stack-ui");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamIcon(props) {
  if (props.team.profileImageUrl) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Avatar, { className: "min-w-6 min-h-6 max-w-6 max-h-6 rounded", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.AvatarImage, { src: props.team.profileImageUrl, alt: props.team.displayName }) });
  } else {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "flex items-center justify-center min-w-6 min-h-6 max-w-6 max-h-6 rounded bg-zinc-200", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "text-zinc-800 dark:text-zinc-800", children: props.team.displayName.slice(0, 1).toUpperCase() }) });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamIcon
});
//# sourceMappingURL=team-icon.js.map