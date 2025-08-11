// src/components-page/account-settings/teams/team-api-keys-section.tsx
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { Button } from "@stackframe/stack-ui";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../../../components/api-key-dialogs";
import { ApiKeyTable } from "../../../components/api-key-table";
import { useStackApp, useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function TeamApiKeysSection(props) {
  const user = useUser({ or: "redirect" });
  const team = user.useTeam(props.team.id);
  const stackApp = useStackApp();
  const project = stackApp.useProject();
  if (!team) {
    throw new StackAssertionError("Team not found");
  }
  const teamApiKeysEnabled = project.config.allowTeamApiKeys;
  const manageApiKeysPermission = user.usePermission(props.team, "$manage_api_keys");
  if (!manageApiKeysPermission || !teamApiKeysEnabled) {
    return null;
  }
  return /* @__PURE__ */ jsx(TeamApiKeysSectionInner, { team: props.team });
}
function TeamApiKeysSectionInner(props) {
  const { t } = useTranslation();
  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState(null);
  const apiKeys = props.team.useApiKeys();
  const CreateDialog = CreateApiKeyDialog;
  const ShowDialog = ShowApiKeyDialog;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(
      Section,
      {
        title: t("API Keys"),
        description: t("API keys grant programmatic access to your team."),
        children: /* @__PURE__ */ jsx(Button, { onClick: () => setIsNewApiKeyDialogOpen(true), children: t("Create API Key") })
      }
    ),
    /* @__PURE__ */ jsx(ApiKeyTable, { apiKeys }),
    /* @__PURE__ */ jsx(
      CreateDialog,
      {
        open: isNewApiKeyDialogOpen,
        onOpenChange: setIsNewApiKeyDialogOpen,
        onKeyCreated: setReturnedApiKey,
        createApiKey: async (data) => {
          const apiKey = await props.team.createApiKey(data);
          return apiKey;
        }
      }
    ),
    /* @__PURE__ */ jsx(
      ShowDialog,
      {
        apiKey: returnedApiKey,
        onClose: () => setReturnedApiKey(null)
      }
    )
  ] });
}
export {
  TeamApiKeysSection
};
//# sourceMappingURL=team-api-keys-section.js.map