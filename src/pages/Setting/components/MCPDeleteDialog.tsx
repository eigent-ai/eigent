import { Button } from "@/components/ui/button";
import type { MCPUserItem } from "./types";

interface MCPDeleteDialogProps {
	open: boolean;
	target: MCPUserItem | null;
	onCancel: () => void;
	onConfirm: () => void;
	loading: boolean;
}

export default function MCPDeleteDialog({
	open,
	target,
	onCancel,
	onConfirm,
	loading,
}: MCPDeleteDialogProps) {
	if (!open || !target) return null;
	return (
		<div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30">
			<div className="bg-white-100% rounded-lg shadow-lg p-6 min-w-[320px] max-w-[90vw]">
				<div className="font-bold mb-2 text-red-600">Confirm Delete</div>
				<div className="mb-4">
					Are you sure you want to delete <b>{target.mcp_name}</b>?
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="outline" onClick={onCancel} disabled={loading}>
						Cancel
					</Button>
					<Button variant="primary" onClick={onConfirm} disabled={loading}>
						{loading ? "Deleting..." : "Delete"}
					</Button>
				</div>
			</div>
		</div>
	);
}
