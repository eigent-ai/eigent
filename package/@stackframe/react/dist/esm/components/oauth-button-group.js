"use client";
"use client";

// src/components/oauth-button-group.tsx
import { useStackApp } from "../lib/hooks";
import { OAuthButton } from "./oauth-button";
import { jsx } from "react/jsx-runtime";
function OAuthButtonGroup({
  type,
  mockProject
}) {
  const stackApp = useStackApp();
  const project = mockProject || stackApp.useProject();
  return /* @__PURE__ */ jsx("div", { className: "gap-4 flex flex-col items-stretch stack-scope", children: project.config.oauthProviders.map((p) => /* @__PURE__ */ jsx(
    OAuthButton,
    {
      provider: p.id,
      type,
      isMock: !!mockProject
    },
    p.id
  )) });
}
export {
  OAuthButtonGroup
};
//# sourceMappingURL=oauth-button-group.js.map