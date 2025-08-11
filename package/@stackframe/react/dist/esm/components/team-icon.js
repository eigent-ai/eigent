// src/components/team-icon.tsx
import { Avatar, AvatarImage, Typography } from "@stackframe/stack-ui";
import { jsx } from "react/jsx-runtime";
function TeamIcon(props) {
  if (props.team.profileImageUrl) {
    return /* @__PURE__ */ jsx(Avatar, { className: "min-w-6 min-h-6 max-w-6 max-h-6 rounded", children: /* @__PURE__ */ jsx(AvatarImage, { src: props.team.profileImageUrl, alt: props.team.displayName }) });
  } else {
    return /* @__PURE__ */ jsx("div", { className: "flex items-center justify-center min-w-6 min-h-6 max-w-6 max-h-6 rounded bg-zinc-200", children: /* @__PURE__ */ jsx(Typography, { className: "text-zinc-800 dark:text-zinc-800", children: props.team.displayName.slice(0, 1).toUpperCase() }) });
  }
}
export {
  TeamIcon
};
//# sourceMappingURL=team-icon.js.map