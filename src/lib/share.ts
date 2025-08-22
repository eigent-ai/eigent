import { proxyFetchPost } from "@/api/http";
import {toast} from "sonner";

export const share = async (taskId: string) => {
	try {
		const res = await proxyFetchPost(`/api/chat/share`, {
			task_id: taskId,
		});
		const shareLink = `${import.meta.env.VITE_USE_LOCAL_PROXY === "true" ? 'eigent://callback' : 'https://www.eigent.ai/download'}?share_token=${res.share_token}__${taskId}`;
		navigator.clipboard
			.writeText(shareLink)
			.then(() => {
				toast.success("The share link has been copied.");
			})
			.catch((err) => {
				console.error("Failed to copy:", err);
			});
	} catch (error) {
		console.error("Failed to share task:", error);
	}
};