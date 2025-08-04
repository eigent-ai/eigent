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
import { Plus, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";
import IntegrationList from "./components/IntegrationList";
import { getProxyBaseURL } from "@/lib";
import { useAuthStore } from "@/store/authStore";
import { mcpMap, OAuth } from "@/lib/oauth";

export default function SettingMCP() {
	const navigate = useNavigate();
	const { checkAgentTool,email } = useAuthStore();
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
		`{ "mcpServers": { "firecrawl": { "command": "npx", "args": [ "-y", "firecrawl-mcp" ], "env": { "FIRECRAWL_API_KEY": "{{apiKey@string::Get the api key from https://firecrawl.dev/}}" } } } }`
	);
	const [remoteName, setRemoteName] = useState("");
	const [remoteUrl, setRemoteUrl] = useState("");
	const [installing, setInstalling] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<MCPUserItem | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [switchLoading, setSwitchLoading] = useState<Record<number, boolean>>(
		{}
	);
	const [oauth, setOauth] = useState<OAuth | null>(null);

	// add: integrations list
	const [integrations, setIntegrations] = useState<any[]>([]);
	const [essentialIntegrations, setEssentialIntegrations] = useState<any[]>([
		{
			key: "Search",
			name: "Search (Google and Exa)",
			env_vars: ["GOOGLE_API_KEY", "SEARCH_ENGINE_ID", "EXA_API_KEY"],
			desc: (
				<>
					Environmental variables required: GOOGLE_API_KEY, SEARCH_ENGINE_ID
					<br />
					<span
						style={{
							fontSize: "0.875rem",
							marginTop: "0.25rem",
							display: "block",
						}}
					>
						Get Google Search API:{" "}
						<a
							onClick={() => {
								window.location.href =
									"https://developers.google.com/custom-search/v1/overview";
							}}
							className="underline text-blue-500"
						>
							Google Custom Search API
						</a>
						<br />
						Get Exa API (optional):{" "}
						<a
							onClick={() => {
								window.location.href = "https://exa.ai";
							}}
							className="underline text-blue-500"
						>
							Exa.ai
						</a>
					</span>
				</>
			),
		},
	]);

	// get integrations
	useEffect(() => {
		proxyFetchGet("/api/config/info").then((res) => {
			if (res && typeof res === "object") {
				const baseURL = getProxyBaseURL();
				const list = Object.entries(res).map(([key, value]: [string, any]) => {
					let onInstall = null;
					const mcp = mcpMap[key as keyof typeof mcpMap];
					if (mcp) {
						onInstall = async () => {

							const platform = await window.electronAPI.getPlatform();
							const homeDir = await window.electronAPI.getHomeDir();

							const command =
								platform === "win32"
									? `${homeDir}\\.eigent\\bin\\bun.exe x -y mcp-remote https://mcp.notion.com/mcp`
									: `${homeDir}/.eigent/bin/bun x -y mcp-remote https://mcp.notion.com/mcp`;

							await window.electronAPI.executeCommand(command,email);
						};
					} else {
						onInstall = () =>
							(window.location.href = `${baseURL}/api/oauth/${key.toLowerCase()}/login`);
					}

					return {
						key,
						name: key,
						env_vars: value.env_vars,
						desc:
							value.env_vars && value.env_vars.length > 0
								? `Environmental variables required: ${value.env_vars.join(
										", "
								  )}`
								: "",
						onInstall,
					};
				});
				console.log("list", list);

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
				setError(err?.message || "Load failed");
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
			await proxyFetchPut(`/api/mcp/users/${showConfig.id}`, {
				mcp_name: configForm.mcp_name,
				mcp_desc: configForm.mcp_desc,
				command: configForm.command,
				args: arrayToArgsJson(configForm.argsArr),
				env: configForm.env,
			});
			setShowConfig(null);
			fetchList();
		} catch (err: any) {
			setErrorMsg(err?.message || "save failed");
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
				let data;
				try {
					data = JSON.parse(localJson);
				} catch (e) {
					alert("Invalid JSON");
					setInstalling(false);
					return;
				}
				await proxyFetchPost("/api/mcp/import/local", data);
				if (window.ipcRenderer) {
					const mcpServers = data["mcpServers"];
					Object.entries(mcpServers).forEach(async ([key, value]) => {
						await window.ipcRenderer.invoke("mcp-install", key, value);
					});
				}
			}
			setShowAdd(false);
			setLocalJson(`{
				"mcp_id": 0,
				"mcp_name": "",
				"mcp_desc": "",
				"command": "",
				"args": "",
				"env": {}
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
		<div className="w-full h-full flex flex-col">
			<div className="w-full h-10 flex flex-row justify-between mb-4 text-text-body text-lg font-bold leading-snug">
				<div className="text-lg font-bold leading-snug text-text-body">
					MCP & Tools
				</div>
				<div className="flex items-start gap-sm">
					<Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
						<Plus />
						<span>Add MCP Server</span>
					</Button>

					<Button
						variant="outline"
						size="sm"
						onClick={() => navigate("/setting/mcp_market")}
					>
						<Store />
						<span>Market</span>
					</Button>
				</div>
			</div>
			<div className="text-text-body font-bold text-base leading-snug">
				Tools
			</div>
			<IntegrationList items={essentialIntegrations} />
			<div className="text-text-body font-bold text-base leading-snug mt-4">MCP</div>
			<IntegrationList items={integrations} oauth={oauth || undefined} />

			<div className="pt-4">
				<div className="self-stretch inline-flex justify-start items-center gap-1">
					<div className="justify-center text-text-body text-base font-bold leading-snug">
						Added external servers
					</div>
				</div>
				{isLoading && (
					<div className="text-center py-8 text-gray-400">Loading...</div>
				)}
				{error && <div className="text-center py-8 text-red-500">{error}</div>}
				{!isLoading && !error && items.length === 0 && (
					<div className="text-center py-8 text-gray-400">No MCP servers</div>
				)}
				<MCPList
					items={items}
					onSetting={setShowConfig}
					onDelete={setDeleteTarget}
					onSwitch={handleSwitch}
					switchLoading={switchLoading}
				/>
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
		</div>
	);
}
