import TopBar from "@/components/TopBar";
import { Outlet } from "react-router-dom";
import HistorySidebar from "../HistorySidebar";
import { InstallDependencies } from "@/components/InstallStep/InstallDependencies";
import { useAuthStore } from "@/store/authStore";
import { useEffect, useState } from "react";
import { AnimationJson } from "@/components/AnimationJson";
import animationData from "@/assets/animation/onboarding_success.json";
import CloseNoticeDialog from "../Dialog/CloseNotice";
import { useChatStore } from "@/store/chatStore";
const Layout = () => {
	const { initState, setInitState, isFirstLaunch, setIsFirstLaunch } =
		useAuthStore();
	const [isInstalling, setIsInstalling] = useState(false);
	const [noticeOpen, setNoticeOpen] = useState(false);
	const chatStore = useChatStore();
	
	useEffect(() => {
		const handleBeforeClose = () => {
			const currentStatus = chatStore.tasks[chatStore.activeTaskId as string]?.status;
			if(["pending", "running", "pause"].includes(currentStatus)) {
				setNoticeOpen(true);
			} else {
				window.electronAPI.closeWindow(true);
			}
		};

		window.ipcRenderer.on("before-close", handleBeforeClose);

		return () => {
			window.ipcRenderer.removeAllListeners("before-close");
		};
	}, [chatStore.tasks, chatStore.activeTaskId]);

	useEffect(() => {
		const checkToolInstalled = async () => {
			// in render process
			const result = await window.ipcRenderer.invoke("check-tool-installed");
			if (result.success) {
				if (initState === "done" && !result.isInstalled) {
					setInitState("carousel");
				}
				console.log("tool is installed:");
			} else {
				console.error("check failed:", result.error);
			}
		};
		checkToolInstalled();
	}, []);

	return (
		<div className="h-full flex flex-col">
		
			<TopBar />
			<div className="flex-1 h-full p-2">
				{initState === "done" && isFirstLaunch && !isInstalling && (
					<AnimationJson
						onComplete={() => {
							setIsFirstLaunch(false);
						}}
						animationData={animationData}
					/>
				)}
				{(initState !== "done" || isInstalling) && (
					<InstallDependencies
						isInstalling={isInstalling}
						setIsInstalling={setIsInstalling}
					/>
				)}
				<Outlet />
				<HistorySidebar />
				<CloseNoticeDialog
					onOpenChange={setNoticeOpen}
					open={noticeOpen}
				/>
			</div>
		</div>
	);
};

export default Layout;
