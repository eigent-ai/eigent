// src/components-page/account-settings/teams/team-creation-page.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormWarningText } from "../../../components/elements/form-warning";
import { MessageCard } from "../../../components/message-cards/message-card";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";
import { Section } from "../section";
import { jsx, jsxs } from "react/jsx-runtime";
function TeamCreationPage() {
  const { t } = useTranslation();
  const teamCreationSchema = yupObject({
    displayName: yupString().defined().nonEmpty(t("Please enter a team name"))
  });
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: yupResolver(teamCreationSchema)
  });
  const app = useStackApp();
  const project = app.useProject();
  const user = useUser({ or: "redirect" });
  const navigate = app.useNavigate();
  const [loading, setLoading] = useState(false);
  if (!project.config.clientTeamCreationEnabled) {
    return /* @__PURE__ */ jsx(MessageCard, { title: t("Team creation is not enabled") });
  }
  const onSubmit = async (data) => {
    setLoading(true);
    let team;
    try {
      team = await user.createTeam({ displayName: data.displayName });
    } finally {
      setLoading(false);
    }
    navigate(`#team-${team.id}`);
  };
  return /* @__PURE__ */ jsx(PageLayout, { children: /* @__PURE__ */ jsx(Section, { title: t("Create a Team"), description: t("Enter a display name for your new team"), children: /* @__PURE__ */ jsxs(
    "form",
    {
      onSubmit: (e) => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e)),
      noValidate: true,
      className: "flex gap-2 flex-col sm:flex-row",
      children: [
        /* @__PURE__ */ jsxs("div", { className: "flex flex-col flex-1", children: [
          /* @__PURE__ */ jsx(
            Input,
            {
              id: "displayName",
              type: "text",
              ...register("displayName")
            }
          ),
          /* @__PURE__ */ jsx(FormWarningText, { text: errors.displayName?.message?.toString() })
        ] }),
        /* @__PURE__ */ jsx(Button, { type: "submit", loading, children: t("Create") })
      ]
    }
  ) }) });
}
export {
  TeamCreationPage
};
//# sourceMappingURL=team-creation-page.js.map