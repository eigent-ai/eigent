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
	const { initState, isFirstLaunch, setIsFirstLaunch, setInitState } = useAuthStore();
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

	// Additional check: If initState is carousel but tools are installed, skip to done
	useEffect(() => {
		const checkAndSkipCarousel = async () => {
			if (initState === 'carousel' && !isInstalling) {
				try {
					const result = await window.ipcRenderer.invoke("check-tool-installed");
					if (result.success && result.isInstalled) {
						console.log('[Layout] Tools installed, skipping carousel and setting initState to done');
						setInitState('done');
					}
				} catch (error) {
					console.error('[Layout] Failed to check tool installation:', error);
				}
			}
		};

		checkAndSkipCarousel();
	}, [initState, isInstalling, setInitState]);

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
	// Show install screen if either:
	// 1. The installation store says to show it (isVisible && not completed)
	// 2. OR if initState is not 'done' (meaning permissions or carousel should show)
	const actualShouldShowInstallScreen = shouldShowInstallScreen || initState !== 'done';
	const shouldShowMainContent = !actualShouldShowInstallScreen;

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
				{actualShouldShowInstallScreen && <InstallDependencies />}

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
