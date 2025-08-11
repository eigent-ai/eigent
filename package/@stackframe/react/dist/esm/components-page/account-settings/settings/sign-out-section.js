// src/components-page/account-settings/settings/sign-out-section.tsx
import { Button } from "@stackframe/stack-ui";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { jsx } from "react/jsx-runtime";
function SignOutSection() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Sign out"),
      description: t("End your current session"),
      children: /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(
        Button,
        {
          variant: "secondary",
          onClick: () => user.signOut(),
          children: t("Sign out")
        }
      ) })
    }
  );
}
export {
  SignOutSection
};
//# sourceMappingURL=sign-out-section.js.map