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

// src/components/user-button.tsx
var user_button_exports = {};
__export(user_button_exports, {
  UserButton: () => UserButton
});
module.exports = __toCommonJS(user_button_exports);
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var import__ = require("..");
var import_translations = require("../lib/translations");
var import_user_avatar = require("./elements/user-avatar");
var import_jsx_runtime = require("react/jsx-runtime");
function Item(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DropdownMenuItem, { onClick: () => (0, import_promises.runAsynchronouslyWithAlert)(props.onClick), children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2 items-center", children: [
    props.icon,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: props.text })
  ] }) });
}
function UserButton(props) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_react.Suspense, { fallback: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Skeleton, { className: "h-[34px] w-[34px] rounded-full stack-scope" }), children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButtonInner, { ...props }) });
}
function UserButtonInner(props) {
  const user = (0, import__.useUser)();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButtonInnerInner, { ...props, user });
}
function UserButtonInnerInner(props) {
  const { t } = (0, import_translations.useTranslation)();
  const user = props.user;
  const app = (0, import__.useStackApp)();
  const iconProps = { size: 20, className: "h-4 w-4" };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.DropdownMenu, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DropdownMenuTrigger, { className: "outline-none stack-scope", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2 items-center", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_user_avatar.UserAvatar, { user }),
      user && props.showUserInfo && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col justify-center text-left", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-40 truncate", children: user.displayName }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-40 truncate", variant: "secondary", type: "label", children: user.primaryEmail })
      ] })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.DropdownMenuContent, { className: "stack-scope", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DropdownMenuLabel, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex gap-2 items-center", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_user_avatar.UserAvatar, { user }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-40 truncate", children: user.displayName }),
          user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { className: "max-w-40 truncate", variant: "secondary", type: "label", children: user.primaryEmail }),
          !user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: t("Not signed in") })
        ] })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.DropdownMenuSeparator, {}),
      user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Item,
        {
          text: t("Account settings"),
          onClick: async () => await app.redirectToAccountSettings(),
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.CircleUser, { ...iconProps })
        }
      ),
      !user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Item,
        {
          text: t("Sign in"),
          onClick: async () => await app.redirectToSignIn(),
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.LogIn, { ...iconProps })
        }
      ),
      !user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Item,
        {
          text: t("Sign up"),
          onClick: async () => await app.redirectToSignUp(),
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.UserPlus, { ...iconProps })
        }
      ),
      user && props.extraItems && props.extraItems.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Item, { ...item }, index)),
      props.colorModeToggle && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Item,
        {
          text: t("Toggle theme"),
          onClick: props.colorModeToggle,
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.SunMoon, { ...iconProps })
        }
      ),
      user && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        Item,
        {
          text: t("Sign out"),
          onClick: () => user.signOut(),
          icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.LogOut, { ...iconProps })
        }
      )
    ] })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  UserButton
});
//# sourceMappingURL=user-button.js.map