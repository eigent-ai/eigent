import React from "react";
import { useAuthStore } from "@/store/authStore";
import { ProgressInstall } from "@/components/ui/progress-install";
import { Permissions } from "@/components/InstallStep/Permissions";
import { CarouselStep } from "@/components/InstallStep/Carousel";
import { useInstallationUI } from "@/store/installationStore";

export const InstallDependencies: React.FC = () => {
	const { initState } = useAuthStore();

	const {
		progress,
		latestLog,
		isInstalling,
		installationState,
	} = useInstallationUI();

	return (
		<div className="fixed !z-[100] inset-0 !bg-bg-page  bg-opacity-80 h-full w-full  flex items-center justify-center backdrop-blur-sm">
			<div className="w-[1200px] p-[40px] h-full flex flex-col justify-center gap-xl">
				<div className="relative">
					{/* {isInstalling.toString()} */}
					<div>
						<ProgressInstall
							value={isInstalling || installationState === 'waiting-backend' ? progress : 100}
							className="w-full"
						/>
						<div className="flex items-center gap-2 justify-between">
							<div className="text-text-label text-xs font-normal leading-tight ">
								{isInstalling ? "System Installing ..." : installationState === 'waiting-backend' ? "Starting backend service..." : ""}
								<span className="pl-2">{latestLog?.data}</span>
							</div>
						</div>
					</div>
				</div>
				<div>
					{initState === "permissions" && <Permissions />}
					{initState === "carousel" && installationState !== 'waiting-backend' && <CarouselStep />}
				</div>
			</div>
		</div>
	);
};
