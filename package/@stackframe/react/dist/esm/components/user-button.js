"use client";
"use client";

// src/components/user-button.tsx
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Skeleton, Typography } from "@stackframe/stack-ui";
import { CircleUser, LogIn, LogOut, SunMoon, UserPlus } from "lucide-react";
import { Suspense } from "react";
import { useStackApp, useUser } from "..";
import { useTranslation } from "../lib/translations";
import { UserAvatar } from "./elements/user-avatar";
import { jsx, jsxs } from "react/jsx-runtime";
function Item(props) {
  return /* @__PURE__ */ jsx(DropdownMenuItem, { onClick: () => runAsynchronouslyWithAlert(props.onClick), children: /* @__PURE__ */ jsxs("div", { className: "flex gap-2 items-center", children: [
    props.icon,
    /* @__PURE__ */ jsx(Typography, { children: props.text })
  ] }) });
}
function UserButton(props) {
  return /* @__PURE__ */ jsx(Suspense, { fallback: /* @__PURE__ */ jsx(Skeleton, { className: "h-[34px] w-[34px] rounded-full stack-scope" }), children: /* @__PURE__ */ jsx(UserButtonInner, { ...props }) });
}
function UserButtonInner(props) {
  const user = useUser();
  return /* @__PURE__ */ jsx(UserButtonInnerInner, { ...props, user });
}
function UserButtonInnerInner(props) {
  const { t } = useTranslation();
  const user = props.user;
  const app = useStackApp();
  const iconProps = { size: 20, className: "h-4 w-4" };
  return /* @__PURE__ */ jsxs(DropdownMenu, { children: [
    /* @__PURE__ */ jsx(DropdownMenuTrigger, { className: "outline-none stack-scope", children: /* @__PURE__ */ jsxs("div", { className: "flex gap-2 items-center", children: [
      /* @__PURE__ */ jsx(UserAvatar, { user }),
      user && props.showUserInfo && /* @__PURE__ */ jsxs("div", { className: "flex flex-col justify-center text-left", children: [
        /* @__PURE__ */ jsx(Typography, { className: "max-w-40 truncate", children: user.displayName }),
        /* @__PURE__ */ jsx(Typography, { className: "max-w-40 truncate", variant: "secondary", type: "label", children: user.primaryEmail })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs(DropdownMenuContent, { className: "stack-scope", children: [
      /* @__PURE__ */ jsx(DropdownMenuLabel, { children: /* @__PURE__ */ jsxs("div", { className: "flex gap-2 items-center", children: [
        /* @__PURE__ */ jsx(UserAvatar, { user }),
        /* @__PURE__ */ jsxs("div", { children: [
          user && /* @__PURE__ */ jsx(Typography, { className: "max-w-40 truncate", children: user.displayName }),
          user && /* @__PURE__ */ jsx(Typography, { className: "max-w-40 truncate", variant: "secondary", type: "label", children: user.primaryEmail }),
          !user && /* @__PURE__ */ jsx(Typography, { children: t("Not signed in") })
        ] })
      ] }) }),
      /* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
      user && /* @__PURE__ */ jsx(
        Item,
        {
          text: t("Account settings"),
          onClick: async () => await app.redirectToAccountSettings(),
          icon: /* @__PURE__ */ jsx(CircleUser, { ...iconProps })
        }
      ),
      !user && /* @__PURE__ */ jsx(
        Item,
        {
          text: t("Sign in"),
          onClick: async () => await app.redirectToSignIn(),
          icon: /* @__PURE__ */ jsx(LogIn, { ...iconProps })
        }
      ),
      !user && /* @__PURE__ */ jsx(
        Item,
        {
          text: t("Sign up"),
          onClick: async () => await app.redirectToSignUp(),
          icon: /* @__PURE__ */ jsx(UserPlus, { ...iconProps })
        }
      ),
      user && props.extraItems && props.extraItems.map((item, index) => /* @__PURE__ */ jsx(Item, { ...item }, index)),
      props.colorModeToggle && /* @__PURE__ */ jsx(
        Item,
        {
          text: t("Toggle theme"),
          onClick: props.colorModeToggle,
          icon: /* @__PURE__ */ jsx(SunMoon, { ...iconProps })
        }
      ),
      user && /* @__PURE__ */ jsx(
        Item,
        {
          text: t("Sign out"),
          onClick: () => user.signOut(),
          icon: /* @__PURE__ */ jsx(LogOut, { ...iconProps })
        }
      )
    ] })
  ] });
}
export {
  UserButton
};
//# sourceMappingURL=user-button.js.map