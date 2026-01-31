// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

"use client";

import { useEffect, useState } from "react";
import {
	ScanFace,
	Search,
	Trash2,
} from "lucide-react";

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@/components/ui/command";
import { Button } from "./ui/button";
import { DialogTitle } from "./ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { proxyFetchDelete } from "@/api/http";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { replayProject } from "@/lib";
import { fetchHistoryTasks } from "@/service/historyApi";
import GroupedHistoryView from "@/components/GroupedHistoryView";
import { useGlobalStore } from "@/store/globalStore";
import { getAuthStore } from "@/store/authStore";

export function SearchHistoryDialog() {
	const {t} = useTranslation()
	const [open, setOpen] = useState(false);
	const [historyTasks, setHistoryTasks] = useState<any[]>([]);
	const { history_type } = useGlobalStore();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const navigate = useNavigate();
	const handleSetActive = (projectId: string, question: string, historyId: string) => {
		const project = projectStore.getProjectById(projectId);
		//If project exists
		if (project) {
			// if there is record, show result
			projectStore.setHistoryId(projectId, historyId);
			projectStore.setActiveProject(projectId)
			navigate(`/`);
			setOpen(false);
		} else {
			// if there is no record, execute replay
			handleReplay(projectId, question, historyId);
		}
	};

	const handleReplay = async (projectId: string, question: string, historyId: string) => {
		setOpen(false);
		await replayProject(projectStore, navigate, projectId, question, historyId);
	};

	const handleDelete = async (historyId: string, callback?: () => void) => {
		try {
			await proxyFetchDelete(`/api/chat/history/${historyId}`);

			// Also delete local files for this task if available (via Electron IPC)
			const history = historyTasks.find((item) => String(item.id) === String(historyId));
			const { email } = getAuthStore();
			if (history?.task_id && (window as any).ipcRenderer) {
				try {
					await (window as any).ipcRenderer.invoke(
						'delete-task-files',
						email,
						history.task_id,
						history.project_id ?? undefined
					);
				} catch (error) {
					console.warn("Local file cleanup failed:", error);
				}
			}

			setHistoryTasks((list) => list.filter((item) => String(item.id) !== String(historyId)));
			callback?.();
		} catch (error) {
			console.error("Failed to delete history task:", error);
		}
	};

	const handleShare = (taskId: string) => {
		// TODO: Implement share functionality similar to HistorySidebar
		console.log("Share task:", taskId);
	};

	useEffect(() => {
		fetchHistoryTasks(setHistoryTasks);
	}, []);
	return (
		<>
			<Button
				variant="ghost"
				className="h-[32px] bg-menutabs-bg-default border border-solid border-menutabs-border-default"
				size="sm"
				onClick={() => setOpen(true)}
			>
				<Search className="text-menutabs-icon-active" size={16} />
				<span>{t("dashboard.search")}</span>
			</Button>
			<CommandDialog open={open} onOpenChange={setOpen}>
				<DialogTitle asChild>
					<VisuallyHidden>{t("dashboard.search-dialog")}</VisuallyHidden>
				</DialogTitle>
				<CommandInput placeholder={t("dashboard.search-dialog-placeholder")} />
				<CommandList>
					<CommandEmpty>{t("dashboard.no-results")}</CommandEmpty>
					{history_type === "grid" ? (
						<div className="p-4">
							<GroupedHistoryView
								onTaskSelect={handleSetActive}
								onTaskDelete={handleDelete}
								onTaskShare={handleShare}
								activeTaskId={chatStore.activeTaskId || undefined}
							/>
						</div>
					) : (
						<CommandGroup heading="Today">
							{historyTasks.map((task) => (
								<CommandItem
									key={task.id}
									className="cursor-pointer"
									/**
									 * TODO(history): Update to use project_id field
									 * after update instead.
									 */
									onSelect={() => handleSetActive(task.task_id, task.question, task.id)}
								>
									<ScanFace />
									<div className="overflow-hidden text-ellipsis whitespace-nowrap">
										{task.question}
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="ml-auto text-muted-foreground hover:text-foreground"
										aria-label="Delete history"
										onClick={(e) => {
											e.preventDefault();
											e.stopPropagation();
											void handleDelete(String(task.id));
										}}
									>
										<Trash2 size={16} />
									</Button>
								</CommandItem>
							))}
						</CommandGroup>
					)}
					<CommandSeparator />
				</CommandList>
			</CommandDialog>
		</>
	);
}
