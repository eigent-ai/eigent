import React, {
	useEffect,
	useRef,
	useState,
	useImperativeHandle,
	forwardRef,
} from "react";
import { Badge } from "@/components/ui/badge";
import { CircleAlert, Store, X } from "lucide-react";
import { proxyFetchGet, proxyFetchPost, fetchPost } from "@/api/http";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import githubIcon from "@/assets/github.svg";
import { TooltipSimple } from "../ui/tooltip";
import IntegrationList from "./IntegrationList";
import { getProxyBaseURL } from "@/lib";
import { capitalizeFirstLetter } from "@/lib";
import { useAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
interface McpItem {
	id: number;
	name: string;
	key: string;
	description: string;
	category?: { name: string };
	home_page?: string;
	install_command?: {
		env?: { [key: string]: string };
	};
	isLocal?: boolean;
}

interface ToolSelectProps {
	onShowEnvConfig?: (mcp: McpItem) => void;
	onSelectedToolsChange?: (tools: McpItem[]) => void;
	initialSelectedTools?: McpItem[];
}

const ToolSelect = forwardRef<
	{ installMcp: (id: number, env?: any, activeMcp?: any) => Promise<void> },
	ToolSelectProps
>(({ onShowEnvConfig, onSelectedToolsChange, initialSelectedTools }, ref) => {
	const { t } = useTranslation();
	// state management - remove internal selected state, use parent passed initialSelectedTools
	const [keyword, setKeyword] = useState<string>("");
	const [mcpList, setMcpList] = useState<McpItem[]>([]);
	const [customMcpList, setCustomMcpList] = useState<any[]>([]);
	const [isOpen, setIsOpen] = useState(false);
	const [installed, setInstalled] = useState<{ [id: number]: boolean }>({});
	const [installing, setInstalling] = useState<{ [id: number]: boolean }>({});
	const [installedIds, setInstalledIds] = useState<number[]>([]);
	const { email } = useAuthStore();
	// add: integration service list
	const [integrations, setIntegrations] = useState<any[]>([]);
	const fetchIntegrationsData = (keyword?: string) => {
		proxyFetchGet("/api/config/info").then((res) => {
			if (res && typeof res === "object") {
				const baseURL = getProxyBaseURL();

				const list = Object.entries(res)
					.filter(([key]) => {
						if (!keyword) return true;
						return key.toLowerCase().includes(keyword.toLowerCase());
					})
					.map(([key, value]: [string, any]) => {
						let onInstall = null;

						// Special handling for Notion MCP
						if (key.toLowerCase() === 'notion') {
							onInstall = async () => {
								try {
									const response = await fetchPost("/install/tool/notion");
									if (response.success) {
										// Save to config to mark as installed
										await proxyFetchPost("/api/configs", {
											config_group: "Notion",
											config_name: "MCP_REMOTE_CONFIG_DIR",
											config_value: response.toolkit_name || "NotionMCPToolkit",
										});
										console.log("Notion MCP installed successfully");
										// After successful installation, add to selected tools
										const notionItem = {
											id: 0, // Use 0 for integration items
											key: key,
											name: key,
											description: "Notion workspace integration for reading and managing Notion pages",
											toolkit: "notion_mcp_toolkit", // Add the toolkit name
											isLocal: true
										};
										addOption(notionItem, true);
									} else {
										console.error("Failed to install Notion MCP:", response.error || "Unknown error");
										throw new Error(response.error || "Failed to install Notion MCP");
									}
								} catch (error: any) {
									console.error("Failed to install Notion MCP:", error.message);
									throw error;
								}
							};
						} else if (key.toLowerCase() === 'google calendar') {
							onInstall = async () => {
								try {
									const response = await fetchPost("/install/tool/google_calendar");
									if (response.success) {
										// Save to config to mark as installed
										await proxyFetchPost("/api/configs", {
											config_group: "Google Calendar",
											config_name: "GOOGLE_CLIENT_ID",
											config_value: response.toolkit_name || "GoogleCalendarToolkit",
										});
										console.log("Google Calendar installed successfully");
										// After successful installation, add to selected tools
										const calendarItem = {
											id: 0, // Use 0 for integration items
											key: key,
											name: key,
											description: "Google Calendar integration for managing events and schedules",
											toolkit: "google_calendar_toolkit", // Add the toolkit name
											isLocal: true
										};
										addOption(calendarItem, true);
									} else {
										console.error("Failed to install Google Calendar:", response.error || "Unknown error");
										throw new Error(response.error || "Failed to install Google Calendar");
									}
								} catch (error: any) {
									console.error("Failed to install Google Calendar:", error.message);
									throw error;
								}
							};
						} else {
							onInstall = () =>
								(window.location.href = `${baseURL}/api/oauth/${key.toLowerCase()}/login`);
						}

						return {
							key: key,
							name: key,
							env_vars: value.env_vars,
							toolkit: value.toolkit,
							desc:
								value.env_vars && value.env_vars.length > 0
									? `${t("layout.environmental-variables-required")} ${value.env_vars.join(
											", "
									  )}`
									: key.toLowerCase() === 'notion'
									? t("layout.notion-workspace-integration")
									: key.toLowerCase() === 'google calendar'
									? t("layout.google-calendar-integration")
									: "",
							onInstall,
						};
					});
				setIntegrations(list);
			}
		});
	};

	// Refs
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// constants
	const categoryIconMap: Record<string, string> = {
		anthropic: "Anthropic",
		community: "Community",
		official: "Official",
		camel: "Camel",
	};

	const svgIcons = import.meta.glob("@/assets/mcp/*.svg", {
		eager: true,
		query: "?url",
		import: "default",
	});

	// data fetching
	const fetchData = (keyword?: string) => {
		proxyFetchGet("/api/mcps", {
			keyword: keyword || "",
			page: 1,
			size: 100,
		}).then((res) => {
			setMcpList(res.items);
		});
	};

	const fetchInstalledMcps = () => {
		proxyFetchGet("/api/mcp/users").then((res) => {
			let dataList = [];
			let ids: number[] = [];
			if (Array.isArray(res)) {
				ids = res.map((item: any) => item.mcp_id);
				dataList = res;
			} else if (Array.isArray(res.items)) {
				ids = res.items.map((item: any) => item.mcp_id);
				dataList = res.items;
			}
			setInstalledIds(ids);

			const customMcpList = dataList.filter((item: any) => item.mcp_id === 0);
			setCustomMcpList(customMcpList);
		});
	};

	// public save env/config logic
	const saveEnvAndConfig = async (
		provider: string,
		envVarKey: string,
		value: string
	) => {
		const configPayload = {
			config_group: capitalizeFirstLetter(provider),
			config_name: envVarKey,
			config_value: value,
		};
		await proxyFetchPost("/api/configs", configPayload);
		if (window.electronAPI?.envWrite) {
			await window.electronAPI.envWrite(email, { key: envVarKey, value });
		}
	};
	// MCP install related
	const installMcp = async (
		id: number,
		envValue?: { [key: string]: any },
		activeMcp?: any
	) => {
		// is exa search or google calendar
		if (activeMcp && envValue) {
			const env: { [key: string]: string } = {};
			Object.keys(envValue).map((key) => {
				env[key] = envValue[key]?.value;
			});
			activeMcp.install_command.env = env;
			Object.keys(activeMcp.install_command.env).map(async (key) => {
				await saveEnvAndConfig(
					activeMcp.key,
					key,
					activeMcp.install_command.env[key]
				);
			});
			
			// Add to selected tools after saving config
			if (activeMcp.key === "Google Calendar") {
				const calendarItem = {
					id: activeMcp.id,
					key: activeMcp.key,
					name: activeMcp.name,
					description: "Google Calendar integration for managing events and schedules",
					toolkit: "google_calendar_toolkit",
					isLocal: true
				};
				addOption(calendarItem, true);
			}
			return;
			// async function fetchInstalled() {
			// 	try {
			// 		const configsRes = await proxyFetchGet("/api/configs");
			// 		setConfigs(Array.isArray(configsRes) ? configsRes : []);
			// 	} catch (e) {
			// 		setConfigs([]);
			// 	}
			// }
			// fetchInstalled();
		}
		setInstalling((prev) => ({ ...prev, [id]: true }));
		try {
			await proxyFetchPost("/api/mcp/install?mcp_id=" + id);
			setInstalled((prev) => ({ ...prev, [id]: true }));
			const installedMcp = mcpList.find((mcp) => mcp.id === id);
			if (window.ipcRenderer && installedMcp) {
				const env: { [key: string]: string } = {};
				if (envValue) {
					Object.keys(envValue).map((key) => {
						env[key] = envValue[key]?.value;
					});
					installedMcp.install_command!.env = env;
				}

				await window.ipcRenderer.invoke(
					"mcp-install",
					installedMcp.key,
					installedMcp.install_command
				);
			}
			// after install successfully, automatically add to selected list
			if (installedMcp) {
				addOption(installedMcp);
			}
		} catch (e) {
			console.error("Failed to install MCP:", e);
		} finally {
			setInstalling((prev) => ({ ...prev, [id]: false }));
		}
	};

	// expose install method to parent component
	useImperativeHandle(ref, () => ({
		installMcp,
	}));

	const checkEnv = (id: number) => {
		const mcp = mcpList.find((mcp) => mcp.id === id);
		if (mcp && Object.keys(mcp?.install_command?.env || {}).length > 0) {
			if (onShowEnvConfig) {
				onShowEnvConfig(mcp);
			}
		} else {
			installMcp(id);
		}
	};

	// select management
	const addOption = (item: McpItem, isLocal?: boolean) => {
		setKeyword("");
		const currentSelected = initialSelectedTools || [];
		console.log(currentSelected.find((i) => i.id === item.id));
		if (isLocal) {
			if (!currentSelected.find((i) => i.key === item.key)) {
				const newSelected = [...currentSelected, { ...item, isLocal }];
				onSelectedToolsChange?.(newSelected);
			}
			return;
		}
		if (!currentSelected.find((i) => i.id === item.id)) {
			if (!isLocal) isLocal = false;
			const newSelected = [...currentSelected, { ...item, isLocal }];
			onSelectedToolsChange?.(newSelected);
		}
		
	};

	const removeOption = (item: McpItem) => {
		const currentSelected = initialSelectedTools || [];
		const newSelected = currentSelected.filter((i) => i.id !== item.id);
		onSelectedToolsChange?.(newSelected);
	};

	// tool functions
	const getCategoryIcon = (categoryName?: string) => {
		if (!categoryName) return <Store className="w-4 h-4 text-icon-primary" />;

		const iconKey = categoryIconMap[categoryName];
		const iconUrl = iconKey
			? (svgIcons[`/src/assets/mcp/${iconKey}.svg`] as string)
			: undefined;

		return iconUrl ? (
			<img src={iconUrl} alt={categoryName} className="w-4 h-4" />
		) : (
			<Store className="w-4 h-4 text-icon-primary" />
		);
	};

	const getGithubRepoName = (homePage?: string) => {
		if (!homePage || !homePage.startsWith("https://github.com/")) return null;
		const parts = homePage.split("/");
		return parts.length > 4 ? parts[4] : homePage;
	};

	const getInstallButtonText = (itemId: number) => {
		if (installedIds.includes(itemId)) return t("layout.installed");
		if (installing[itemId]) return t("layout.installing");
		if (installed[itemId]) return t("layout.installed");
		return t("layout.install");
	};

	// Effects
	useEffect(() => {
		fetchData();
		fetchIntegrationsData();
		fetchInstalledMcps();
	}, []);

	useEffect(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			fetchData(keyword);
			fetchIntegrationsData(keyword);
		}, 500);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [keyword]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, []);

	// render functions
	const renderSelectedItems = () => (
		<>
			{(initialSelectedTools || []).map((item: any) => (
				<Badge
					key={item.id + item.key + (item.isLocal + "")}
					className="h-5 bg-button-tertiery-fill-default flex items-center gap-1 w-auto flex-shrink-0 px-xs"
				>
					{item.name || item.mcp_name}
					<div className="flex items-center justify-center bg-button-secondary-fill-disabled rounded-sm">
						<X
							className="w-4 h-4 cursor-pointer text-button-secondary-icon-disabled"
							onClick={() => removeOption(item)}
						/>
					</div>
				</Badge>
			))}
		</>
	);

	const renderMcpItem = (item: McpItem) => (
		<div
			key={item.id}
			onClick={() => {
				// check if already installed
				const isAlreadyInstalled =
					installedIds.includes(item.id) || installed[item.id];

				if (isAlreadyInstalled) {
					// if already installed, add to selected list directly
					addOption(item);
					setKeyword("");
				} else {
					// if not installed, first check environment configuration, then install and add to selected list
					checkEnv(item.id);
				}
			}}
			className="cursor-pointer hover:bg-gray-100 px-3 py-2 flex justify-between"
		>
			<div className="flex items-center gap-1">
				{getCategoryIcon(item.category?.name)}
				<div className="text-sm font-bold leading-17 text-text-action overflow-hidden text-ellipsis break-words line-clamp-1">
					{item.name}
				</div>
				<TooltipSimple content={item.description}>
					<CircleAlert
							className="w-4 h-4 text-icon-primary cursor-pointer"
							onClick={(e) => e.stopPropagation()}
						/>
				</TooltipSimple>
			</div>
			<div className="flex items-center gap-1">
				{getGithubRepoName(item.home_page) && (
					<div className="flex items-center">
						<img
							src={githubIcon}
							alt="github"
							style={{
								width: 14.7,
								height: 14.7,
								marginRight: 4,
								display: "inline-block",
								verticalAlign: "middle",
							}}
						/>
						<span className="self-stretch items-center justify-center text-xs font-medium leading-3 overflow-hidden text-ellipsis break-words line-clamp-1">
							{getGithubRepoName(item.home_page)}
						</span>
					</div>
				)}
				<Button
					variant="primary"
					size="sm"
					disabled={
						installed[item.id] ||
						installing[item.id] ||
						installedIds.includes(item.id)
					}
					onClick={(e) => {
						e.stopPropagation();
						checkEnv(item.id);
					}}
				>
					{getInstallButtonText(item.id)}
				</Button>
			</div>
		</div>
	);

	const renderCustomMcpItem = (item: any) => (
		<div
			key={item.id}
			onClick={() => {
				addOption(item);
				setKeyword("");
			}}
			className="cursor-pointer hover:bg-gray-100 px-3 py-2 flex justify-between"
		>
			<div className="flex items-center gap-1">
				{/* {getCategoryIcon(item.category?.name)} */}
				<div className="text-sm font-bold leading-17 text-text-action overflow-hidden text-ellipsis break-words line-clamp-1">
					{item.mcp_name}
				</div>
				<TooltipSimple content={item.mcp_desc}>
					<CircleAlert
						className="w-4 h-4 text-icon-primary cursor-pointer"
						onClick={(e) => e.stopPropagation()}
					/>
				</TooltipSimple>
			</div>
			<div className="flex items-center gap-1">
				<Button
					className="leading-17 text-xs font-bold text-button-secondary-text-default h-6 px-sm py-xs bg-button-secondary-fill-default hover:bg-button-tertiery-text-default rounded-md shadow-sm"
					disabled={true}
				>
					{t("layout.installed")}
				</Button>
			</div>
		</div>
	);
	return (
		<div className="w-full relative" ref={containerRef}>
			<div className="flex flex-wrap gap-1.5 min-h-[40px] border rounded-lg bg-white">
				<div className="text-text-body text-sm leading-normal font-bold flex items-center gap-1">
					{t("workforce.agent-tool")}
					<TooltipSimple content={t("workforce.agent-tool-tooltip")}>
						<CircleAlert size={16} className="text-icon-primary" />
					</TooltipSimple>
				</div>
				<div
					onClick={() => {
						inputRef.current?.focus();
						setIsOpen(true);
					}}
					className="flex flex-wrap gap-1 justify-start px-[6px] py-1 min-h-[60px] max-h-[120px] overflow-y-auto w-full rounded-lg border border-solid border-input-border-default bg-input-bg-default"
				>
					{renderSelectedItems()}
					<Textarea
						variant="none"
						value={keyword}
						onChange={(e) => setKeyword(e.target.value)}
						onFocus={() => setIsOpen(true)}
						ref={inputRef}
						className="bg-transparent border-none !shadow-none text-sm leading-normal !ring-0 !ring-offset-0 w-auto !h-[20px] p-0 resize-none"
					/>
				</div>
			</div>

			{/* floating dropdown */}
			{isOpen && (
				<div className="absolute top-full left-0 right-0 z-50 mt-1 bg-dropdown-bg rounded-lg border border-solid border-input-border-default overflow-y-auto">
					<div className="max-h-[192px] overflow-y-auto">
						<IntegrationList
							onShowEnvConfig={onShowEnvConfig}
							addOption={addOption}
							items={integrations}
						/>
						{mcpList
							.filter(
								(opt) =>
									!(initialSelectedTools || []).find((i) => i.id === opt.id)
							)
							.map(renderMcpItem)}
						{customMcpList
							.filter(
								(opt) =>
									!(initialSelectedTools || []).find((i) => i.id === opt.id)
							)
							.map(renderCustomMcpItem)}
					</div>
				</div>
			)}
		</div>
	);
});

export default ToolSelect;
