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
		<div className="fixed !z-[100] inset-0 h-full w-full flex items-center justify-center pt-10 px-2 pb-2 overflow-hidden">
			<div className="w-full h-full p-md flex flex-row justify-center gap-lg bg-surface-secondary rounded-2xl border-solid border-border-tertiary">
				<div className="flex w-1/3 h-full pt-6">
					{/* {isInstalling.toString()} */}
					<div className="flex flex-col w-full">
						<ProgressInstall
							value={
								isInstalling || installationState === "waiting-backend"
									? progress
									: 100
							}
							className="w-full mb-4"
						/>
						<div className="flex flex-col w-full items-start justify-between gap-4 mt-2">
							<div className="flex flex-row w-full items-start justify-between">
								<div className="text-text-heading text-body-sm font-medium leading-normal">
									{isInstalling
										? "System Installing ..."
										: installationState === "waiting-backend"
											? "Starting backend service..."
											: ""}
								</div>
								<div className="text-text-heading text-body-sm font-medium leading-normal">
								{Math.round(
									(isInstalling || installationState === "waiting-backend"
										? progress
										: 100) ?? 0
								)}
								%
							 </div>
							</div>
							<div className="w-full text-text-label text-body-sm font-normal leading-normal">
								{latestLog?.data}
							</div>
						</div>
					</div>
				</div>
				<div className="flex w-2/3 h-full p-md rounded-2xl bg-surface-tertiary">
					{initState === "permissions" && <Permissions />}
					{initState === "carousel" && installationState !== 'waiting-backend' && <CarouselStep />}
				</div>
			</div>
		</div>
	);
};
