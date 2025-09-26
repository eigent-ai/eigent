import { useState, useEffect } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import useAppVersion from "@/hooks/use-app-version";
import vsersionLogo from "@/assets/version-logo.png";
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
		{
			id: "mcp",
			name: t("setting.mcp"),
			icon: Server,
			path: "/setting/mcp",
		},
	];
	// Get currently selected sub-page from URL path
	const getCurrentTab = () => {
		const path = location.pathname;
		const tabFromUrl = path.split("/setting/")[1] || "general";
		// if mcp_market, return mcp
		if (tabFromUrl === "mcp_market") {
			return "mcp";
		}
		return settingMenus.find((menu) => menu.id === tabFromUrl)?.id || "general";
	};

	const [activeTab, setActiveTab] = useState(getCurrentTab);

	// Listen to path changes, update activeTab
	useEffect(() => {
		const newTab = getCurrentTab();
		if (newTab !== activeTab) {
			setActiveTab(newTab);
		}
	}, [location.pathname]);

	// Switch tabs
	const handleTabChange = (tabId: string) => {
		const targetMenu = settingMenus.find((menu) => menu.id === tabId);
		if (targetMenu) {
			navigate(targetMenu.path);
		}
	};

	// Close settings page
	const handleClose = () => {
		navigate("/");
	};

	return (
		<div className="max-w-[900px] h-full px-4 m-auto flex flex-col">
			<div className="h-14 flex items-center justify-between pb-4 border-[0px] border-b border-solid border-b-white-80% flex-shrink-0 flex-grow-0">
				<div className="text-2xl font-bold leading-4 text-primary">
					{t("setting.settings")}
				</div>
				<div>
					<Button variant="ghost" size="icon" onClick={handleClose}>
						<X className="!w-6 !h-6" />
					</Button>
				</div>
			</div>
			<div className="w-full flex-1 flex  min-h-0">
				<div className="!w-[222px] h-full flex-shrink-0 flex-grow-0  pt-md pr-4 flex flex-col min-h-0">
					<div className="h-full overflow-y-auto scrollbar mb-1">
						<nav className="space-y-1">
							{settingMenus.map((menu) => {
								const Icon = menu.icon;
								return (
									<button
										key={menu.id}
										onClick={() => handleTabChange(menu.id)}
										className={`w-full flex items-center gap-2 px-2 py-2 text-left rounded-lg transition-colors text-text-body ${
											activeTab === menu.id
												? "bg-white-100% "
												: "bg-transparent hover:bg-bg-fill-transparent"
										}`}
									>
										<Icon className="w-4 h-4 text-icon-primary" />
										<span className="text-sm font-bold leading-13">
											{menu.name}
										</span>
									</button>
								);
							})}
						</nav>
					</div>
					<div className="w-full h-[55px] pt-4 pb-2 flex items-center justify-center border-[0px] border-t border-solid border-white-80% flex-shrink-0 flex-grow-0">
						<div className="flex items-center gap-1 leading-9">
							<img src={vsersionLogo} alt="version-logo" className="h-6" />
						</div>
						<div className="px-sm py-0.5 bg-bg-surface-tertiary rounded-full gap-1 flex items-center justify-center">
							<CircleCheck className="w-4 h-4 text-bg-fill-success-primary" />
							<div className="text-primary text-xs font-bold leading-17">
								{version}
							</div>
						</div>
					</div>
				</div>

				<div className="flex-1 flex flex-col min-h-0">
					<div className="max-h-[calc(100vh-120px)] flex-1 overflow-y-auto scrollbar py-md bg-white rounded-lg border border-gray-200">
						<Outlet />
					</div>
				</div>
			</div>
		</div>
	);
}
