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
			title="Delete Task"
			message="Are you sure you want to delete this task? This action cannot be undone."
			confirmText="Delete"
			cancelText="Cancel"
		/>
    <div className="px-6 py-4 flex justify-between items-center">
<div className="text-2xl font-bold leading-4">Triggers</div>
<div className="flex items-center gap-md">
</div>
    </div>
  </div>

);
}