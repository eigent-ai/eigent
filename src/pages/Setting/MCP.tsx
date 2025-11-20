import { useState, useEffect, useCallback } from "react";
import {
	proxyFetchGet,
	proxyFetchDelete,
	proxyFetchPost,
	proxyFetchPut,
	fetchPost,
	fetchGet,
} from "@/api/http";
import MCPList from "./components/MCPList";
import MCPConfigDialog from "./components/MCPConfigDialog";
import MCPAddDialog from "./components/MCPAddDialog";
import MCPDeleteDialog from "./components/MCPDeleteDialog";
import SearchEngineConfigDialog from "./components/SearchEngineConfigDialog";
import { parseArgsToArray, arrayToArgsJson } from "./components/utils";
import type { MCPUserItem, MCPConfigForm } from "./components/types";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Plus, Store, ChevronLeft } from "lucide-react";
import SearchInput from "@/components/SearchInput";
import { useNavigate } from "react-router-dom";
import IntegrationList from "@/components/IntegrationList";
import { getProxyBaseURL } from "@/lib";
import { useAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import MCPMarket from "./MCPMarket";

import { toast } from "sonner";
import { ConfigFile } from "electron/main/utils/mcpConfig";
import { SelectItem, SelectItemWithButton } from "@/components/ui/select";
import { Tag as TagComponent } from "@/components/ui/tag";

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
	const [collapsedMCP, setCollapsedMCP] = useState(false);
	const [collapsedExternal, setCollapsedExternal] = useState(false);
	const [showMarket, setShowMarket] = useState(false);
	const [marketKeyword, setMarketKeyword] = useState("");
	const [showSearchEngineConfig, setShowSearchEngineConfig] = useState(false);

	// add: integrations list
	const [integrations, setIntegrations] = useState<any[]>([]);
	const [refreshKey, setRefreshKey] = useState<number>(0);
	const [essentialIntegrations, setEssentialIntegrations] = useState<any[]>([
		{
			key: "Search",
			name: "Search Engine",
			env_vars: ["GOOGLE_API_KEY", "SEARCH_ENGINE_ID"],
			desc: (
				<>
					{t("setting.environmental-variables-required")}: GOOGLE_API_KEY,
					SEARCH_ENGINE_ID
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
					</span>
				</>
			),
		},
	]);

	// default search engine and availability
	const [defaultSearchEngine, setDefaultSearchEngine] =
		useState<string>("google");
	const [hasGoogleSearch, setHasGoogleSearch] = useState<boolean>(false);
	const [configs, setConfigs] = useState<any[]>([]);

	useEffect(() => {
		proxyFetchGet("/api/configs").then((configsRes) => {
			const configs = Array.isArray(configsRes) ? configsRes : [];
			setConfigs(configs);
			const hasGoogleApiKey = !!configs.find(
				(item: any) => item.config_name === "GOOGLE_API_KEY"
			);
			const hasGoogleCseId = !!configs.find(
				(item: any) => item.config_name === "SEARCH_ENGINE_ID"
			);
			setHasGoogleSearch(hasGoogleApiKey && hasGoogleCseId);
			const defaultEngine = configs.find(
				(item: any) =>
					item.config_group?.toLowerCase() === "search" &&
					item.config_name === "DEFAULT_SEARCH_ENGINE"
			)?.config_value;
			if (defaultEngine) setDefaultSearchEngine(defaultEngine);
			else setDefaultSearchEngine("google"); // Default to Google
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
					if (key.toLowerCase() === "notion") {
						onInstall = async () => {
							try {
								const response = await fetchPost("/install/tool/notion");
								if (response.success) {
									// Check if there's a warning (connection failed but installation marked as complete)
									if (response.warning) {
										toast.warning(response.warning, { duration: 5000 });
									} else {
										toast.success(
											t("setting.notion-mcp-installed-successfully")
										);
									}
									// Save to config to mark as installed
									await proxyFetchPost("/api/configs", {
										config_group: "Notion",
										config_name: "MCP_REMOTE_CONFIG_DIR",
										config_value: response.toolkit_name || "NotionMCPToolkit",
									});
									// Refresh the integrations list to show the installed state
									fetchList();
									// Force refresh IntegrationList component
									setRefreshKey((prev) => prev + 1);
								} else {
									toast.error(
										response.error || t("setting.failed-to-install-notion-mcp")
									);
								}
							} catch (error: any) {
								toast.error(
									error.message || t("setting.failed-to-install-notion-mcp")
								);
							}
						};
					} else if (key.toLowerCase() === "google calendar") {
						onInstall = async () => {
							try {
								const response = await fetchPost(
									"/install/tool/google_calendar"
								);
								if (response.success) {
									// Check if there's a warning (connection failed but installation marked as complete)
									if (response.warning) {
										toast.warning(response.warning, { duration: 5000 });
									} else {
										toast.success(
											t("setting.google-calendar-installed-successfully")
										);
									}
									try {
										// Ensure we persist a marker config to indicate installation
										const existingConfigs = await proxyFetchGet("/api/configs");
										const existing = Array.isArray(existingConfigs)
											? existingConfigs.find(
													(c: any) =>
														c.config_group?.toLowerCase() ===
															"google calendar" &&
														c.config_name === "GOOGLE_REFRESH_TOKEN"
											  )
											: null;

										const configPayload = {
											config_group: "Google Calendar",
											config_name: "GOOGLE_REFRESH_TOKEN",
											config_value: "exists",
										};

										if (existing) {
											await proxyFetchPut(
												`/api/configs/${existing.id}`,
												configPayload
											);
										} else {
											await proxyFetchPost("/api/configs", configPayload);
										}
									} catch (configError) {
										console.warn(
											"Failed to persist Google Calendar config",
											configError
										);
									}
									// Refresh the integrations list to show the installed state
									fetchList();
									// Force refresh IntegrationList component
									setRefreshKey((prev) => prev + 1);
								} else if (response.status === "authorizing") {
									// Authorization in progress - start polling for completion
									toast.info(
										t("setting.please-complete-authorization-in-browser")
									);

									// Poll for authorization completion via oauth status endpoint
									const pollInterval = setInterval(async () => {
										try {
											const statusResp = await fetchGet(
												"/oauth/status/google_calendar"
											);
											if (statusResp?.status === "success") {
												clearInterval(pollInterval);
												// Now that auth succeeded, run install again to initialize toolkit
												const finalize = await fetchPost(
													"/install/tool/google_calendar"
												);
												if (finalize?.success) {
													const configs = await proxyFetchGet("/api/configs");
													const existing = Array.isArray(configs)
														? configs.find(
																(c: any) =>
																	c.config_group?.toLowerCase() ===
																		"google calendar" &&
																	c.config_name === "GOOGLE_REFRESH_TOKEN"
														  )
														: null;

													const payload = {
														config_group: "Google Calendar",
														config_name: "GOOGLE_REFRESH_TOKEN",
														config_value: "exists",
													};

													if (existing) {
														await proxyFetchPut(
															`/api/configs/${existing.id}`,
															payload
														);
													} else {
														await proxyFetchPost("/api/configs", payload);
													}

													toast.success(
														t("setting.google-calendar-installed-successfully")
													);
													fetchList();
													setRefreshKey((prev) => prev + 1);
												}
											} else if (
												statusResp?.status === "failed" ||
												statusResp?.status === "cancelled"
											) {
												clearInterval(pollInterval);
												const msg =
													statusResp?.error ||
													(statusResp?.status === "cancelled"
														? t("setting.authorization-cancelled")
														: t("setting.authorization-failed"));
												toast.error(msg);
											}
											// if still authorizing, continue polling
										} catch (err) {
											console.error("Polling oauth status failed", err);
										}
									}, 2000);

									// Safety timeout
									setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
								} else {
									toast.error(
										response.error ||
											response.message ||
											t("setting.failed-to-install-google-calendar")
									);
								}
							} catch (error: any) {
								toast.error(
									error.message ||
										t("setting.failed-to-install-google-calendar")
								);
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
								? `${t(
										"setting.environmental-variables-required"
								  )}: ${value.env_vars.join(", ")}`
								: key.toLowerCase() === "notion"
								? t("setting.notion-workspace-integration")
								: key.toLowerCase() === "google calendar"
								? t("setting.google-calendar-integration")
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
			};
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
				let data: ConfigFile;
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
						toast.error(
							t("setting.mcp-server-already-exists", { name: conflict }),
							{
								closeButton: true,
							}
						);
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

	// Generate search engine selection content
	const generateSearchEngineSelectContent = () => {
		console.log("Generating search engine select content, configs:", configs);
		const isCustom = modelType === "custom";

		// Google Search - requires API key and Search Engine ID in custom mode
		const hasGoogleApiKey = configs.some(
			(c: any) => c.config_name === "GOOGLE_API_KEY"
		);
		const hasGoogleCseId = configs.some(
			(c: any) => c.config_name === "SEARCH_ENGINE_ID"
		);
		const hasGoogle = hasGoogleApiKey && hasGoogleCseId;

		console.log("Search engine status:", { hasGoogle, isCustom });

		return (
			<>
				{/* Custom mode: require API key configuration */}
				{isCustom ? (
					<SelectItemWithButton
						value="google"
						label={
							<span>
								<span>Google Search </span>
								<TagComponent asChild>
									<span>{t("setting.recommended")}</span>
								</TagComponent>
							</span>
						}
						enabled={hasGoogle}
						buttonText={t("setting.setting")}
						onButtonClick={() => setShowSearchEngineConfig(true)}
					/>
				) : (
					<>
						{/* Cloud or Local mode: Google enabled by default */}
						<SelectItem value="google">
							<span>Google Search </span>
							<TagComponent asChild>
								<span>{t("setting.recommended")}</span>
							</TagComponent>
						</SelectItem>
					</>
				)}
			</>
		);
	};

	return (
		<div className="flex-1 h-auto m-auto">
			{/* Header Section */}
			<div className="flex w-full border-solid border-t-0 border-x-0 border-border-disabled">
				<div className="flex px-6 pt-8 pb-4 max-w-[900px] mx-auto w-full items-center justify-between">
					<div className="flex w-full items-center justify-between">
						{showMarket ? (
							<div className="flex w-full items-center justify-between gap-sm">
								<Button
									variant="ghost"
									size="icon"
									onClick={() => setShowMarket(false)}
								>
									<ChevronLeft />
								</Button>
								<div className="text-heading-sm font-bold text-text-heading">
									{t("setting.mcp-market")}
								</div>
								<div className="flex items-center gap-2 ml-auto">
									<div className="w-full">
										<SearchInput
											value={marketKeyword}
											onChange={(e) => setMarketKeyword(e.target.value)}
										/>
									</div>
								</div>
							</div>
						) : (
							<div className="flex w-full items-center justify-between">
								<div className="text-heading-sm font-bold text-text-heading">
									{t("setting.mcp-and-tools")}
								</div>
								<div className="flex items-center gap-sm">
									<Button
										variant="outline"
										size="sm"
										onClick={() => setShowAdd(true)}
									>
										<Plus />
										<span>{t("setting.add-mcp-server")}</span>
									</Button>
									{/* <Button variant="outline" size="sm" onClick={() => setShowMarket(true)}>
										<Store />
										<span>{t("setting.market")}</span>
									</Button> */}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Content Section */}
			<div className="flex w-full">
				<div className="flex px-6 py-8 max-w-[900px] min-h-[calc(100vh-86px)] mx-auto w-full items-start justify-center">
					<div className="flex flex-col w-full gap-8">
						{showMarket ? (
							<div className="pt-2">
								<MCPMarket
									onBack={() => setShowMarket(false)}
									keyword={marketKeyword}
								/>
							</div>
						) : (
							<>
								<div className="flex-1 w-full">
									<IntegrationList
										variant="manage"
										items={essentialIntegrations}
										showConfigButton={true}
										showInstallButton={false}
										showSelect
										showStatusDot={false}
										selectPlaceholder="Google Search"
										selectContent={generateSearchEngineSelectContent()}
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
										onConfigClick={(item) => {
											if (item.key === "Search") {
												setShowSearchEngineConfig(true);
											}
										}}
									/>
								</div>
								<div className="flex flex-col">
									<div className="self-stretch inline-flex justify-start items-center gap-2 py-2">
										<span className="text-text-body text-body-md font-bold">
											{t("setting.mcp")}
										</span>
										<div className="flex-1" />
										<Button
											variant="ghost"
											size="md"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												setCollapsedMCP((c) => !c);
											}}
										>
											{collapsedMCP ? (
												<ChevronDown className="w-4 h-4" />
											) : (
												<ChevronUp className="w-4 h-4" />
											)}
										</Button>
									</div>
									{!collapsedMCP && (
										<IntegrationList
											key={refreshKey}
											variant="manage"
											items={integrations}
											showConfigButton={false}
											showInstallButton={true}
										/>
									)}
								</div>
								<div className="flex flex-col">
									<div className="self-stretch inline-flex justify-start items-center gap-2 py-2">
										<div className="justify-center text-text-body text-body-md font-bold">
											{t("setting.your-own-mcps")}
										</div>
										<div className="flex-1" />
										<Button
											variant="ghost"
											size="md"
											onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												setCollapsedExternal((c) => !c);
											}}
										>
											{collapsedExternal ? (
												<ChevronDown className="w-4 h-4" />
											) : (
												<ChevronUp className="w-4 h-4" />
											)}
										</Button>
									</div>
									{!collapsedExternal && (
										<>
											{isLoading && (
												<div className="text-center py-8 text-text-label">
													{t("setting.loading")}
												</div>
											)}
											{error && (
												<div className="text-center py-8 text-red-500">
													{error}
												</div>
											)}
											{!isLoading && !error && items.length === 0 && (
												<div className="text-center py-8 text-text-label">
													{t("setting.no-mcp-servers")}
												</div>
											)}
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
								</div>
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
								<SearchEngineConfigDialog
									open={showSearchEngineConfig}
									onClose={() => setShowSearchEngineConfig(false)}
								/>
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
