// src/components-page/account-settings/email-and-auth/passkey-section.tsx
import { Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp } from "../../..";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function PasskeySection() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });
  const stackApp = useStackApp();
  const project = stackApp.useProject();
  const contactChannels = user.useContactChannels();
  const hasPasskey = user.passkeyAuthEnabled;
  const isLastAuth = user.passkeyAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.otpAuthEnabled;
  const [showConfirmationModal, setShowConfirmationModal] = useState(false);
  const hasValidEmail = contactChannels.filter((x) => x.type === "email" && x.isVerified && x.usedForAuth).length > 0;
  if (!project.config.passkeyEnabled) {
    return null;
  }
  const handleDeletePasskey = async () => {
    await user.update({ passkeyAuthEnabled: false });
    setShowConfirmationModal(false);
  };
  const handleAddNewPasskey = async () => {
    await user.registerPasskey();
  };
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsx(Section, { title: t("Passkey"), description: hasPasskey ? t("Passkey registered") : t("Register a passkey"), children: /* @__PURE__ */ jsxs("div", { className: "flex md:justify-end gap-2", children: [
    !hasValidEmail && /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: t("To enable Passkey sign-in, please add a verified sign-in email.") }),
    hasValidEmail && hasPasskey && isLastAuth && /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: t("Passkey sign-in is enabled and cannot be disabled as it is currently the only sign-in method") }),
    !hasPasskey && hasValidEmail && /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(Button, { onClick: handleAddNewPasskey, variant: "secondary", children: t("Add new passkey") }) }),
    hasValidEmail && hasPasskey && !isLastAuth && !showConfirmationModal && /* @__PURE__ */ jsx(
      Button,
      {
        variant: "secondary",
        onClick: () => setShowConfirmationModal(true),
        children: t("Delete Passkey")
      }
    ),
    hasValidEmail && hasPasskey && !isLastAuth && showConfirmationModal && /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
      /* @__PURE__ */ jsx(Typography, { variant: "destructive", children: t("Are you sure you want to disable Passkey sign-in? You will not be able to sign in with your passkey anymore.") }),
      /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
        /* @__PURE__ */ jsx(
          Button,
          {
            variant: "destructive",
            onClick: handleDeletePasskey,
            children: t("Disable")
          }
        ),
        /* @__PURE__ */ jsx(
          Button,
          {
            variant: "secondary",
            onClick: () => setShowConfirmationModal(false),
            children: t("Cancel")
          }
        )
      ] })
    ] })
  ] }) }) });
}
export {
  PasskeySection
};
//# sourceMappingURL=passkey-section.js.map