import TopBar from "@/components/TopBar";
import { Outlet } from "react-router-dom";
import HistorySidebar from "../HistorySidebar";
import { InstallDependencies } from "@/components/InstallStep/InstallDependencies";
import { useAuthStore } from "@/store/authStore";
import { useEffect, useState } from "react";
import { AnimationJson } from "@/components/AnimationJson";
import animationData from "@/assets/animation/onboarding_success.json";
const Layout = () => {
	const { initState, setInitState, isFirstLaunch, setIsFirstLaunch } =
		useAuthStore();
	const [isInstalling, setIsInstalling] = useState(false);
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
			</div>
		</div>
	);
};

export default Layout;
