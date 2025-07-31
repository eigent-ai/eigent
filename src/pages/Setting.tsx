import { useState, useEffect } from "react";
import { useNavigate, useLocation, Outlet } from "react-router-dom";
import { Button } from "@/components/ui/button";
import useAppVersion from "@/hooks/use-app-version";
import {
	X,
	CircleCheck,
	Settings,
	Fingerprint,
	TextSelect,
	Server,
} from "lucide-react";

// Setting menu configuration
const settingMenus = [
	{
		id: "general",
		name: "General",
		icon: Settings,
		path: "/setting/general",
	},
	{
		id: "privacy",
		name: "Privacy",
		icon: Fingerprint,
		path: "/setting/privacy",
	},
	{
		id: "models",
		name: "Models",
		icon: TextSelect,
		path: "/setting/models",
	},
	{
		id: "mcp",
		name: "MCP & Tools",
		icon: Server,
		path: "/setting/mcp",
	},
];

export default function Setting() {
	const navigate = useNavigate();
	const location = useLocation();
	const version = useAppVersion();
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
			<div className="h-10 flex items-center justify-between py-2 flex-shrink-0 flex-grow-0">
				<div className="text-base font-bold leading-10 text-text-primary">
					System Settings
				</div>
				<div>
					<Button
						variant="outline"
						size="icon"
						onClick={handleClose}
					>
						<X className="w-4 h-4" />
					</Button>
				</div>
			</div>
			<div className="w-full flex-1 flex  min-h-0 pt-2">
				<div className="!w-[222px] h-full flex-shrink-0 flex-grow-0 pr-4 flex flex-col min-h-0">
					<div className="h-full mb-1">
						<nav className="space-y-1">
							<div className="text-sm text-text-label mb-4"> Essential configuration settings and system preferences.</div>
							{settingMenus.map((menu) => {
								const Icon = menu.icon;
								return (
									<button
										key={menu.id}
										onClick={() => handleTabChange(menu.id)}
										className={`w-full flex items-center gap-2 px-2 py-2 -ml-2 text-left rounded-lg transition-colors text-text-body ${activeTab === menu.id
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
					<div className="w-full h-[55px] pt-4 pb-2 flex items-center justify-center gap-sm border-[0px] border-t border-solid border-white-80% flex-shrink-0 flex-grow-0">
						<div className="text-base font-bold text-primary leading-9">
							Eigent
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
					<div className="h-full flex-1 bg-white ">
						<Outlet />
					</div>
				</div>
			</div>
		</div>
	);
}
