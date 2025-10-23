import { Button } from "@/components/ui/button";
import { TooltipSimple } from "@/components/ui/tooltip";
import { CircleAlert } from "lucide-react";
import { proxyFetchGet, proxyFetchPost, proxyFetchDelete } from "@/api/http";

import React, { useState, useCallback, useEffect, useRef } from "react";
import ellipseIcon from "@/assets/mcp/Ellipse-25.svg";
import { capitalizeFirstLetter } from "@/lib";
import { MCPEnvDialog } from "@/pages/Setting/components/MCPEnvDialog";
import { useAuthStore } from "@/store/authStore";
import { OAuth } from "@/lib/oauth";
import { useTranslation } from "react-i18next";
interface IntegrationItem {
	key: string;
	name: string;
	desc: string;
	env_vars: string[];
	toolkit?: string;  // Add toolkit field
	onInstall: () => void | Promise<void>;
}



interface IntegrationListProps {
	items: IntegrationItem[];
	addOption: (mcp: any, isLocal: boolean) => void;
	onShowEnvConfig?: (mcp: any) => void;
	installedKeys?: string[];
	oauth?: OAuth | null;
}

export default function IntegrationList({
	items,
	addOption,
	onShowEnvConfig,
	installedKeys = [],
	oauth,
}: IntegrationListProps) {
	const [callBackUrl, setCallBackUrl] = useState<string | null>(null);
	const [showEnvConfig, setShowEnvConfig] = useState(false);
	const [activeMcp, setActiveMcp] = useState<any | null>(null);
	const { email, checkAgentTool } = useAuthStore();
	const { t } = useTranslation();
	// local installed status
	const [installed, setInstalled] = useState<{ [key: string]: boolean }>({});
	// configs cache
	const [configs, setConfigs] = useState<any[]>([]);
	// 1. add useRef lock
	const isLockedRef = useRef(false);
	// add cache oauth event ref
	const pendingOauthEventRef = useRef<{
		provider: string;
		code: string;
	} | null>(null);

	async function fetchInstalled(ignore: boolean = false) {
		try {
			const configsRes = await proxyFetchGet("/api/configs");
			console.log("configsRes", configsRes);
			if (!ignore) {
				console.log("configsRes", Array.isArray(configsRes), configsRes);
				setConfigs(Array.isArray(configsRes) ? configsRes : []);
			}
		} catch (e) {
			console.log("fetchInstalled error", e);
			if (!ignore) setConfigs([]);
		}
	}
	// fetch configs when mounted
	useEffect(() => {
		let ignore = false;

		fetchInstalled(ignore);
		return () => {
			ignore = true;
		};
	}, []);

	// items or configs change, recalculate installed
	useEffect(() => {
		// remove duplicates by config_group
		const groupSet = new Set<string>();
		configs.forEach((c: any) => {
			if (c.config_group) groupSet.add(c.config_group.toLowerCase());
		});
		// construct installed map
		const map: { [key: string]: boolean } = {};
		items.forEach((item) => {
			if (groupSet.has(item.key.toLowerCase())) {
				map[item.key] = true;
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
			config_group: capitalizeFirstLetter(provider),
			config_name: envVarKey,
			config_value: value,
		};
		await proxyFetchPost("/api/configs", configPayload);
		if (window.electronAPI?.envWrite) {
			await window.electronAPI.envWrite(email, { key: envVarKey, value });
		}
	};

	// useCallback to ensure processOauth can get the latest items when items change
	const processOauth = useCallback(
		async (data: { provider: string; code: string }) => {
			if (isLockedRef.current) return;
			if (!items || items.length === 0) {
				// items not ready, cache event, wait for items to have value
				pendingOauthEventRef.current = data;
				console.warn("items is empty, cache oauth event", data);
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
						await fetchInstalled();
						console.log(
							"Slack authorization successful and configuration saved!"
						);
					} else {
						console.log(
							"Slack authorization successful, but access_token not found or env configuration not found"
						);
					}
				}
			} catch (e: any) {
				console.log(`${data.provider} authorization failed: ${e.message || e}`);
			} finally {
				isLockedRef.current = false;
			}
		},
		[items, oauth]
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
	}, [items, oauth, processOauth]);

	// listen to oauth callback URL notification
	useEffect(() => {
		const handler = (_event: any, data: { url: string; provider: string }) => {
			console.log('OAuth callback URL:', data);
			if (data.url && data.provider) {
				setCallBackUrl(data.url);
			}
		};
		window.ipcRenderer?.on("oauth-callback-url", handler);
		return () => {
			window.ipcRenderer?.off("oauth-callback-url", handler);
		};
	}, []);

	// listen to items change, if there is a cached oauth event and items is ready, automatically process
	useEffect(() => {
		if (items && items.length > 0 && pendingOauthEventRef.current) {
			processOauth(pendingOauthEventRef.current);
			pendingOauthEventRef.current = null;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [items, oauth]);

	// install/uninstall
	const handleInstall = useCallback(
		async (item: IntegrationItem) => {
			console.log(item);
			if (item.key === "EXA Search") {
				let mcp = {
					name: "EXA Search",
					key: "EXA Search",
					install_command: {
						env: {} as any,
					},
					id: 13,
				};
				item.env_vars.map((key) => {
					mcp.install_command.env[key] = "";
				});
				onShowEnvConfig?.(mcp);
				// setActiveMcp(mcp);
				// setShowEnvConfig(true);
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
				onShowEnvConfig?.(mcp);
				return;
			}
			if (installed[item.key]) return;
			await item.onInstall();
			// refresh configs after install to update installed state indicator
			await fetchInstalled();
		},
		[installed]
	);

	const onConnect = (mcp: any) => {
		console.log(mcp);
		Object.keys(mcp.install_command.env).map(async (key) => {
			await saveEnvAndConfig(mcp.key, key, mcp.install_command.env[key]);
		});

		fetchInstalled();
		addOption(mcp, true);
		onClose();
	};
	const onClose = () => {
		setShowEnvConfig(false);
		setActiveMcp(null);
	};

	// uninstall logic
	const handleUninstall = useCallback(
		async (item: IntegrationItem) => {
			// find all config_group matching config, delete one by one
			checkAgentTool(item.key);
			const groupKey = item.key.toLowerCase();
			const toDelete = configs.filter(
				(c: any) => c.config_group && c.config_group.toLowerCase() === groupKey
			);
			for (const config of toDelete) {
				try {
					await proxyFetchDelete(`/api/configs/${config.id}`);
					// delete env
					if (
						item.env_vars &&
						item.env_vars.length > 0 &&
						window.electronAPI?.envRemove
					) {
						await window.electronAPI.envRemove(email, item.env_vars[0]);
					}
				} catch (e) {
					// ignore error
				}
			}
			// delete after refresh configs
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
						className="cursor-pointer hover:bg-gray-100 px-3 py-2 flex justify-between"
						onClick={() => {
							if (
								![
									"X(Twitter)",
									"WhatsApp",
									"LinkedIn",
									"Reddit",
									"Github",
								].includes(item.name)
							) {
                                if (item.env_vars.length === 0 || isInstalled) {
                                    // Ensure toolkit field is passed and normalized for known cases
                                    const normalizedToolkit =
                                        item.name === "Notion" ? "notion_mcp_toolkit" : item.toolkit;
                                    addOption({ ...item, toolkit: normalizedToolkit }, true);
								} else {
									handleInstall(item);
								}
							}
						}}
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
								<TooltipSimple content={item.desc}>
										<CircleAlert className="w-4 h-4 text-icon-secondary" />
								</TooltipSimple>
							</div>
						</div>
						{item.env_vars.length !== 0 && (
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
								onClick={(e) => {
									e.stopPropagation();
									return isInstalled
										? handleUninstall(item)
										: handleInstall(item);
								}}
							>
								{[
									"X(Twitter)",
									"WhatsApp",
									"LinkedIn",
									"Reddit",
									"Github",
								].includes(item.name)
									? t("layout.coming-soon")
									: isInstalled
									? t("layout.uninstall")
									: t("layout.install")}
							</Button>
						)}
					</div>
				);
			})}
		</div>
	);
}
