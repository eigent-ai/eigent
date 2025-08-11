// src/components-page/account-settings/api-keys/api-keys-page.tsx
import { Button } from "@stackframe/stack-ui";
import { useState } from "react";
import { CreateApiKeyDialog, ShowApiKeyDialog } from "../../../components/api-key-dialogs";
import { ApiKeyTable } from "../../../components/api-key-table";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { PageLayout } from "../page-layout";
import { jsx, jsxs } from "react/jsx-runtime";
function ApiKeysPage() {
  const { t } = useTranslation();
  const user = useUser({ or: "redirect" });
  const apiKeys = user.useApiKeys();
  const [isNewApiKeyDialogOpen, setIsNewApiKeyDialogOpen] = useState(false);
  const [returnedApiKey, setReturnedApiKey] = useState(null);
  const CreateDialog = CreateApiKeyDialog;
  const ShowDialog = ShowApiKeyDialog;
  return /* @__PURE__ */ jsxs(PageLayout, { children: [
    /* @__PURE__ */ jsx(Button, { onClick: () => setIsNewApiKeyDialogOpen(true), children: t("Create API Key") }),
    /* @__PURE__ */ jsx(ApiKeyTable, { apiKeys }),
    /* @__PURE__ */ jsx(
      CreateDialog,
      {
        open: isNewApiKeyDialogOpen,
        onOpenChange: setIsNewApiKeyDialogOpen,
        onKeyCreated: setReturnedApiKey,
        createApiKey: async (data) => {
          const apiKey = await user.createApiKey(data);
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
  ApiKeysPage
};
//# sourceMappingURL=api-keys-page.js.map