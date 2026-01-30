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

import { useState, useRef, useEffect, useMemo } from "react";
import {
	Settings,
	Minus,
	Square,
	X,
	FileDown,
	Plus,
	Power,
	ChevronDown,
	ChevronLeft,
	House,
} from "lucide-react";
import folderIcon from "@/assets/Folder.svg";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { useSidebarStore } from "@/store/sidebarStore";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import giftIcon from "@/assets/gift.svg";
import { getAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import { proxyFetchGet, fetchPut, fetchDelete, proxyFetchDelete } from "@/api/http";
import { toast } from "sonner";
import EndNoticeDialog from "@/components/Dialog/EndNotice";
import { share } from "@/lib/share";
import { TooltipSimple } from "@/components/ui/tooltip";
import { useInstallationUI } from "@/store/installationStore";
 
function HeaderWin() {
	const { t } = useTranslation();
	const titlebarRef = useRef<HTMLDivElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const [platform, setPlatform] = useState<string>("");
	const navigate = useNavigate();
	const location = useLocation();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const { toggle } = useSidebarStore();
	const { token } = getAuthStore();
	const [endDialogOpen, setEndDialogOpen] = useState(false);
	const { isInstalling, installationState } = useInstallationUI();
	const isInstallationActive = isInstalling || installationState === "waiting-backend";
	const [endProjectLoading, setEndProjectLoading] = useState(false);
	useEffect(() => {
		const p = window.electronAPI.getPlatform();
		setPlatform(p);
	}, []);

	const exportLog = async () => {
		try {
			const response = await window.electronAPI.exportLog();

			if (!response.success) {
				alert(t("layout.export-cancelled") + response.error);
				return;
			}
			if (response.savedPath) {
				window.location.href =
					"https://github.com/eigent-ai/eigent/issues/new/choose";
				alert(t("layout.log-saved") + response.savedPath);
			}
		} catch (e: any) {
			alert(t("layout.export-error") + e.message);
		}
	};

	// create new project handler reused by plus icon and label
	const createNewProject = () => {
		//Handles refocusing id & nonduplicate internally
		projectStore.createProject("new project");
		navigate("/");
	};

	const activeTaskTitle = useMemo(() => {
		if (
			chatStore.activeTaskId &&
			chatStore.tasks[chatStore.activeTaskId as string]?.summaryTask
		) {
			return chatStore.tasks[
				chatStore.activeTaskId as string
			].summaryTask.split("|")[0];
		}
		return t("layout.new-project");
	}, [
		chatStore.activeTaskId,
		chatStore.tasks[chatStore.activeTaskId as string]?.summaryTask,
	]);

	const getReferFriendsLink = async () => {
		try {
			const res: any = await proxyFetchGet("/api/user/invite_code");
			if (res?.invite_code) {
				const inviteLink = `https://www.eigent.ai/signup?invite_code=${res.invite_code}`;
				await navigator.clipboard.writeText(inviteLink);
				toast.success(t("layout.invitation-link-copied"));
			} else {
				toast.error(t("layout.failed-to-get-invite-code"));
			}
		} catch (error) {
			console.error("Failed to get referral link:", error);
			toast.error(t("layout.failed-to-get-invitation-link"));
		}
	};

	//TODO: Mark ChatStore details as completed
	const handleEndProject = async () => {
		const taskId = chatStore.activeTaskId;
		const projectId = projectStore.activeProjectId;

		if (!taskId) {
			toast.error(t("layout.no-active-project-to-end"));
			return;
		}

		const historyId = projectId ? projectStore.getHistoryId(projectId) : null;

		setEndProjectLoading(true);
		try {
			const task = chatStore.tasks[taskId];

			// Stop the task if it's running
			if (task && task.status === 'running') {
				await fetchPut(`/task/${taskId}/take-control`, {
					action: 'stop',
				});
			}

			// Stop Workforce
			try {
				await fetchDelete(`/chat/${projectId}`);
			} catch (error) {
				console.log("Task may not exist on backend:", error);
			}

			// Delete from history using historyId
			if (historyId && task.status !== "finished") {
				try {
					await proxyFetchDelete(`/api/chat/history/${historyId}`);
					// Remove from local store
					chatStore.removeTask(taskId);
				} catch (error) {
					console.log("History may not exist:", error);
				}
			} else {
				console.warn("No historyId found for project or task finished, skipping history deletion");
			}


			// Create a completely new project instead of just a new task
			// This ensures we start fresh without any residual state
			projectStore.createProject("new project");

			// Navigate to home with replace to force refresh
			navigate("/", { replace: true });

			toast.success(t("layout.project-ended-successfully"), {
				closeButton: true,
			});
		} catch (error) {
			console.error("Failed to end project:", error);
			toast.error(t("layout.failed-to-end-project"), {
				closeButton: true,
			});
		} finally {
			setEndProjectLoading(false);
			setEndDialogOpen(false);
		}
	};

	const handleShare = async (taskId: string) => {
		share(taskId);
	};

	return (
		<div
			className={`absolute top-0 left-0 right-0 flex !h-9 items-center justify-between py-1 z-50 drag ${
				platform === "darwin" ? "pl-20" : "pl-2"
			}`}
			id="titlebar"
			ref={titlebarRef}
		>
			{/* left */}
			{platform !== "darwin" && (
				<div className="w-[70px] flex items-center justify-center no-drag">
					<span className="text-label-md text-text-heading font-bold">Eigent</span>
				</div>
			)}

			{/* center */}
			<div className="w-full h-full flex items-center justify-between drag">
				<div className="flex h-full items-center z-50 relative">
					<div className="flex-1 pt-1 pr-1 flex justify-start items-end">
					<Button
						onClick={() => navigate("/history")}
						variant="ghost"
						size="icon"
						className="no-drag p-0 h-6 w-6"
					>
						<img className="w-6 h-6" src={folderIcon} alt="folder-icon" />
					</Button>
					</div>
					{location.pathname === "/history" && (
						<div className="flex items-center mr-1">
							<Button
								variant="ghost"
								size="xs"
								className="no-drag"
								onClick={() => navigate("/")}
							>
								<ChevronLeft className="w-4 h-4" />
							</Button>
						</div>
					)}
					{location.pathname !== "/history" && (
						<div className="flex items-center mr-1">
						<TooltipSimple content={t("layout.home")} side="bottom" align="center">
							<Button
								 variant="ghost"
								 size="icon"
								 className="no-drag"
								 onClick={() => navigate("/history")}
									>
									<House className="w-4 h-4" />
							</Button>
						</TooltipSimple>
						<TooltipSimple content={t("layout.new-project")} side="bottom" align="center">
							<Button
								variant="ghost"
								size="icon"
								className="no-drag"
								onClick={createNewProject}
							>
								<Plus className="w-4 h-4" />
							</Button>
						</TooltipSimple>
						</div>
					)}
					{location.pathname !== "/history" && (
						<>
							{activeTaskTitle === t("layout.new-project") ? (
								<TooltipSimple content={t("layout.new-project")} side="bottom" align="center">
									<Button 
										id="active-task-title-btn"
										variant="ghost" 
										className="font-bold text-base no-drag" 
										onClick={toggle}
										size="sm"
									>
									<span className="inline-block max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap align-middle">{t("layout.new-project")}</span>
										<ChevronDown />
									</Button>
								</TooltipSimple>
							) : (
								<TooltipSimple content={activeTaskTitle} side="bottom" align="center">
									<Button
										id="active-task-title-btn"
										variant="ghost"
										size="sm"
										className="font-bold text-base no-drag"
										onClick={toggle}
									>
										<span className="inline-block max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap align-middle">{activeTaskTitle}</span>
										<ChevronDown />
									</Button>
								</TooltipSimple>
							)}
						</>
					)}
				</div>
				{/* right */}
				{location.pathname !== "/history" && (
					<div
						className={`${
							platform === "darwin" && "pr-2"
						} flex h-full items-center z-50 relative no-drag gap-1`}
					>
						{chatStore.activeTaskId &&
							chatStore.tasks[chatStore.activeTaskId as string] &&
							(
								(chatStore.tasks[chatStore.activeTaskId as string]?.messages?.length || 0) > 0 ||
								chatStore.tasks[chatStore.activeTaskId as string]?.hasMessages ||
								chatStore.tasks[chatStore.activeTaskId as string]?.status !== 'pending'
							) && (
							<TooltipSimple content={t("layout.end-project")} side="bottom" align="end">
								<Button
									onClick={() => setEndDialogOpen(true)}
									variant="outline"
									size="xs"
									className="no-drag !text-text-cuation justify-center"
								>
									<Power />
									{t("layout.end-project")}
								</Button>
							</TooltipSimple>
						)}
						{chatStore.activeTaskId &&
							chatStore.tasks[chatStore.activeTaskId as string]?.status === 'finished' && (
							<TooltipSimple content={t("layout.share")} side="bottom" align="end">
								<Button
									onClick={() => handleShare(chatStore.activeTaskId as string)}
									variant="ghost"
									size="xs"
									className="no-drag !text-button-fill-information-foreground bg-button-fill-information"
								>
									{t("layout.share")}
								</Button>
							</TooltipSimple>
						)}
						{chatStore.activeTaskId && chatStore.tasks[chatStore.activeTaskId as string] && (
							<TooltipSimple content={t("layout.report-bug")} side="bottom" align="end">
								<Button
									onClick={exportLog}
									variant="ghost"
									size="icon"
									className="no-drag rounded-full"
								>
									<FileDown className="w-4 h-4" />
								</Button>
							</TooltipSimple>
						)}
						<TooltipSimple content={t("layout.refer-friends")} side="bottom" align="end">
							<Button
								onClick={getReferFriendsLink}
								variant="ghost"
								size="icon"
								className="no-drag"
							>
								<img
									src={giftIcon}
									alt="gift-icon"
									className="w-4 h-4"
								/>
							</Button>
						</TooltipSimple>
						<TooltipSimple content={t("layout.settings")} side="bottom" align="end">
							<Button
								onClick={() => navigate("/history?tab=settings")}
								variant="ghost"
								size="icon"
								className="no-drag"
							>
								<Settings className="w-4 h-4" />
							</Button>
						</TooltipSimple>
					</div>
				)}
				{location.pathname === "/history" && (
					<div
						className={`${
							platform === "darwin" && "pr-2"
						} flex h-full items-center z-50 relative no-drag gap-1`}
					>
					</div>
				)}
			</div>
			{platform !== "darwin" && (
				<div
					className="h-full flex items-center no-drag"
					id="window-controls"
					ref={controlsRef}
				>
					<div
						className="w-[35px] cursor-pointer text-center leading-5 h-full flex items-center justify-center hover:bg-[#f0f0f0] flex-1"
						onClick={() => window.electronAPI.minimizeWindow()}
					>
						<Minus className="w-4 h-4" />
					</div>
					<div
						className="w-[35px] cursor-pointer text-center leading-5 h-full flex items-center justify-center hover:bg-[#f0f0f0] flex-1"
						onClick={() => window.electronAPI.toggleMaximizeWindow()}
					>
						<Square className="w-4 h-4" />
					</div>
					<div
						className="w-[35px] cursor-pointer text-center leading-5 h-full flex items-center justify-center hover:bg-[#f0f0f0] flex-1"
						onClick={() => window.electronAPI.closeWindow()}
					>
						<X className="w-4 h-4" />
					</div>
				</div>
			)}
			<EndNoticeDialog
				open={endDialogOpen}
				onOpenChange={setEndDialogOpen}
				onConfirm={handleEndProject}
				loading={endProjectLoading}
			/>
		</div>
	);
}

export default HeaderWin;
