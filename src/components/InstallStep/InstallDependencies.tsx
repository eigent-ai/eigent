import React, { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore";
import { ProgressInstall } from "@/components/ui/progress-install";
import { RefreshCcw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Permissions } from "@/components/InstallStep/Permissions";
import { CarouselStep } from "@/components/InstallStep/Carousel";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog";

interface InstallLog {
	type: "stdout" | "stderr";
	data: string;
	timestamp: Date;
}

export const InstallDependencies: React.FC<{
	isInstalling: boolean;
	setIsInstalling: (isInstalling: boolean) => void;
}> = ({ isInstalling, setIsInstalling }) => {
	const { initState, setInitState } = useAuthStore();
	const [logs, setLogs] = useState<InstallLog[]>([]);
	const [status, setStatus] = useState<
		"idle" | "installing" | "success" | "error"
	>("idle");
	const [showInstallScreen, setShowInstallScreen] = useState(true);
	const [progress, setProgress] = useState(20);
	
	// Backup check mechanism: periodically check installation status
	useEffect(() => {
		let intervalId: NodeJS.Timeout;
		
		// If installing, check status every 5 seconds
		if (isInstalling) {
			intervalId = setInterval(async () => {
				try {
					// Check if tool installation is complete
					const result = await window.ipcRenderer.invoke("check-tool-installed");
					if (result.success && result.isInstalled) {
						console.log("Backup check: Tool installation detected!");
						setIsInstalling(false);
						setStatus("success");
						setProgress(100);
						setTimeout(() => {
							setInitState("done");
						}, 1000);
						clearInterval(intervalId);
					}
				} catch (error) {
					console.log("Backup check error:", error);
				}
			}, 5000); // Check every 5 seconds
		}
		
		return () => {
			if (intervalId) {
				clearInterval(intervalId);
			}
		};
	}, [isInstalling, setInitState]);
	
	useEffect(() => {
		// listen to install start event
		window.electronAPI.onInstallDependenciesStart(() => {
			setIsInstalling(true);
			setStatus("installing");
			setShowInstallScreen(true);
			setLogs([]);
			console.log("start installing dependencies...");
			setProgress(20);
		});

		// listen to install log
		window.electronAPI.onInstallDependenciesLog(
			(data: { type: string; data: string }) => {
				console.log("data", data);
				const newLog: InstallLog = {
					type: data?.type as "stdout" | "stderr",
					data: data?.data,
					timestamp: new Date(),
				};
				setProgress((prev) => {
					const progress = prev + 5;
					if (progress >= 90) {
						return 90;
					}
					return progress;
				});
				console.log(`install log [${data?.type}]:`, data?.data);
				setLogs((prev) => [...prev, newLog]);
			}
		);

		// listen to install complete event
		window.electronAPI.onInstallDependenciesComplete(
			(data: { success: boolean; code?: number; error?: string }) => {
				setIsInstalling(false);
				if (data?.success) {
					setStatus("success");
					console.log("dependencies installed successfully!");
					setProgress(100);
					// Auto update initState to "done" when installation succeeds
					setTimeout(() => {
						setInitState("done");
					}, 1000); // Give user a moment to see success state
				} else {
					setStatus("error");
					console.error("dependencies installation failed:", data?.code);
					console.error("dependencies installation failed:", data?.error);
				}
			}
		);

		// after component mounted, notify main process frontend is ready
		const notifyFrontendReady = async () => {
			try {
				// check if there is frontend-ready API
				if (window.electronAPI.frontendReady) {
					await window.electronAPI.frontendReady();
				}
			} catch (error) {
				console.log(
					"frontend ready notification failed, maybe manual install mode:",
					error
				);
			}
		};

		// delay notification, ensure component is fully initialized
		setTimeout(notifyFrontendReady, 500);

		// clean up listeners
		return () => {
			window.electronAPI.removeAllListeners("install-dependencies-start");
			window.electronAPI.removeAllListeners("install-dependencies-log");
			window.electronAPI.removeAllListeners("install-dependencies-complete");
		};
	}, []);

	const handleInstall = async () => {
		try {
			setStatus("installing");
			setIsInstalling(true);
			setLogs([]);
			setShowInstallScreen(true);

			const result = await window.electronAPI.installDependencies();
			console.log("result", result);
			if (!result.success) {
				setStatus("error");
				setIsInstalling(false);
				return;
			}
			setStatus("success");
			setProgress(100);
			setIsInstalling(false);
			// Auto update initState to "done" when manual installation succeeds
			setTimeout(() => {
				setInitState("done");
			}, 1000); // Give user a moment to see success state
		} catch (error) {
			console.error("install start failed:", error);
			setStatus("error");
			setIsInstalling(false);
		}
	};

	// if not show install interface, return null
	if (initState === "done" && !isInstalling) {
		return (
			<Dialog open={status === "error"}>
				<DialogContent className="bg-white-100%">
					<DialogHeader>
						<DialogTitle>Installation Failed</DialogTitle>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={handleInstall}>Retry</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<div className="fixed !z-[100] inset-0 !bg-bg-page  bg-opacity-80 h-full w-full  flex items-center justify-center backdrop-blur-sm">
			<div className="w-[1200px] p-[40px] h-full flex flex-col justify-center gap-xl">
				<div className="relative">
					{/* {isInstalling.toString()} */}
					<div>
						<ProgressInstall
							value={isInstalling ? progress : 100}
							className="w-full"
						/>
						<div className="flex items-center gap-2 justify-between">
							<div className="text-text-label text-xs font-normal leading-tight ">
								{isInstalling ? "System Installing ..." : ""}
								<span className="pl-2">
									{logs.at(-1)?.data}
								</span>
							</div>
							<Button
								size="icon"
								variant="outline"
								className="mt-1"
								onClick={handleInstall}
							>
								<RefreshCcw className="w-4 h-4" />
							</Button>
						</div>
					</div>
				</div>
				<div>
					{initState === "permissions" && <Permissions />}
					{initState === "carousel" && <CarouselStep />}
				</div>
			</div>
			{/* error dialog */}
			<Dialog open={status === "error"}>
				<DialogContent className="bg-white-100%">
					<DialogHeader>
						<DialogTitle>Installation Failed</DialogTitle>
					</DialogHeader>
					<DialogFooter>
						<Button size="sm" onClick={handleInstall}>
							Retry
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};
