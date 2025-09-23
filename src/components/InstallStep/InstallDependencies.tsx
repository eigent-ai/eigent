import React from "react";
import { useAuthStore } from "@/store/authStore";
import { ProgressInstall } from "@/components/ui/progress-install";
import { FileDown, RefreshCcw } from "lucide-react";
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
import { useTranslation } from "react-i18next";
import { useInstallationUI } from "@/store/installationStore";
import { TooltipSimple } from "../ui/tooltip";

export const InstallDependencies: React.FC = () => {
	const { initState } = useAuthStore();
	const {t} = useTranslation();
	
	const {
		progress,
		latestLog,
		error,
		isInstalling,
		retryInstallation,
		exportLog,
	} = useInstallationUI();

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
								<span className="pl-2">{latestLog?.data}</span>
							</div>
							<TooltipSimple content={`Cannot retry because state is ${error}`} hidden={true}>
								<Button
									size="icon"
									variant="outline"
									className="mt-1"
									onClick={retryInstallation}
								>
									<RefreshCcw className="w-4 h-4" />
								</Button>
							</TooltipSimple>
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
						<DialogTitle>{t("layout.installation-failed")}</DialogTitle>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={exportLog}
							variant="outline"
							size="xs"
							className="mr-2 no-drag leading-tight"
						>
							<FileDown className="w-4 h-4" />
							{t("layout.report-bug")}
						</Button>
						<Button size="sm" onClick={retryInstallation}>
							{t("layout.retry")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};
