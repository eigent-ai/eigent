"use client";

import { useEffect, useState } from "react";
import {
	Calculator,
	Calendar,
	CreditCard,
	ScanFace,
	Search,
	Settings,
	Smile,
	User,
} from "lucide-react";

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
	CommandShortcut,
} from "@/components/ui/command";
import { Button } from "./ui/button";
import { DialogTitle } from "./ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { proxyFetchGet } from "@/api/http";
import { useNavigate } from "react-router-dom";
import { generateUniqueId } from "@/lib";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { replayProject } from "@/lib";

export function SearchHistoryDialog() {
	const {t} = useTranslation()
	const [open, setOpen] = useState(false);
	const [historyTasks, setHistoryTasks] = useState<any[]>([]);
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
			close();
		} else {
			// if there is no record, execute replay
			handleReplay(projectId, question, historyId);
		}
	};

	const handleReplay = async (projectId: string, question: string, historyId: string) => {
		close();
		await replayProject(projectStore, navigate, projectId, question, historyId);
	};

	useEffect(() => {
		const fetchHistoryTasks = async () => {
			try {
				const res = await proxyFetchGet(`/api/chat/histories`);
				setHistoryTasks(res.items);
			} catch (error) {
				console.error("Failed to fetch history tasks:", error);
			}
		};

		fetchHistoryTasks();
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
							</CommandItem>
						))}
					</CommandGroup>
					<CommandSeparator />
				</CommandList>
			</CommandDialog>
		</>
	);
}
