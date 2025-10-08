import { useState, useRef, useEffect, useMemo } from "react";
import {
	Settings,
	Minus,
	Square,
	X,
	FileDown,
	Menu,
	Plus,
	Import,
	XCircle,
	Power,
	ChevronDown,
} from "lucide-react";
import "./index.css";
import folderIcon from "@/assets/Folder.svg";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { useChatStore } from "@/store/chatStore";
import { useSidebarStore } from "@/store/sidebarStore";
import giftIcon from "@/assets/gift.svg";
import { getAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import { proxyFetchGet, fetchPut, fetchDelete, proxyFetchDelete } from "@/api/http";
import { toast } from "sonner";
import EndNoticeDialog from "@/components/Dialog/EndNotice";
 
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
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
	const [isFullscreen, setIsFullscreen] = useState(false);
	const { token } = getAuthStore();
	const [endDialogOpen, setEndDialogOpen] = useState(false);
	useEffect(() => {
		const p = window.electronAPI.getPlatform();
		setPlatform(p);

		if (platform === "darwin") {
			titlebarRef.current?.classList.add("mac");
			if (controlsRef.current) {
				controlsRef.current.style.display = "none";
			}
		}
	}, []);

	useEffect(() => {
		// use window.electronAPI instead of window.require
		const handleFullScreen = async () => {
			try {
				// get fullscreen status through window.electronAPI
				const isFull = await window.electronAPI.isFullScreen();
				setIsFullscreen(isFull);
			} catch (error) {
				console.error("Failed to get fullscreen status:", error);
			}
		};
		// add event listener
		window.addEventListener("resize", handleFullScreen);

		// initialize state
		handleFullScreen();

		return () => {
			window.removeEventListener("resize", handleFullScreen);
		};
	}, []);

	const exportLog = async () => {
		try {
			const response = await window.electronAPI.exportLog();

			if (!response.success) {
				alert("Export cancelled:" + response.error);
				return;
			}
			if (response.savedPath) {
				window.location.href =
					"https://github.com/eigent-ai/eigent/issues/new/choose";
				alert("log saved:" + response.savedPath);
			}
		} catch (e: any) {
			alert("export error:" + e.message);
		}
	};

	// create new project handler reused by plus icon and label
	const createNewProject = () => {
		const taskId = Object.keys(chatStore.tasks).find((taskId) => {
			return chatStore.tasks[taskId].messages.length === 0;
		});
		if (taskId) {
			chatStore.setActiveTaskId(taskId);
			navigate("/");
			return;
		}
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
		return t("chat.new-project");
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
				toast.success("Invitation link copied!");
			} else {
				toast.error("Failed to get invite code");
			}
		} catch (error) {
			console.error("Failed to get referral link:", error);
			toast.error("Failed to get invitation link");
		}
	};

	const handleEndProject = async () => {
		const taskId = chatStore.activeTaskId;
		if (!taskId) {
			toast.error("No active project to end");
			return;
		}

		try {
			const task = chatStore.tasks[taskId];
			
			// Stop the task if it's running
			if (task && task.status === 'running') {
				await fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
					action: 'stop',
				});
			}

			// Delete task from backend if it exists
			try {
				await fetchDelete(`/chat/${taskId}`);
			} catch (error) {
				console.log("Task may not exist on backend:", error);
			}

			// Delete from history
			try {
				await proxyFetchDelete(`/api/chat/history/${taskId}`);
			} catch (error) {
				console.log("Task may not exist in history:", error);
			}

			// Remove from local store
			chatStore.removeTask(taskId);

			// Create a new project
			const newTaskId = chatStore.create();
			chatStore.setActiveTaskId(newTaskId);

			// Navigate to home
			navigate("/");

			toast.success("Project ended successfully", {
				closeButton: true,
			});
		} catch (error) {
			console.error("Failed to end project:", error);
			toast.error("Failed to end project", {
				closeButton: true,
			});
		} finally {
			setEndDialogOpen(false);
		}
	};

	return (
		<div
			className="flex !h-9 items-center justify-between pl-2 py-1 z-50"
			id="titlebar"
			ref={titlebarRef}
		>
			{/* left */}
			<div
				className={`${
					platform === "darwin" && isFullscreen ? "w-0" : "w-[70px]"
				} flex items-center justify-center no-drag`}
			>
				{platform !== "darwin" && <span>Eigent</span>}
			</div>

			{/* center */}
			<div className="title h-full flex-1 flex items-center justify-between drag">
				<div className="flex h-full items-center z-50 relative">
					<div className="flex-1 pt-1 pr-sm flex justify-start items-end">
						<Button
							onClick={() => navigate("/history")}
							variant="ghost"
							size="icon"
							className="no-drag p-0 h-6 w-6"
						>
							<img className="w-6 h-6" src={folderIcon} alt="folder-icon" />
						</Button>
					</div>
					{location.pathname !== "/history" && (
						<div className="flex items-center">
						<Button
							 variant="ghost"
							 size="icon"
							 className="no-drag"
							 onClick={createNewProject}
									>
									<Plus className="w-4 h-4" />
						</Button>
						</div>
					)}
					{location.pathname !== "/history" && (
						<>
							{activeTaskTitle === t("chat.new-project") ? (
								<Button 
								  variant="ghost" 
									className="font-bold text-base no-drag truncate" 
								  onClick={toggle}
								  size="sm"
								  >
									{t("chat.new-project")}
									<ChevronDown />
								</Button>
							) : (
								<Button
									id="active-task-title-btn"
									variant="ghost"
									size="sm"
									className="font-bold text-base no-drag truncate"
									onClick={toggle}
								>
									{activeTaskTitle}
									<ChevronDown />
								</Button>
							)}
						</>
					)}
				</div>
				<div id="maximize-window" className="flex-1 h-10"></div>
				{/* right */}
				{location.pathname !== "/history" && (
					<div
						className={`${
							platform === "darwin" && "pr-2"
						} flex h-full items-center space-x-1 z-50 relative no-drag`}
					>
						<Button
							onClick={exportLog}
							variant="ghost"
							size="xs"
							className="mr-2 no-drag leading-tight"
						>
							<FileDown className="w-4 h-4" />
							{t("layout.report-bug")}
						</Button>
						<Button
							onClick={getReferFriendsLink}
							variant="ghost"
							size="xs"
							className="no-drag"
						>
							<img
								src={giftIcon}
								alt="gift-icon"
								className="w-4 h-4"
							/>
							{t("layout.refer-friends")}
						</Button>
						<Button
							onClick={() => setEndDialogOpen(true)}
							variant="ghost"
							size="xs"
							className="no-drag leading-tight text-text-cuation"
						>
							<Power />
							End Project
						</Button>
						<Button
							onClick={() => navigate("/setting")}
							variant="ghost"
							size="icon"
							className="no-drag"
						>
							<Settings className="w-4 h-4" />
						</Button>
					</div>
				)}
			</div>
			{platform !== "darwin" && (
				<div
					className="window-controls h-full flex items-center"
					id="window-controls"
					ref={controlsRef}
				>
					<div
						className="control-btn h-full flex-1"
						onClick={() => window.electronAPI.minimizeWindow()}
					>
						<Minus className="w-4 h-4" />
					</div>
					<div
						className="control-btn h-full flex-1"
						onClick={() => window.electronAPI.toggleMaximizeWindow()}
					>
						<Square className="w-4 h-4" />
					</div>
					<div
						className="control-btn h-full flex-1"
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
			/>
		</div>
	);
}

export default HeaderWin;