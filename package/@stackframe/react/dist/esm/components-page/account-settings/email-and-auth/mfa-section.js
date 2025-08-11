// src/components-page/account-settings/email-and-auth/mfa-section.tsx
import { createTOTPKeyURI, verifyTOTP } from "@oslojs/otp";
import { useAsyncCallback } from "@stackframe/stack-shared/dist/hooks/use-async-callback";
import { generateRandomValues } from "@stackframe/stack-shared/dist/utils/crypto";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Typography } from "@stackframe/stack-ui";
import * as QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function MfaSection() {
  const { t } = useTranslation();
  const project = useStackApp().useProject();
  const user = useUser({ or: "throw" });
  const [generatedSecret, setGeneratedSecret] = useState(null);
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [isMaybeWrong, setIsMaybeWrong] = useState(false);
  const isEnabled = user.isMultiFactorRequired;
  const [handleSubmit, isLoading] = useAsyncCallback(async () => {
    await user.update({
      totpMultiFactorSecret: generatedSecret
    });
    setGeneratedSecret(null);
    setQrCodeUrl(null);
    setMfaCode("");
  }, [generatedSecret, user]);
  useEffect(() => {
    setIsMaybeWrong(false);
    runAsynchronouslyWithAlert(async () => {
      if (generatedSecret && verifyTOTP(generatedSecret, 30, 6, mfaCode)) {
        await handleSubmit();
      }
      setIsMaybeWrong(true);
    });
  }, [mfaCode, generatedSecret, handleSubmit]);
  return /* @__PURE__ */ jsx(
    Section,
    {
      title: t("Multi-factor authentication"),
      description: isEnabled ? t("Multi-factor authentication is currently enabled.") : t("Multi-factor authentication is currently disabled."),
      children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-4", children: [
        !isEnabled && generatedSecret && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(Typography, { children: t("Scan this QR code with your authenticator app:") }),
          /* @__PURE__ */ jsx("img", { width: 200, height: 200, src: qrCodeUrl ?? throwErr("TOTP QR code failed to generate"), alt: t("TOTP multi-factor authentication QR code") }),
          /* @__PURE__ */ jsx(Typography, { children: t("Then, enter your six-digit MFA code:") }),
          /* @__PURE__ */ jsx(
            Input,
            {
              value: mfaCode,
              onChange: (e) => {
                setIsMaybeWrong(false);
                setMfaCode(e.target.value);
              },
              placeholder: "123456",
              maxLength: 6,
              disabled: isLoading
            }
          ),
          isMaybeWrong && mfaCode.length === 6 && /* @__PURE__ */ jsx(Typography, { variant: "destructive", children: t("Incorrect code. Please try again.") }),
          /* @__PURE__ */ jsx("div", { className: "flex", children: /* @__PURE__ */ jsx(
            Button,
            {
              variant: "secondary",
              onClick: () => {
                setGeneratedSecret(null);
                setQrCodeUrl(null);
                setMfaCode("");
              },
              children: t("Cancel")
            }
          ) })
        ] }),
        /* @__PURE__ */ jsx("div", { className: "flex gap-2", children: isEnabled ? /* @__PURE__ */ jsx(
          Button,
          {
            variant: "secondary",
            onClick: async () => {
              await user.update({
                totpMultiFactorSecret: null
              });
            },
            children: t("Disable MFA")
          }
        ) : !generatedSecret && /* @__PURE__ */ jsx(
          Button,
          {
            variant: "secondary",
            onClick: async () => {
              const secret = generateRandomValues(new Uint8Array(20));
              setQrCodeUrl(await generateTotpQrCode(project, user, secret));
              setGeneratedSecret(secret);
            },
            children: t("Enable MFA")
          }
        ) })
      ] })
    }
  );
}
async function generateTotpQrCode(project, user, secret) {
  const uri = createTOTPKeyURI(project.displayName, user.primaryEmail ?? user.id, secret, 30, 6);
  return await QRCode.toDataURL(uri);
}
export {
  MfaSection
};
//# sourceMappingURL=mfa-section.js.map