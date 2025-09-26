import { Button } from "@/components/ui/button";
import type { MCPUserItem } from "./types";
import { useTranslation } from "react-i18next";
interface MCPDeleteDialogProps {
  open: boolean;
  target: MCPUserItem | null;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
}

export default function MCPDeleteDialog({ open, target, onCancel, onConfirm, loading }: MCPDeleteDialogProps) {
  const { t } = useTranslation();
  if (!open || !target) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30">
      <div className="bg-white-100% rounded-lg shadow-lg p-6 min-w-[320px] max-w-[90vw]">
        <div className="font-bold mb-2 text-red-600">{t("setting.confirm-delete")}</div>
        <div className="mb-4">{t("setting.are-you-sure-you-want-to-delete")} <b>{target.mcp_name}</b>?</div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>{t("setting.cancel")}</Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? t("setting.deleting") : t("setting.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
} 