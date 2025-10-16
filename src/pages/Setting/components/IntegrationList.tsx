import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { CircleAlert } from "lucide-react";
import {
	proxyFetchGet,
	proxyFetchPost,
	proxyFetchPut,
	proxyFetchDelete,
} from "@/api/http";

import React, { useState, useCallback, useEffect, useRef } from "react";
import ellipseIcon from "@/assets/mcp/Ellipse-25.svg";
import { capitalizeFirstLetter } from "@/lib";
import { MCPEnvDialog } from "./MCPEnvDialog";
import { useAuthStore } from "@/store/authStore";
import { OAuth } from "@/lib/oauth";
import { useTranslation } from "react-i18next";
interface IntegrationItem {
	key: string;
	name: string;
	desc: string | React.ReactNode;
	env_vars: string[];
	onInstall: () => void | Promise<void>;
}


interface IntegrationListProps {
	items: IntegrationItem[];
	installedKeys?: string[];
	oauth?: OAuth;
}

export default function IntegrationList({
	items,
}: IntegrationListProps) {
	const { t } = useTranslation();
	const [showEnvConfig, setShowEnvConfig] = useState(false);
	const [activeMcp, setActiveMcp] = useState<any | null>(null);
	const { email, checkAgentTool } = useAuthStore();
	const [callBackUrl, setCallBackUrl] = useState<string | null>(null);

	// local installed status
	const [installed, setInstalled] = useState<{ [key: string]: boolean }>({});
	// configs cache
	const [configs, setConfigs] = useState<any[]>([]);
	// 1. add useRef lock
	const isLockedRef = useRef(false);
	// 2. add ref to cache oauth event
	const pendingOauthEventRef = useRef<{
		provider: string;
		code: string;
	} | null>(null);

	async function fetchInstalled(ignore: boolean = false) {
		try {
			const configsRes = await proxyFetchGet("/api/configs");
			if (!ignore) {
				setConfigs(Array.isArray(configsRes) ? configsRes : []);
			}
		} catch (e) {
			if (!ignore) setConfigs([]);
		}
	}
	// 3. fetch configs when mounted
	useEffect(() => {
		let ignore = false;

		fetchInstalled();
		return () => {
			ignore = true;
		};
	}, []);

	// items or configs change, recalculate installed
	useEffect(() => {
		// construct installed map
		const map: { [key: string]: boolean } = {};
		items.forEach((item) => {
			if (item.key === "Google Calendar") {
				// Only mark installed after refresh token exists
				const hasRefreshToken = configs.some(
					(c: any) =>
						c.config_group?.toLowerCase() === "google calendar" &&
						c.config_name === "GOOGLE_REFRESH_TOKEN" &&
						c.config_value && String(c.config_value).length > 0
				);
				map[item.key] = hasRefreshToken;
			} else {
				// For other integrations, use presence of any config in the group
				const hasConfig = configs.some(
					(c: any) => c.config_group?.toLowerCase() === item.key.toLowerCase()
				);
				map[item.key] = hasConfig;
			}
		});
		setInstalled(map);
	}, [items, configs]);

	// public save env/config logic
	const saveEnvAndConfig = async (
		provider: string,
		envVarKey: string,
		value: string
	) => {
		const configPayload = {
			// Use exact group name, do not transform case to avoid whitelist mismatch
			config_group: provider,
			config_name: envVarKey,
			config_value: value,
		};
		
		// Fetch latest configs to avoid stale state when deciding POST/PUT
		let latestConfigs: any[] = Array.isArray(configs) ? configs : [];
		try {
			const fresh = await proxyFetchGet("/api/configs");
			if (Array.isArray(fresh)) latestConfigs = fresh;
		} catch {}
		
		// Check if config already exists (by name, regardless of group - backend uniqueness is by name)
		let existingConfig = latestConfigs.find((c: any) => c.config_name === envVarKey);
		
		if (existingConfig) {
			await proxyFetchPut(`/api/configs/${existingConfig.id}`, configPayload);
		} else {
			const res = await proxyFetchPost("/api/configs", configPayload);
			// If backend says it already exists (race), switch to PUT
			if (res && res.detail && (res.detail as string).toLowerCase().includes("already exists")) {
				try {
					const again = await proxyFetchGet("/api/configs");
					const found = Array.isArray(again) ? again.find((c: any) => c.config_name === envVarKey) : null;
					if (found) {
						await proxyFetchPut(`/api/configs/${found.id}`, configPayload);
					}
				} catch {}
			}
		}
		
		if (window.electronAPI?.envWrite) {
			await window.electronAPI.envWrite(email, { key: envVarKey, value });
		}
	};

	// wrap with useCallback, ensure processOauth can get the latest items and oauth when items change
	const processOauth = useCallback(
		async (data: { provider: string; code: string }) => {
			if (isLockedRef.current) return;
			console.log("items", items);
			if (!items || items.length === 0) {
				// items are not ready, cache event, wait for items to have value
				pendingOauthEventRef.current = data;
				console.warn("items are empty, cache oauth event", data);
				return;
			}
			const provider = data.provider.toLowerCase();
			isLockedRef.current = true;
		
			try {
				const tokenResult = await proxyFetchPost(
					`/api/oauth/${provider}/token`,
					{ code: data.code }
				);
				setInstalled((prev) => ({
					...prev,
					[capitalizeFirstLetter(provider)]: true,
				}));
				const currentItem = items.find(
					(item) => item.key.toLowerCase() === provider
				);
				console.log("provider", provider);
				console.log("items", items);
				if (provider === "slack") {
					if (
						tokenResult.access_token &&
						currentItem &&
						currentItem.env_vars &&
						currentItem.env_vars.length > 0
					) {
						const envVarKey = currentItem.env_vars[0];
						await saveEnvAndConfig(
							provider,
							envVarKey,
							tokenResult.access_token
						);
						fetchInstalled();
						console.log(
							"Slack authorization successful and configuration saved!"
						);
					} else {
						console.log(
							"Slack authorization successful, but access_token not found or env configuration not found"
						);
					}
				} else {
					// other provider authorization successful, can be extended
				}
			} catch (e: any) {
				console.log(`${data.provider} authorization failed: ${e.message || e}`);
			} finally {
				isLockedRef.current = false;
			}
		},
		[items, callBackUrl] // add oauth to dependencies
	);

	// listen to main process oauth authorization callback, automatically mark as installed and get token
	useEffect(() => {
		const handler = (_event: any, data: { provider: string; code: string }) => {
			if (!data.provider || !data.code) return;
			processOauth(data);
		};
		window.ipcRenderer?.on("oauth-authorized", handler);
		return () => {
			window.ipcRenderer?.off("oauth-authorized", handler);
		};
	}, [processOauth]);

	// listen to oauth callback URL notification
	useEffect(() => {
		const handler = (_event: any, data: { url: string; provider: string }) => {
			console.log("Received OAuth callback URL:", data);

			if (data.url && data.provider) {
				console.log(`${data.provider} OAuth callback URL: ${data.url}`);
				setCallBackUrl(data.url);
				// Add user prompt or other processing logic here
			}
		};
		window.ipcRenderer?.on("oauth-callback-url", handler);
		return () => {
			window.ipcRenderer?.off("oauth-callback-url", handler);
		};
	}, []);

	// as long as oauth changes and there is a cached event, process it
	useEffect(() => {
		if (pendingOauthEventRef.current) {
			processOauth(pendingOauthEventRef.current);
			pendingOauthEventRef.current = null;
		}
	}, [processOauth]);

	// install/uninstall
	const handleInstall = useCallback(
		async (item: IntegrationItem) => {
			console.log(item);
			if (item.key === "Search") {
				let mcp = {
					name: "Search",
					key: "Search",
					install_command: {
						env: {} as any,
					},
					id: 13,
				};
				item.env_vars.map((key) => {
					mcp.install_command.env[key] = "";
				});
				setActiveMcp(mcp);
				setShowEnvConfig(true);
				return;
			}

	if (item.key === "Google Calendar") {
		let mcp = {
			name: "Google Calendar",
			key: "Google Calendar",
			install_command: {
				env: {} as any,
			},
			id: 14,
		};
		item.env_vars.map((key) => {
			mcp.install_command.env[key] = "";
		});
		setActiveMcp(mcp);
		setShowEnvConfig(true);
		return;
	}

	if (installed[item.key]) return;
	await item.onInstall();
		},
		[installed]
	);

	const onConnect = async (mcp: any) => {
		// Refresh configs first to get latest state
		await fetchInstalled();
		
		// Save all environment variables
		await Promise.all(
			Object.keys(mcp.install_command.env).map((key) => {
				return saveEnvAndConfig(mcp.key, key, mcp.install_command.env[key]);
			})
		);

		// After saving env vars, trigger installation/instantiation for Google Calendar
		if (mcp.key === "Google Calendar") {
			const calendarItem = items.find(item => item.key === "Google Calendar");
			if (calendarItem && calendarItem.onInstall) {
				await calendarItem.onInstall();
			}
		}

		await fetchInstalled();
		onClose();
	};
	const onClose = () => {
		setShowEnvConfig(false);
		setActiveMcp(null);
	};

	// uninstall logic
	const handleUninstall = useCallback(
		async (item: IntegrationItem) => {
			checkAgentTool(item.key);
			// find all configs that match config_group, delete one by one
			const groupKey = item.key.toLowerCase();
			const toDelete = configs.filter(
				(c: any) => c.config_group && c.config_group.toLowerCase() === groupKey
			);
			console.log("toDelete", toDelete);
			for (const config of toDelete) {
				try {
					await proxyFetchDelete(`/api/configs/${config.id}`);
					console.log("envRemove", email, item.env_vars[0]);

					// delete env
					if (
						item.env_vars &&
						item.env_vars.length > 0 &&
						window.electronAPI?.envRemove
					) {

						await window.electronAPI.envRemove(email, item.env_vars[0]);
					}
				} catch (e) {
					console.log("envRemove error", e);
					// ignore error
				}
			}
			// after deletion, refresh configs
			setConfigs((prev) =>
				prev.filter((c: any) => c.config_group?.toLowerCase() !== groupKey)
			);
		},
		[configs]
	);

	return (
		<div className="space-y-3">
			<MCPEnvDialog
				showEnvConfig={showEnvConfig}
				onClose={onClose}
				onConnect={onConnect}
				activeMcp={activeMcp}
			></MCPEnvDialog>
			{items.map((item) => {
				const isInstalled = !!installed[item.key];
				return (
					<div
						key={item.key}
						className="p-4 bg-surface-secondary rounded-2xl flex items-center justify-between"
					>
						<div className="flex items-center gap-xs">
							<img
								src={ellipseIcon}
								alt="icon"
								className="w-3 h-3 mr-2"
								style={{
									filter: isInstalled
										? "grayscale(0%) brightness(0) saturate(100%) invert(41%) sepia(99%) saturate(749%) hue-rotate(81deg) brightness(95%) contrast(92%)"
										: "none",
								}}
							/>
							<div className="text-base leading-snug font-bold text-text-action">
								{item.name}
							</div>
							<div className="flex items-center">
								<Tooltip>
									<TooltipTrigger asChild>
										<CircleAlert className="w-4 h-4 text-icon-secondary" />
									</TooltipTrigger>
									<TooltipContent>
										<div>{item.desc}</div>
									</TooltipContent>
								</Tooltip>
							</div>
						</div>
						<Button
							disabled={[
								"X(Twitter)",
								"WhatsApp",
								"LinkedIn",
								"Reddit",
								"Github",
							].includes(item.name)}
							variant={isInstalled ? "secondary" : "primary"}
							size="sm"
							onClick={() =>
								isInstalled ? handleUninstall(item) : handleInstall(item)
							}
						>
							{[
								"X(Twitter)",
								"WhatsApp",
								"LinkedIn",
								"Reddit",
								"Github",
							].includes(item.name)
								? t("setting.coming-soon")
								: isInstalled
								? t("setting.uninstall")
								: t("setting.install")}
						</Button>
					</div>
				);
			})}
		</div>
	);
}
