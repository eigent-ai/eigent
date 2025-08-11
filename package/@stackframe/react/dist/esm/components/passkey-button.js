"use client";
"use client";

// src/components/passkey-button.tsx
import { Button } from "@stackframe/stack-ui";
import { useId } from "react";
import { useStackApp } from "..";
import { useTranslation } from "../lib/translations";
import { KeyRound } from "lucide-react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function PasskeyButton({
  type
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const styleId = useId().replaceAll(":", "-");
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(
    Button,
    {
      onClick: async () => {
        await stackApp.signInWithPasskey();
      },
      className: `stack-oauth-button-${styleId} stack-scope`,
      children: /* @__PURE__ */ jsxs("div", { className: "flex items-center w-full gap-4", children: [
        /* @__PURE__ */ jsx(KeyRound, {}),
        /* @__PURE__ */ jsx("span", { className: "flex-1", children: type === "sign-up" ? t("Sign up with Passkey") : t("Sign in with Passkey") })
      ] })
    }
  ) });
}
export {
  PasskeyButton
};
//# sourceMappingURL=passkey-button.js.map