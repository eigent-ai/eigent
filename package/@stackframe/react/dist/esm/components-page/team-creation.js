"use client";
"use client";

// src/components-page/team-creation.tsx
import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { MessageCard, useStackApp, useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { useTranslation } from "../lib/translations";
import { jsx, jsxs } from "react/jsx-runtime";
function TeamCreation(props) {
  const { t } = useTranslation();
  const schema = yupObject({
    displayName: yupString().defined().nonEmpty(t("Please enter a team name"))
  });
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: yupResolver(schema)
  });
  const app = useStackApp();
  const project = app.useProject();
  const user = useUser({ or: "redirect" });
  const [loading, setLoading] = useState(false);
  const navigate = app.useNavigate();
  if (!project.config.clientTeamCreationEnabled) {
    return /* @__PURE__ */ jsx(MessageCard, { title: t("Team creation is not enabled") });
  }
  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const team = await user.createTeam({ displayName: data.displayName });
      navigate(`${app.urls.handler}/team-settings/${team.id}`);
    } finally {
      setLoading(false);
    }
  };
  return /* @__PURE__ */ jsx(MaybeFullPage, { fullPage: !!props.fullPage, children: /* @__PURE__ */ jsxs("div", { className: "stack-scope flex flex-col items-stretch", style: { maxWidth: "380px", flexBasis: "380px", padding: props.fullPage ? "1rem" : 0 }, children: [
    /* @__PURE__ */ jsx("div", { className: "text-center mb-6", children: /* @__PURE__ */ jsx(Typography, { type: "h2", children: t("Create a Team") }) }),
    /* @__PURE__ */ jsxs(
      "form",
      {
        className: "flex flex-col items-stretch stack-scope",
        onSubmit: (e) => runAsynchronously(handleSubmit(onSubmit)(e)),
        noValidate: true,
        children: [
          /* @__PURE__ */ jsx(Label, { htmlFor: "display-name", className: "mb-1", children: t("Display name") }),
          /* @__PURE__ */ jsx(
            Input,
            {
              id: "display-name",
              ...register("displayName")
            }
          ),
          /* @__PURE__ */ jsx(FormWarningText, { text: errors.displayName?.message?.toString() }),
          /* @__PURE__ */ jsx(Button, { type: "submit", className: "mt-6", loading, children: t("Create") })
        ]
      }
    )
  ] }) });
}
export {
  TeamCreation
};
//# sourceMappingURL=team-creation.js.map