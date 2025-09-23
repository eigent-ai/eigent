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
import { useInstallationUI } from "@/store/installationStore";
import { useInstallationSetup } from "@/hooks/useInstallationSetup";
import InstallationErrorDialog from "../InstallStep/InstallationErrorDialog/InstallationErrorDialog";
const Layout = () => {
	const { initState, isFirstLaunch, setIsFirstLaunch } = useAuthStore();
	const [noticeOpen, setNoticeOpen] = useState(false);
	const chatStore = useChatStore();
	const {
		installationState,
		latestLog,
		error,
		isInstalling,
		shouldShowInstallScreen,
		retryInstallation,
	} = useInstallationUI();	
	
	// Setup installation IPC listeners and state synchronization
	useInstallationSetup();

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

	// Determine what to show based on states
	const shouldShowOnboarding = initState === "done" && isFirstLaunch && !isInstalling;
	const shouldShowMainContent = !shouldShowInstallScreen;

	return (
		<div className="h-full flex flex-col">
		
			<TopBar />
			<div className="flex-1 h-full p-2">
				{/* Onboarding animation */}
				{shouldShowOnboarding && (
					<AnimationJson
						onComplete={() => setIsFirstLaunch(false)}
						animationData={animationData}
					/>
				)}

				{/* Installation screen */}
				{shouldShowInstallScreen && <InstallDependencies />}

				{/* Main app content */}
				{shouldShowMainContent && (
					<>
						<Outlet />
						<HistorySidebar />
					</>
				)}

				{(error != "" && error !=undefined) &&
					<InstallationErrorDialog 
						error={error} 
						installationState={installationState} 
						latestLog={latestLog} 
						retryInstallation={retryInstallation}/>
				}

				<CloseNoticeDialog
					onOpenChange={setNoticeOpen}
					open={noticeOpen}
				/>
			</div>
		</div>
	);
};

export default Layout;
