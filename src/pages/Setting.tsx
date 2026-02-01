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
import { Button } from "@/components/ui/button";
import VerticalNavigation, { type VerticalNavItem } from "@/components/Navigation";
import { useTranslation } from "react-i18next";
import useAppVersion from "@/hooks/use-app-version";
import { useAuthStore } from "@/store/authStore";
import logoBlack from '@/assets/logo/logo_black.png';
import logoWhite from '@/assets/logo/logo_white.png';
import General from "@/pages/Setting/General";
import Privacy from "@/pages/Setting/Privacy";
import Models from "@/pages/Setting/Models";
import MCP from "@/pages/Setting/MCP";
import {
	X,
	CircleCheck,
	Settings,
	Fingerprint,
	TextSelect,
	Server,
} from "lucide-react";

export default function Setting() {
	const navigate = useNavigate();
	const location = useLocation();
	const version = useAppVersion();
	const { appearance } = useAuthStore();
	const { t } = useTranslation();
	const logoSrc = appearance === 'dark' ? logoWhite : logoBlack;
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
		<div className="max-w-[900px] h-auto px-4 m-auto flex flex-col py-4">
			<div className="w-full h-auto flex px-3">
				<div className="!w-[222px] flex-shrink-0 flex-grow-0 pt-md pr-4 flex flex-col sticky top-20 self-start">
					<VerticalNavigation
						items={settingMenus.map((menu) => {
							const Icon = menu.icon;
							return {
								value: menu.id,
								label: <span className="text-sm font-bold leading-13 text-text-primary">{menu.name}</span>,
							};
						}) as VerticalNavItem[]}
						value={activeTab}
						onValueChange={handleTabChange}
						className="w-full h-full flex-1 min-h-0 gap-0"
						listClassName="w-full h-full overflow-y-auto"
						contentClassName="hidden"
					/>
					<div className="w-full mt-8 pt-4 pb-2 flex items-center justify-center border-[0px] border-t border-solid border-white-80% flex-shrink-0 flex-grow-0">
						<div className="flex items-center gap-1 leading-9">
							<img src={logoSrc} alt="version-logo" className="h-6" />
						</div>
						<div className="px-sm py-0.5 bg-bg-surface-tertiary rounded-full gap-1 flex items-center justify-center">
							<CircleCheck className="w-4 h-4 text-bg-fill-success-primary" />
							<div className="text-primary text-xs font-bold leading-17">
								{version}
							</div>
						</div>
					</div>
				</div>

				<div className="flex-1 flex flex-col w-full h-auto">
					<div className="flex flex-col gap-4 pb-md py-md">
						{activeTab === "general" && <General />}
						{activeTab === "privacy" && <Privacy />}
						{activeTab === "models" && <Models />}
					</div>
				</div>
			</div>
		</div>
	);
}
