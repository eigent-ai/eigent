// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

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
		<div className="fixed !z-[100] inset-0  bg-opacity-80 h-full w-full  flex items-center justify-center backdrop-blur-sm">
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
