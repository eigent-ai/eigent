"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/components-page/account-settings/teams/team-member-invitation-section.tsx
var team_member_invitation_section_exports = {};
__export(team_member_invitation_section_exports, {
  TeamMemberInvitationSection: () => TeamMemberInvitationSection
});
module.exports = __toCommonJS(team_member_invitation_section_exports);
var import_yup = require("@hookform/resolvers/yup");
var import_schema_fields = require("@stackframe/stack-shared/dist/schema-fields");
var import_promises = require("@stackframe/stack-shared/dist/utils/promises");
var import_stack_ui = require("@stackframe/stack-ui");
var import_lucide_react = require("lucide-react");
var import_react = require("react");
var import_react_hook_form = require("react-hook-form");
var import_form_warning = require("../../../components/elements/form-warning");
var import_hooks = require("../../../lib/hooks");
var import_translations = require("../../../lib/translations");
var import_section = require("../section");
var import_jsx_runtime = require("react/jsx-runtime");
function TeamMemberInvitationSection(props) {
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const inviteMemberPermission = user.usePermission(props.team, "$invite_members");
  if (!inviteMemberPermission) {
    return null;
  }
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MemberInvitationSectionInner, { team: props.team });
}
function MemberInvitationsSectionInvitationsList(props) {
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const { t } = (0, import_translations.useTranslation)();
  const invitationsToShow = props.team.useInvitations();
  const removeMemberPermission = user.usePermission(props.team, "$remove_members");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Table, { className: "mt-6", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHeader, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[200px]", children: t("Outstanding invitations") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[60px]", children: t("Expires") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableHead, { className: "w-[36px] max-w-[36px]" })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableBody, { children: [
      invitationsToShow.map((invitation, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.TableRow, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { children: invitation.recipientEmail }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", children: invitation.expiresAt.toLocaleString() }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { align: "right", className: "max-w-[36px]", children: removeMemberPermission && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { onClick: async () => await invitation.revoke(), size: "icon", variant: "ghost", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_lucide_react.Trash, { className: "w-4 h-4" }) }) })
      ] }, invitation.id)),
      invitationsToShow.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableRow, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.TableCell, { colSpan: 3, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Typography, { variant: "secondary", children: t("No outstanding invitations") }) }) })
    ] })
  ] }) });
}
function MemberInvitationSectionInner(props) {
  const user = (0, import_hooks.useUser)({ or: "redirect" });
  const { t } = (0, import_translations.useTranslation)();
  const readMemberPermission = user.usePermission(props.team, "$read_members");
  const invitationSchema = (0, import_schema_fields.yupObject)({
    email: (0, import_schema_fields.strictEmailSchema)(t("Please enter a valid email address")).defined().nonEmpty(t("Please enter an email address"))
  });
  const { register, handleSubmit, formState: { errors }, watch } = (0, import_react_hook_form.useForm)({
    resolver: (0, import_yup.yupResolver)(invitationSchema)
  });
  const [loading, setLoading] = (0, import_react.useState)(false);
  const [invitedEmail, setInvitedEmail] = (0, import_react.useState)(null);
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      await props.team.inviteUser({ email: data.email });
      setInvitedEmail(data.email);
    } finally {
      setLoading(false);
    }
  };
  (0, import_react.useEffect)(() => {
    setInvitedEmail(null);
  }, [watch("email")]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_section.Section,
      {
        title: t("Invite member"),
        description: t("Invite a user to your team through email"),
        children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "form",
          {
            onSubmit: (e) => (0, import_promises.runAsynchronouslyWithAlert)(handleSubmit(onSubmit)(e)),
            noValidate: true,
            className: "w-full",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex flex-col gap-4 sm:flex-row w-full", children: [
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                  import_stack_ui.Input,
                  {
                    placeholder: t("Email"),
                    ...register("email")
                  }
                ),
                /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_stack_ui.Button, { type: "submit", loading, children: t("Invite User") })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_form_warning.FormWarningText, { text: errors.email?.message?.toString() }),
              invitedEmail && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_stack_ui.Typography, { type: "label", variant: "secondary", children: [
                "Invited ",
                invitedEmail
              ] })
            ]
          }
        )
      }
    ),
    readMemberPermission && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MemberInvitationsSectionInvitationsList, { team: props.team })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TeamMemberInvitationSection
});
//# sourceMappingURL=team-member-invitation-section.js.map