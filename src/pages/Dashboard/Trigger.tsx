import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, List } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGlobalStore } from "@/store/globalStore";
import AlertDialog from "@/components/ui/alertDialog";
import { useState } from "react";

export default function Trigger() {
  const {t} = useTranslation();
  const { history_type, setHistoryType } = useGlobalStore();
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const confirmDelete = () => {
    setDeleteModalOpen(false);
  };

return (
  <div className="max-w-[900px] mx-auto flex flex-col h-full">
    		{/* alert dialog */}
		<AlertDialog
			isOpen={deleteModalOpen}
			onClose={() => setDeleteModalOpen(false)}
			onConfirm={confirmDelete}
			title={t("layout.delete-task")}
			message={t("layout.delete-task-confirmation")}
			confirmText={t("layout.delete")}
			cancelText={t("layout.cancel")}
		/>
    <div className="px-6 py-4 flex justify-between items-center">
<div className="text-2xl font-bold leading-4">{t("layout.triggers")}</div>
<div className="flex items-center gap-md">
</div>
    </div>
  </div>

);
}