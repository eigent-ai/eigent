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

import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import VerticalNavigation, { type VerticalNavItem } from "@/components/Navigation";
import { useTranslation } from "react-i18next";
import useAppVersion from "@/hooks/use-app-version";
import vsersionLogo from "@/assets/version-logo.png";
import General from "@/pages/Setting/General";
import Privacy from "@/pages/Setting/Privacy";
import Models from "@/pages/Setting/Models";
import MCP from "@/pages/Setting/MCP";
import {
	X,
	Settings,
	Fingerprint,
	TextSelect,
	TagIcon,
} from "lucide-react";

export default function Setting() {
	const navigate = useNavigate();
	const location = useLocation();
	const version = useAppVersion();
	const { t } = useTranslation();
	// Setting menu configuration
	const settingMenus = [
		{
			id: "general",
			name: t("setting.general"),
			icon: Settings,
			path: "/setting/general",
		},
		{
			id: "privacy",
			name: t("setting.privacy"),
			icon: Fingerprint,
			path: "/setting/privacy",
		},
		{
			id: "models",
			name: t("setting.models"),
			icon: TextSelect,
			path: "/setting/models",
		},
	];
	// Initialize tab from URL once, then manage locally without routing
	const getCurrentTab = () => {
		const path = location.pathname;
		const tabFromUrl = path.split("/setting/")[1] || "general";
		return settingMenus.find((menu) => menu.id === tabFromUrl)?.id || "general";
	};

	const [activeTab, setActiveTab] = useState(getCurrentTab);

	// Switch tabs locally (no navigation)
	const handleTabChange = (tabId: string) => {
		setActiveTab(tabId);
	};

	// Close settings page
	const handleClose = () => {
		navigate("/");
	};

	return (
		<div className="max-w-[940px] h-auto m-auto flex flex-col">
			<div className="w-full h-auto flex px-6">
					<div className="w-40 h-full flex-shrink-0 flex-grow-0 pt-8 pr-6 flex flex-col justify-between sticky top-20 self-start">
						<VerticalNavigation
							items={settingMenus.map((menu) => {
								return {
									value: menu.id,
									label: <span className="text-body-sm font-bold">{menu.name}</span>,
								};
							}) as VerticalNavItem[]}
							value={activeTab}
							onValueChange={handleTabChange}
							className="w-full h-full flex-1 min-h-0 gap-0"
							listClassName="w-full h-full overflow-y-auto"
							contentClassName="hidden"
						/>
						<div className="w-full mt-4 py-4 flex flex-col gap-4 items-center justify-center flex-shrink-0 flex-grow-0 border-t-[0.5px] border-b-0 border-x-0 border-solid border-border-secondary">
					  	<button 
								onClick={() => window.open("https://github.com/eigent-ai/eigent", "_blank", "noopener,noreferrer")}
								className="py-1.5 px-6 w-full bg-surface-tertiary rounded-lg gap-2 flex flex-row items-center justify-center cursor-pointer hover:opacity-60 transition-opacity duration-200"
							>
								<TagIcon className="w-4 h-4 text-text-success" />
								<div className="text-text-body text-label-sm font-semibold">
									{version}
								</div>
							</button>
						  <button 
								onClick={() => window.open("https://www.eigent.ai", "_blank", "noopener,noreferrer")}
								className="flex items-center cursor-pointer bg-transparent hover:opacity-60 transition-opacity duration-200"
							>
								<img src={vsersionLogo} alt="version-logo" className="h-5" />
							</button>
					</div>
				</div>

				<div className="flex-1 flex flex-col w-full h-auto">
					<div className="flex flex-col gap-4">
						{activeTab === "general" && <General />}
						{activeTab === "privacy" && <Privacy />}
						{activeTab === "models" && <Models />}
					</div>
				</div>
			</div>
		</div>
	);
}
