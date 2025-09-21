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
} from "lucide-react";
import "./index.css";
import folderIcon from "@/assets/Folder.svg";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { useChatStore } from "@/store/chatStore";
import { useSidebarStore } from "@/store/sidebarStore";
import chevron_left from "@/assets/chevron_left.svg";
import { getAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import {  proxyFetchGet } from "@/api/http";
import { toast } from "sonner";
function HeaderWin() {
	const { t } = useTranslation();
	const titlebarRef = useRef<HTMLDivElement>(null);
	const controlsRef = useRef<HTMLDivElement>(null);
	const [platform, setPlatform] = useState<string>("");
	const navigate = useNavigate();
	const location = useLocation();
	const chatStore = useChatStore();
	const { toggle } = useSidebarStore();
	const [isFullscreen, setIsFullscreen] = useState(false);
	const { token } = getAuthStore();
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
		chatStore.create();
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

	const getReferFriendsLink = () => {
		proxyFetchGet("/api/user/invite_code").then((res: any) => {
			console.log(res);
			if (res?.invite_code) {
				const inviteCode =`https://www.eigent.ai/signup?invite_code=${res.invite_code}`;
				navigator.clipboard.writeText(inviteCode);
				toast.success("Invitation code copied!");
			} else {
				toast.error("Failed to get invite code");
			}
		});
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
						<img className="w-6 h-6" src={folderIcon} alt="folder-icon" />
					</div>
					{location.pathname !== "/history" && (
						<Button
							onClick={toggle}
							variant="ghost"
							size="icon"
							className="mr-1 no-drag"
						>
							<Menu className="w-4 h-4" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon"
						className="mr-2 no-drag"
						onClick={createNewProject}
					>
						<Plus className="w-4 h-4" />
					</Button>
					{location.pathname !== "/history" && (
						<>
							{activeTaskTitle === "New Project" ? (
								<Button
									variant="ghost"
									size="sm"
									className="font-bold text-base no-drag max-w-56 truncate"
									onClick={createNewProject}
								>
									{t("chat.new-project")}
								</Button>
							) : (
								<div className="font-bold leading-10 text-base min-w-10 max-w-56 truncate">
									{t("chat.new-project")}
								</div>
							)}
						</>
					)}
				</div>
				<div id="maximize-window" className="flex-1 h-10"></div>
				{/* right */}
				<div
					className={`${
						platform === "darwin" && "pr-2"
					} flex h-full items-center space-x-1 z-50 relative no-drag`}
				>
					<Button
						onClick={exportLog}
						variant="outline"
						size="xs"
						className="mr-2 no-drag leading-tight"
					>
						<FileDown className="w-4 h-4" />
						{t("layout.report-bug")}
					</Button>
					<Button
						onClick={getReferFriendsLink}
						variant="primary"
						size="xs"
						className="no-drag text-button-primary-text-default leading-tight"
					>
						<img
							src={chevron_left}
							alt="chevron_left"
							className="w-4 h-4 text-button-primary-icon-default"
						/>
						{t("layout.refer-friends")}
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
		</div>
	);
}

export default HeaderWin;