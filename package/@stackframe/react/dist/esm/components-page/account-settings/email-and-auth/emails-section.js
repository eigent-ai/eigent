// src/components-page/account-settings/email-and-auth/emails-section.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { ActionCell, Badge, Button, Input, Table, TableBody, TableCell, TableRow, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FormWarningText } from "../../../components/elements/form-warning";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function EmailsSection() {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const contactChannels = user.useContactChannels();
  const [addingEmail, setAddingEmail] = useState(contactChannels.length === 0);
  const [addingEmailLoading, setAddingEmailLoading] = useState(false);
  const [addedEmail, setAddedEmail] = useState(null);
  const isLastEmail = contactChannels.filter((x) => x.usedForAuth && x.type === "email").length === 1;
  useEffect(() => {
    if (addedEmail) {
      runAsynchronously(async () => {
        const cc = contactChannels.find((x) => x.value === addedEmail);
        if (cc && !cc.isVerified) {
          await cc.sendVerificationEmail();
        }
        setAddedEmail(null);
      });
    }
  }, [contactChannels, addedEmail]);
  const emailSchema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email address")).notOneOf(contactChannels.map((x) => x.value), t("Email already exists")).defined().nonEmpty(t("Email is required"))
  });
  const { register, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: yupResolver(emailSchema)
  });
  const onSubmit = async (data) => {
    setAddingEmailLoading(true);
    try {
      await user.createContactChannel({ type: "email", value: data.email, usedForAuth: false });
      setAddedEmail(data.email);
    } finally {
      setAddingEmailLoading(false);
    }
    setAddingEmail(false);
    reset();
  };
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsxs("div", { className: "flex flex-col md:flex-row justify-between mb-4 gap-4", children: [
      /* @__PURE__ */ jsx(Typography, { className: "font-medium", children: t("Emails") }),
      addingEmail ? /* @__PURE__ */ jsxs(
        "form",
        {
          onSubmit: (e) => {
            e.preventDefault();
            runAsynchronously(handleSubmit(onSubmit));
          },
          className: "flex flex-col",
          children: [
            /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
              /* @__PURE__ */ jsx(
                Input,
                {
                  ...register("email"),
                  placeholder: t("Enter email")
                }
              ),
              /* @__PURE__ */ jsx(Button, { type: "submit", loading: addingEmailLoading, children: t("Add") }),
              /* @__PURE__ */ jsx(
                Button,
                {
                  variant: "secondary",
                  onClick: () => {
                    setAddingEmail(false);
                    reset();
                  },
                  children: t("Cancel")
                }
              )
            ] }),
            errors.email && /* @__PURE__ */ jsx(FormWarningText, { text: errors.email.message })
          ]
        }
      ) : /* @__PURE__ */ jsx("div", { className: "flex md:justify-end", children: /* @__PURE__ */ jsx(Button, { variant: "secondary", onClick: () => setAddingEmail(true), children: t("Add an email") }) })
    ] }),
    contactChannels.length > 0 ? /* @__PURE__ */ jsx("div", { className: "border rounded-md", children: /* @__PURE__ */ jsx(Table, { children: /* @__PURE__ */ jsx(TableBody, { children: contactChannels.filter((x) => x.type === "email").sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
      return 0;
    }).map((x) => /* @__PURE__ */ jsxs(TableRow, { children: [
      /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsxs("div", { className: "flex flex-col md:flex-row gap-2 md:gap-4", children: [
        x.value,
        /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
          x.isPrimary ? /* @__PURE__ */ jsx(Badge, { children: t("Primary") }) : null,
          !x.isVerified ? /* @__PURE__ */ jsx(Badge, { variant: "destructive", children: t("Unverified") }) : null,
          x.usedForAuth ? /* @__PURE__ */ jsx(Badge, { variant: "outline", children: t("Used for sign-in") }) : null
        ] })
      ] }) }),
      /* @__PURE__ */ jsx(TableCell, { className: "flex justify-end", children: /* @__PURE__ */ jsx(ActionCell, { items: [
        ...!x.isVerified ? [{
          item: t("Send verification email"),
          onClick: async () => {
            await x.sendVerificationEmail();
          }
        }] : [],
        ...!x.isPrimary && x.isVerified ? [{
          item: t("Set as primary"),
          onClick: async () => {
            await x.update({ isPrimary: true });
          }
        }] : !x.isPrimary ? [{
          item: t("Set as primary"),
          onClick: async () => {
          },
          disabled: true,
          disabledTooltip: t("Please verify your email first")
        }] : [],
        ...!x.usedForAuth && x.isVerified ? [{
          item: t("Use for sign-in"),
          onClick: async () => {
            try {
              await x.update({ usedForAuth: true });
            } catch (e) {
              if (KnownErrors.ContactChannelAlreadyUsedForAuthBySomeoneElse.isInstance(e)) {
                alert(t("This email is already used for sign-in by another user."));
              }
            }
          }
        }] : [],
        ...x.usedForAuth && !isLastEmail ? [{
          item: t("Stop using for sign-in"),
          onClick: async () => {
            await x.update({ usedForAuth: false });
          }
        }] : x.usedForAuth ? [{
          item: t("Stop using for sign-in"),
          onClick: async () => {
          },
          disabled: true,
          disabledTooltip: t("You can not remove your last sign-in email")
        }] : [],
        ...!isLastEmail || !x.usedForAuth ? [{
          item: t("Remove"),
          onClick: async () => {
            await x.delete();
          },
          danger: true
        }] : [{
          item: t("Remove"),
          onClick: async () => {
          },
          disabled: true,
          disabledTooltip: t("You can not remove your last sign-in email")
        }]
      ] }) })
    ] }, x.id)) }) }) }) : null
  ] });
}
export {
  EmailsSection
};
//# sourceMappingURL=emails-section.js.map