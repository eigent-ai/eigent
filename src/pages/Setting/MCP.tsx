import { useState, useEffect, useCallback } from "react";
import {
	proxyFetchGet,
	proxyFetchDelete,
	proxyFetchPost,
	proxyFetchPut,
	fetchPost,
} from "@/api/http";
import MCPList from "./components/MCPList";
import MCPConfigDialog from "./components/MCPConfigDialog";
import MCPAddDialog from "./components/MCPAddDialog";
import MCPDeleteDialog from "./components/MCPDeleteDialog";
import { parseArgsToArray, arrayToArgsJson } from "./components/utils";
import type { MCPUserItem, MCPConfigForm } from "./components/types";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Plus, Store, ChevronLeft } from "lucide-react";
import SearchInput from "@/components/SearchInput";
import { useNavigate } from "react-router-dom";
import IntegrationList from "./components/IntegrationList";
import { getProxyBaseURL } from "@/lib";
import { useAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import MCPMarket from "./MCPMarket";

import { toast } from "sonner";
import { ConfigFile } from "electron/main/utils/mcpConfig";
import { SelectItem } from "@/components/ui/select";

export default function SettingMCP() {
	const navigate = useNavigate();
    const { checkAgentTool } = useAuthStore();
    const { modelType } = useAuthStore();
	const { t } = useTranslation();
	const [items, setItems] = useState<MCPUserItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [showConfig, setShowConfig] = useState<MCPUserItem | null>(null);
	const [configForm, setConfigForm] = useState<MCPConfigForm | null>(null);
	const [saving, setSaving] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [addType, setAddType] = useState<"local" | "remote">("local");
	const [localJson, setLocalJson] = useState(
		`{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]
    }
  }
}`
	);
	const [remoteName, setRemoteName] = useState("");
	const [remoteUrl, setRemoteUrl] = useState("");
	const [installing, setInstalling] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<MCPUserItem | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [switchLoading, setSwitchLoading] = useState<Record<number, boolean>>(
		{}
	);
const [collapsed, setCollapsed] = useState(false);
const [collapsedMCP, setCollapsedMCP] = useState(false);
const [collapsedExternal, setCollapsedExternal] = useState(false);
const [showMarket, setShowMarket] = useState(false);
const [marketKeyword, setMarketKeyword] = useState("");

	// add: integrations list
	const [integrations, setIntegrations] = useState<any[]>([]);
	const [refreshKey, setRefreshKey] = useState<number>(0);
	const [essentialIntegrations, setEssentialIntegrations] = useState<any[]>([
		{
			key: "Search",
			name: "Search Engine",
			env_vars: ["GOOGLE_API_KEY", "SEARCH_ENGINE_ID", "EXA_API_KEY"],
			desc: (
				<>
					{t("setting.environmental-variables-required")}: GOOGLE_API_KEY, SEARCH_ENGINE_ID
					<br />
					<span
						style={{
							fontSize: "0.875rem",
							marginTop: "0.25rem",
							display: "block",
						}}
					>
						{t("setting.get-google-search-api")}:{" "}
						<a
							onClick={() => {
								window.location.href =
									"https://developers.google.com/custom-search/v1/overview";
							}}
							className="underline text-blue-500"
						>
							{t("setting.google-custom-search-api")}
						</a>
						<br />
						{t("setting.get-exa-api")}:{" "}
						<a
							onClick={() => {
								window.location.href = "https://exa.ai";
							}}
							className="underline text-blue-500"
						>
							{t("setting.exa-ai")}
						</a>
					</span>
				</>
			),
		},
	]);

	// default search engine and availability
	const [defaultSearchEngine, setDefaultSearchEngine] = useState<string>("");
	const [hasGoogleSearch, setHasGoogleSearch] = useState<boolean>(false);
	const [hasExaSearch, setHasExaSearch] = useState<boolean>(false);

	useEffect(() => {
		proxyFetchGet("/api/configs").then((configsRes) => {
			const configs = Array.isArray(configsRes) ? configsRes : [];
			const hasGoogleApiKey = !!configs.find(
				(item: any) => item.config_name === "GOOGLE_API_KEY"
			);
			const hasGoogleCseId = !!configs.find(
				(item: any) => item.config_name === "SEARCH_ENGINE_ID"
			);
			const hasExa = !!configs.find(
				(item: any) => item.config_name === "EXA_API_KEY"
			);
			setHasGoogleSearch(hasGoogleApiKey && hasGoogleCseId);
			setHasExaSearch(hasExa);
			const defaultEngine = configs.find(
				(item: any) =>
					item.config_group?.toLowerCase() === "search" &&
					item.config_name === "DEFAULT_SEARCH_ENGINE"
			)?.config_value;
			if (defaultEngine) setDefaultSearchEngine(defaultEngine);
		});
	}, []);

	// get integrations
	useEffect(() => {
		proxyFetchGet("/api/config/info").then((res) => {
			if (res && typeof res === "object") {
				const baseURL = getProxyBaseURL();
				const list = Object.entries(res).map(([key, value]: [string, any]) => {
					let onInstall = null;

					// Special handling for Notion MCP
					if (key.toLowerCase() === 'notion') {
						onInstall = async () => {
							try {
								const response = await fetchPost("/install/tool/notion");
								if (response.success) {
									toast.success("Notion MCP installed successfully");
									// Save to config to mark as installed
									await proxyFetchPost("/api/configs", {
										config_group: "Notion",
										config_name: "MCP_REMOTE_CONFIG_DIR",
										config_value: response.toolkit_name || "NotionMCPToolkit",
									});
									// Refresh the integrations list to show the installed state
									fetchList();
									// Force refresh IntegrationList component
									setRefreshKey(prev => prev + 1);
								} else {
									toast.error(response.error || "Failed to install Notion MCP");
								}
							} catch (error: any) {
								toast.error(error.message || "Failed to install Notion MCP");
							}
						};
					} else if (key.toLowerCase() === 'google calendar') {
						onInstall = async () => {
							try {
								const response = await fetchPost("/install/tool/google_calendar");
								if (response.success) {
									toast.success("Google Calendar installed successfully");
									// Save to config to mark as installed
									await proxyFetchPost("/api/configs", {
										config_group: "Google Calendar",
										config_name: "GOOGLE_CLIENT_ID",
										config_value: response.toolkit_name || "GoogleCalendarToolkit",
									});
									// Refresh the integrations list to show the installed state
									fetchList();
									// Force refresh IntegrationList component
									setRefreshKey(prev => prev + 1);
								} else {
									toast.error(response.error || "Failed to install Google Calendar");
								}
							} catch (error: any) {
								toast.error(error.message || "Failed to install Google Calendar");
							}
						};
                    } else {
                        onInstall = () => {
                            const url = `${baseURL}/api/oauth/${key.toLowerCase()}/login`;
                            // Open in a new window to avoid navigating the app/webview
                            window.open(url, "_blank");
                        };
                    }

					return {
						key,
						name: key,
						env_vars: value.env_vars,
						desc:
							value.env_vars && value.env_vars.length > 0
								? `${t("setting.environmental-variables-required")}: ${value.env_vars.join(
										", "
								  )}`
								: key.toLowerCase() === 'notion'
								? "Notion workspace integration for reading and managing Notion pages"
								: key.toLowerCase() === 'google calendar'
								? "Google Calendar integration for managing events and schedules"
								: "",
						onInstall,
					};
				});
				console.log("API response:", res);
				console.log("Generated list:", list);
				console.log("Essential integrations:", essentialIntegrations);

				setIntegrations(
					list.filter(
						(item) => !essentialIntegrations.find((i) => i.key === item.key)
					)
				);
			}
		});
	}, []);

	// get list
	const fetchList = useCallback(() => {
		setIsLoading(true);
		setError("");
		proxyFetchGet("/api/mcp/users")
			.then((res) => {
				if (Array.isArray(res)) {
					setItems(res);
				} else if (Array.isArray(res.items)) {
					setItems(res.items);
				} else {
					setItems([]);
				}
			})
			.catch((err) => {
				setError(err?.message || t("setting.load-failed"));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, []);

	useEffect(() => {
		fetchList();
	}, [fetchList]);

	// MCP list switch
	const handleSwitch = async (id: number, checked: boolean) => {
		setSwitchLoading((l) => ({ ...l, [id]: true }));
		try {
			await proxyFetchPut(`/api/mcp/users/${id}`, { status: checked ? 1 : 2 });
			fetchList();
		} finally {
			setSwitchLoading((l) => ({ ...l, [id]: false }));
		}
	};

	// config dialog
	useEffect(() => {
		if (showConfig) {
			setConfigForm({
				mcp_name: showConfig.mcp_name || "",
				mcp_desc: showConfig.mcp_desc || "",
				command: showConfig.command || "",
				argsArr: showConfig.args ? parseArgsToArray(showConfig.args) : [],
				env: showConfig.env ? { ...showConfig.env } : {},
			});
			setErrorMsg(null);
		} else {
			setConfigForm(null);
			setErrorMsg(null);
		}
	}, [showConfig]);

	const handleConfigSave = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!configForm || !showConfig) return;
		setSaving(true);
		setErrorMsg(null);
		try {
			const mcpData = {
				mcp_name: configForm.mcp_name,
				mcp_desc: configForm.mcp_desc,
				command: configForm.command,
				args: arrayToArgsJson(configForm.argsArr),
				env: configForm.env,
			}
			await proxyFetchPut(`/api/mcp/users/${showConfig.id}`, mcpData);

			if (window.ipcRenderer) {
				//Partial payload to empty env {}
				const payload: any = {
					description: configForm.mcp_desc,
					command: configForm.command,
					args: arrayToArgsJson(configForm.argsArr),
				};
				if (configForm.env && Object.keys(configForm.env).length > 0) {
					payload.env = configForm.env;
				}
				window.ipcRenderer.invoke("mcp-update", mcpData.mcp_name, payload);
			}

			setShowConfig(null);
			fetchList();
		} catch (err: any) {
			setErrorMsg(err?.message || t("setting.save-failed"));
		} finally {
			setSaving(false);
		}
	};
	const handleConfigClose = () => {
		setShowConfig(null);
		setConfigForm(null);
		setErrorMsg(null);
	};
	const handleConfigSwitch = async (checked: boolean) => {
		if (!showConfig) return;
		setSaving(true);
		try {
			await proxyFetchPut(`/api/mcp/users/${showConfig.id}`, {
				status: checked ? 1 : 0,
			});
			setShowConfig((prev) =>
				prev ? { ...prev, status: checked ? 1 : 0 } : prev
			);
			fetchList();
		} finally {
			setSaving(false);
		}
	};

	// add MCP dialog
	const handleInstall = async () => {
		setInstalling(true);
		try {
			if (addType === "local") {
				let data:ConfigFile;
				try {
					data = JSON.parse(localJson);

					// validate mcpServers structure
					if (!data.mcpServers || typeof data.mcpServers !== "object") {
						throw new Error("Invalid mcpServers");
					}

					// check for name conflicts with existing items
					const serverNames = Object.keys(data.mcpServers);
					const conflict = serverNames.find((name) =>
						items.some((d) => d.mcp_name === name)
					);
					if (conflict) {
						toast.error(`MCP server "${conflict}" already exists`, {
							closeButton: true,
						});
						setInstalling(false);
						return;
					}
				} catch (e) {
					toast.error(t("setting.invalid-json"), { closeButton: true });
					setInstalling(false);
					return;
				}
				let res = await proxyFetchPost("/api/mcp/import/local", data);
				if (res.detail) {
					toast.error(t("setting.invalid-json"), { closeButton: true });
					setInstalling(false);
					return;
				}
				if (window.ipcRenderer) {
					const mcpServers = data["mcpServers"];
					for (const [key, value] of Object.entries(mcpServers)) {
						await window.ipcRenderer.invoke("mcp-install", key, value);
					}
				}
			}
			setShowAdd(false);
			setLocalJson(`{
				"mcpServers": {}
			}`);
			setRemoteName("");
			setRemoteUrl("");
			fetchList();
		} finally {
			setInstalling(false);
		}
	};

	// delete dialog
	const handleDelete = async () => {
		if (!deleteTarget) return;
		setDeleting(true);
		try {
			checkAgentTool(deleteTarget.mcp_name);
			await proxyFetchDelete(`/api/mcp/users/${deleteTarget.id}`);
			// notify main process
			if (window.ipcRenderer) {
				console.log("deleteTarget", deleteTarget.mcp_key);
				await window.ipcRenderer.invoke("mcp-remove", deleteTarget.mcp_key);
			}
			setDeleteTarget(null);
			fetchList();
		} finally {
			setDeleting(false);
		}
	};

	return (
		<div className="max-w-[900px] h-auto m-auto flex flex-col px-6 pb-40">
			<div className="flex items-center justify-between py-8 border-b border-border-secondary">
				{showMarket ? (
					<div className="flex w-full items-center justify-between gap-sm">
						<Button variant="ghost" size="icon" onClick={() => setShowMarket(false)}>
							<ChevronLeft />
						</Button>
						<div className="text-body-lg font-bold text-text-body">
							{t("setting.mcp-market")}
						</div>
						<div className="flex items-center gap-2 ml-auto">
						  <div className="w-full">
								<SearchInput value={marketKeyword} onChange={(e) => setMarketKeyword(e.target.value)} />
							</div>
						</div>
					</div>
				) : (
					<div className="flex items-center justify-between w-full">
						<div className="text-body-lg font-bold text-text-body">
							{t("setting.mcp-and-tools")}
						</div>
						<div className="flex items-center gap-sm">
							<Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
								<Plus />
								<span>{t("setting.add-mcp-server")}</span>
							</Button>
							<Button variant="outline" size="sm" onClick={() => setShowMarket(true)}>
								<Store />
								<span>{t("setting.market")}</span>
							</Button>
						</div>
					</div>
				)}
			</div>
			<div className="flex flex-col gap-8">
				{showMarket ? (
					<div className="pt-2">
						<MCPMarket onBack={() => setShowMarket(false)} keyword={marketKeyword} />
					</div>
				) : (
					<>
						<div className="flex flex-col">
							{/*<div className="sticky top-40 z-10 bg-surface-primary self-stretch inline-flex justify-start items-start gap-2 py-2">
								<div className="flex-1" />
							</div>*/}
							{!collapsed && (
									<IntegrationList
											items={essentialIntegrations}
											showConfigButton={true}
											showInstallButton={false}
											showSelect
											showStatusDot={false}
											selectPlaceholder={
													modelType === "cloud"
															? "Google Search"
															: "Select default search engine"
											}
											selectContent={
													modelType === "cloud" ? (
															// Cloud: allow selecting the default option only
															<SelectItem value="google" disabled={false}>
																	Google Search
															</SelectItem>
													) : undefined
											}
											onSelectChange={async (value) => {
													try {
															setDefaultSearchEngine(value);
															await proxyFetchPost("/api/configs", {
																	config_group: "Search",
																	config_name: "DEFAULT_SEARCH_ENGINE",
																	config_value: value,
															});
													} catch (e) {}
											}}
									/>
							)}
						</div>
						<div className="flex flex-col">
							<div className="self-stretch inline-flex justify-start items-center gap-2 py-2">
								<span className="text-text-body text-body-md font-bold">MCP</span>
								<div className="flex-1" />
								<Button variant="ghost" size="md" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCollapsedMCP((c) => !c); }}>
									{collapsedMCP ? (
										<ChevronDown className="w-4 h-4" />
									) : (
										<ChevronUp className="w-4 h-4" />
									)}
								</Button>
							</div>
							{!collapsedMCP && <IntegrationList key={refreshKey} items={integrations} showConfigButton={false} showInstallButton={true} />}
						</div>
						<div className="flex flex-col">
							<div className="self-stretch inline-flex justify-start items-center gap-2 py-2">
								<div className="justify-center text-text-body text-body-md font-bold">Your own MCPs</div>
								<div className="flex-1" />
								<Button variant="ghost" size="md" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCollapsedExternal((c) => !c); }}>
									{collapsedExternal ? (
										<ChevronDown className="w-4 h-4" />
									) : (
										<ChevronUp className="w-4 h-4" />
									)}
								</Button>
							</div>
							{!collapsedExternal && (
								<>
									{isLoading && (<div className="text-center py-8 text-text-label">{t("setting.loading")}</div>)}
									{error && <div className="text-center py-8 text-red-500">{error}</div>}
									{!isLoading && !error && items.length === 0 && (<div className="text-center py-8 text-text-label">{t("setting.no-mcp-servers")}</div>)}
									{!isLoading && (
										<MCPList
											items={items}
											onSetting={setShowConfig}
											onDelete={setDeleteTarget}
											onSwitch={handleSwitch}
											switchLoading={switchLoading}
										/>
									)}
								</>
							)}
							<MCPConfigDialog
								open={!!showConfig}
								form={configForm}
								mcp={showConfig}
								onChange={setConfigForm as any}
								onSave={handleConfigSave}
								onClose={handleConfigClose}
								loading={saving}
								errorMsg={errorMsg}
								onSwitchStatus={handleConfigSwitch}
							/>
							<MCPAddDialog
								open={showAdd}
								addType={addType}
								setAddType={setAddType}
								localJson={localJson}
								setLocalJson={setLocalJson}
								remoteName={remoteName}
								setRemoteName={setRemoteName}
								remoteUrl={remoteUrl}
								setRemoteUrl={setRemoteUrl}
								installing={installing}
								onClose={() => setShowAdd(false)}
								onInstall={handleInstall}
							/>
							<MCPDeleteDialog
								open={!!deleteTarget}
								target={deleteTarget}
								onCancel={() => setDeleteTarget(null)}
								onConfirm={handleDelete}
								loading={deleting}
							/>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
