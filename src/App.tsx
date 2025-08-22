import AppRoutes from "@/routers/index";
import React, { useEffect, useState } from "react";
import { stackClientApp } from "@/stack/client";
import { StackProvider, StackTheme } from "@stackframe/react";
import { useNavigate } from "react-router-dom";
import { AnimationJson } from "@/components/AnimationJson";
import animationData from "@/assets/animation/openning_animaiton.json";
import { useAuthStore } from "./store/authStore";
import { Toaster } from "sonner";
import { hasStackKeys } from "./lib";

const HAS_STACK_KEYS = hasStackKeys();

function App() {
	const navigate = useNavigate();
	const { setInitState } = useAuthStore();
	const [animationFinished, setAnimationFinished] = useState(false);
	const { isFirstLaunch } = useAuthStore();

	useEffect(() => {
		const handleShareCode = (event: any, share_token: string) => {
			navigate({
				pathname: "/",
				search: `?share_token=${encodeURIComponent(share_token)}`,
			});
		};

		//  listen version update notification
		const handleUpdateNotification = (data: {
			type: string;
			currentVersion: string;
			previousVersion: string;
			reason: string;
		}) => {
			console.log("receive version update notification:", data);

			if (data.type === "version-update") {
				// handle version update logic
				console.log(
					`version from ${data.previousVersion} to ${data.currentVersion}`
				);
				console.log(`update reason: ${data.reason}`);
				setInitState("carousel");
			}
		};

		window.ipcRenderer?.on("auth-share-token-received", handleShareCode);
		window.electronAPI?.onUpdateNotification(handleUpdateNotification);

		return () => {
			window.ipcRenderer?.off("auth-share-token-received", handleShareCode);
			window.electronAPI?.removeAllListeners("update-notification");
		};
	}, [navigate, setInitState]);

	// render main content
	const renderMainContent = () => {
		if (isFirstLaunch && !animationFinished) {
			return (
				<AnimationJson
					onComplete={() => setAnimationFinished(true)}
					animationData={animationData}
				/>
			);
		}
		return <AppRoutes />;
	};

	// render wrapper
	const renderWrapper = (children: React.ReactNode) => {
		if (HAS_STACK_KEYS) {
			return (
				<StackProvider app={stackClientApp}>
					<StackTheme>{children}</StackTheme>
					<Toaster style={{ zIndex: '999999 !important', position: "fixed" }} />
				</StackProvider>
			);
		}
		return (
			<>
				{children}
				<Toaster style={{ zIndex: "999999 !important", position: "fixed" }} />
			</>
		);
	};

	return renderWrapper(renderMainContent());
}

export default App;
