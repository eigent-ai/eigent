// src/components/elements/user-avatar.tsx
import { Avatar, AvatarFallback, AvatarImage } from "@stackframe/stack-ui";
import { UserRound } from "lucide-react";
import { jsx, jsxs } from "react/jsx-runtime";
var defaultSize = 34;
function UserAvatar(props) {
  const user = props.user;
  return /* @__PURE__ */ jsxs(Avatar, { style: { height: props.size || defaultSize, width: props.size || defaultSize }, className: props.border ? "border" : "", children: [
    /* @__PURE__ */ jsx(AvatarImage, { src: user?.profileImageUrl || "" }),
    /* @__PURE__ */ jsx(AvatarFallback, { children: user ? /* @__PURE__ */ jsx("div", { className: "font-medium", style: { fontSize: (props.size || defaultSize) * 0.4 }, children: (user.displayName || user.primaryEmail)?.slice(0, 2).toUpperCase() }) : /* @__PURE__ */ jsx(UserRound, { className: "text-zinc-500", size: (props.size || defaultSize) * 0.6 }) })
  ] });
}
export {
  UserAvatar
};
//# sourceMappingURL=user-avatar.js.map