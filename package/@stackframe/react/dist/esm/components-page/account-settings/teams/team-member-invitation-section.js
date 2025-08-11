// src/components-page/account-settings/teams/team-member-invitation-section.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Typography } from "@stackframe/stack-ui";
import { Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { FormWarningText } from "../../../components/elements/form-warning";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function TeamMemberInvitationSection(props) {
  const user = useUser({ or: "redirect" });
  const inviteMemberPermission = user.usePermission(props.team, "$invite_members");
  if (!inviteMemberPermission) {
    return null;
  }
  return /* @__PURE__ */ jsx(MemberInvitationSectionInner, { team: props.team });
}
function MemberInvitationsSectionInvitationsList(props) {
  const user = useUser({ or: "redirect" });
  const { t } = useTranslation();
  const invitationsToShow = props.team.useInvitations();
  const removeMemberPermission = user.usePermission(props.team, "$remove_members");
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs(Table, { className: "mt-6", children: [
    /* @__PURE__ */ jsx(TableHeader, { children: /* @__PURE__ */ jsxs(TableRow, { children: [
      /* @__PURE__ */ jsx(TableHead, { className: "w-[200px]", children: t("Outstanding invitations") }),
      /* @__PURE__ */ jsx(TableHead, { className: "w-[60px]", children: t("Expires") }),
      /* @__PURE__ */ jsx(TableHead, { className: "w-[36px] max-w-[36px]" })
    ] }) }),
    /* @__PURE__ */ jsxs(TableBody, { children: [
      invitationsToShow.map((invitation, i) => /* @__PURE__ */ jsxs(TableRow, { children: [
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsx(Typography, { children: invitation.recipientEmail }) }),
        /* @__PURE__ */ jsx(TableCell, { children: /* @__PURE__ */ jsx(Typography, { variant: "secondary", children: invitation.expiresAt.toLocaleString() }) }),
        /* @__PURE__ */ jsx(TableCell, { align: "right", className: "max-w-[36px]", children: removeMemberPermission && /* @__PURE__ */ jsx(Button, { onClick: async () => await invitation.revoke(), size: "icon", variant: "ghost", children: /* @__PURE__ */ jsx(Trash, { className: "w-4 h-4" }) }) })
      ] }, invitation.id)),
      invitationsToShow.length === 0 && /* @__PURE__ */ jsx(TableRow, { children: /* @__PURE__ */ jsx(TableCell, { colSpan: 3, children: /* @__PURE__ */ jsx(Typography, { variant: "secondary", children: t("No outstanding invitations") }) }) })
    ] })
  ] }) });
}
function MemberInvitationSectionInner(props) {
  const user = useUser({ or: "redirect" });
  const { t } = useTranslation();
  const readMemberPermission = user.usePermission(props.team, "$read_members");
  const invitationSchema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email address")).defined().nonEmpty(t("Please enter an email address"))
  });
  const { register, handleSubmit, formState: { errors }, watch } = useForm({
    resolver: yupResolver(invitationSchema)
  });
  const [loading, setLoading] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState(null);
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      await props.team.inviteUser({ email: data.email });
      setInvitedEmail(data.email);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    setInvitedEmail(null);
  }, [watch("email")]);
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      Section,
      {
        title: t("Invite member"),
        description: t("Invite a user to your team through email"),
        children: /* @__PURE__ */ jsxs(
          "form",
          {
            onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
            noValidate: true,
            className: "w-full",
            children: [
              /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-4 sm:flex-row w-full", children: [
                /* @__PURE__ */ jsx(
                  Input,
                  {
                    placeholder: t("Email"),
                    ...register("email")
                  }
                ),
                /* @__PURE__ */ jsx(Button, { type: "submit", loading, children: t("Invite User") })
              ] }),
              /* @__PURE__ */ jsx(FormWarningText, { text: errors.email?.message?.toString() }),
              invitedEmail && /* @__PURE__ */ jsxs(Typography, { type: "label", variant: "secondary", children: [
                "Invited ",
                invitedEmail
              ] })
            ]
          }
        )
      }
    ),
    readMemberPermission && /* @__PURE__ */ jsx(MemberInvitationsSectionInvitationsList, { team: props.team })
  ] });
}
export {
  TeamMemberInvitationSection
};
//# sourceMappingURL=team-member-invitation-section.js.map