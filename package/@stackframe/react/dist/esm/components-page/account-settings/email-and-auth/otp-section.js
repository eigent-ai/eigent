// src/components-page/account-settings/email-and-auth/otp-section.tsx
import { Button, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { jsx, jsxs } from "react/jsx-runtime";
function OtpSection() {
  const { t } = useTranslation();
  const user = useUser({ or: "throw" });
  const project = useStackApp().useProject();
  const contactChannels = user.useContactChannels();
  const isLastAuth = user.otpAuthEnabled && !user.hasPassword && user.oauthProviders.length === 0 && !user.passkeyAuthEnabled;
  const [disabling, setDisabling] = useState(false);
  const hasValidEmail = contactChannels.filter((x) => x.type === "email" && x.isVerified && x.usedForAuth).length > 0;
  if (!project.config.magicLinkEnabled) {
    return null;
  }
  const handleDisableOTP = async () => {
    await user.update({ otpAuthEnabled: false });
    setDisabling(false);
  };
  return /* @__PURE__ */ jsx(Section, { title: t("OTP sign-in"), description: user.otpAuthEnabled ? t("OTP/magic link sign-in is currently enabled.") : t("Enable sign-in via magic link or OTP sent to your sign-in emails."), children: /* @__PURE__ */ jsx("div", { className: "flex md:justify-end", children: hasValidEmail ? user.otpAuthEnabled ? !isLastAuth ? !disabling ? /* @__PURE__ */ jsx(
    Button,
    {
      variant: "secondary",
      onClick: () => setDisabling(true),
      children: t("Disable OTP")
    }
  ) : /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2", children: [
    /* @__PURE__ */ jsx(Typography, { variant: "destructive", children: t("Are you sure you want to disable OTP sign-in? You will not be able to sign in with only emails anymore.") }),
    /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
      /* @__PURE__ */ jsx(
        Button,
        {
          variant: "destructive",
          onClick: handleDisableOTP,
          children: t("Disable")
        }
      ),
      /* @__PURE__ */ jsx(
        Button,
        {
          variant: "secondary",
          onClick: () => setDisabling(false),
          children: t("Cancel")
        }
      )
    ] })
  ] }) : /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: t("OTP sign-in is enabled and cannot be disabled as it is currently the only sign-in method") }) : /* @__PURE__ */ jsx(
    Button,
    {
      variant: "secondary",
      onClick: async () => {
        await user.update({ otpAuthEnabled: true });
      },
      children: t("Enable OTP")
    }
  ) : /* @__PURE__ */ jsx(Typography, { variant: "secondary", type: "label", children: t("To enable OTP sign-in, please add a verified sign-in email.") }) }) });
}
export {
  OtpSection
};
//# sourceMappingURL=otp-section.js.map