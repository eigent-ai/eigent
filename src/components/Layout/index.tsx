import TopBar from "@/components/TopBar";
import { Outlet } from "react-router-dom";
import HistorySidebar from "../HistorySidebar";
import { InstallDependencies } from "@/components/InstallStep/InstallDependencies";
import { useAuthStore } from "@/store/authStore";
import { useEffect, useState } from "react";
import { AnimationJson } from "@/components/AnimationJson";
import animationData from "@/assets/animation/onboarding_success.json";
import CloseNoticeDialog from "../Dialog/CloseNotice";
import { useInstallationUI } from "@/store/installationStore";
import { useInstallationSetup } from "@/hooks/useInstallationSetup";
import InstallationErrorDialog from "../InstallStep/InstallationErrorDialog/InstallationErrorDialog";
import Halo from "../Halo";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

const Layout = () => {
	const { initState, isFirstLaunch, setIsFirstLaunch, setInitState } = useAuthStore();
	const [noticeOpen, setNoticeOpen] = useState(false);

	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		console.log(chatStore);

		return <div>Loading...</div>;
	}

	const {
		installationState,
		latestLog,
		error,
		backendError,
		isInstalling,
		shouldShowInstallScreen,
		retryInstallation,
		retryBackend,
	} = useInstallationUI();

	useInstallationSetup();

	useEffect(() => {
		const handleBeforeClose = () => {
			const currentStatus = chatStore.tasks[chatStore.activeTaskId as string]?.status;
			if(["running", "pause"].includes(currentStatus)) {
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

	const actualShouldShowInstallScreen = shouldShowInstallScreen || initState !== 'done' || installationState === 'waiting-backend';
	const shouldShowMainContent = !actualShouldShowInstallScreen;

	return (
		<div className="h-full flex flex-col relative overflow-hidden">
			<TopBar />
			<div className="flex-1 h-full min-h-0 overflow-hidden relative">
				{/* Onboarding animation */}
				{shouldShowOnboarding && (
					<AnimationJson
						onComplete={() => setIsFirstLaunch(false)}
						animationData={animationData}
					/>
				)}

				{/* Installation screen */}
				{actualShouldShowInstallScreen && <InstallDependencies />}

				{/* Main app content */}
				{shouldShowMainContent && (
					<>
						<Outlet />
						<HistorySidebar />
					</>
				)}

				{(backendError || (error && installationState === "error")) && (
					<InstallationErrorDialog
						error={error || ""}
						backendError={backendError}
						installationState={installationState}
						latestLog={latestLog}
						retryInstallation={retryInstallation}
						retryBackend={retryBackend}
					/>
				)}

				<CloseNoticeDialog
					onOpenChange={setNoticeOpen}
					open={noticeOpen}
				/>
				<Halo />
			</div>
			</div>
	);
};

export default Layout;
