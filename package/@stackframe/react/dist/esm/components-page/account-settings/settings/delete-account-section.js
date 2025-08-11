// src/components-page/account-settings/settings/delete-account-section.tsx
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { jsx, jsxs } from "react/jsx-runtime";
function DeleteAccountSection() {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const app = useStackApp();
  const project = app.useProject();
  const [deleting, setDeleting] = useState(false);
  if (!project.config.clientUserDeletionEnabled) {
    return null;
  }
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Delete Account"),
      description: t("Permanently remove your account and all associated data"),
      children: /* @__PURE__ */ jsx("div", { className: "stack-scope flex flex-col items-stretch", children: /* @__PURE__ */ jsx(Accordion, { type: "single", collapsible: true, className: "w-full", children: /* @__PURE__ */ jsxs(AccordionItem, { value: "item-1", children: [
        /* @__PURE__ */ jsx(AccordionTrigger, { children: t("Danger zone") }),
        /* @__PURE__ */ jsx(AccordionContent, { children: !deleting ? /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(
          Button,
          {
            variant: "destructive",
            onClick: () => setDeleting(true),
            children: t("Delete account")
          }
        ) }) : /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
          /* @__PURE__ */ jsx(Typography, { variant: "destructive", children: t("Are you sure you want to delete your account? This action is IRREVERSIBLE and will delete ALL associated data.") }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "destructive",
                onClick: async () => {
                  await user.delete();
                  await app.redirectToHome();
                },
                children: t("Delete Account")
              }
            ),
            /* @__PURE__ */ jsx(
              Button,
              {
                variant: "secondary",
                onClick: () => setDeleting(false),
                children: t("Cancel")
              }
            )
          ] })
        ] }) })
      ] }) }) })
    }
  );
}
export {
  DeleteAccountSection
};
//# sourceMappingURL=delete-account-section.js.map