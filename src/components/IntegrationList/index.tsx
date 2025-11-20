import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipSimple } from "@/components/ui/tooltip";
import { CircleAlert, Settings2 } from "lucide-react";
import { fetchGet, fetchPost } from "@/api/http";

import React, { useState, useCallback, useMemo } from "react";
import ellipseIcon from "@/assets/mcp/Ellipse-25.svg";
import { MCPEnvDialog } from "@/pages/Setting/components/MCPEnvDialog";
import { OAuth } from "@/lib/oauth";
import { useTranslation } from "react-i18next";
import {
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from "@/components/ui/select";
import {
	useIntegrationManagement,
	type IntegrationItem,
} from "@/hooks/useIntegrationManagement";

type IntegrationListVariant = "select" | "manage";

interface IntegrationListProps {
	items: IntegrationItem[];
	variant?: IntegrationListVariant; // "select" for AddWorker, "manage" for Setting

	// Select mode props (AddWorker)
	addOption?: (mcp: any, isLocal: boolean) => void;
	onShowEnvConfig?: (mcp: any) => void;

	// Manage mode props (Setting)
	showSelect?: boolean;
	selectPlaceholder?: string;
	selectContent?: React.ReactNode;
	onSelectChange?: (value: string, item: IntegrationItem) => void;
	showConfigButton?: boolean;
	showInstallButton?: boolean;
	onConfigClick?: (item: IntegrationItem) => void;
	showStatusDot?: boolean;

	// Common props
	installedKeys?: string[];
	oauth?: OAuth | null;
	translationNamespace?: "layout" | "setting"; // For translation keys
}

export default function IntegrationList({
	items,
	variant = "manage", // Default to manage mode for backward compatibility
	addOption,
	onShowEnvConfig,
	showSelect = false,
	selectPlaceholder = "Select...",
	selectContent,
	onSelectChange,
	showConfigButton = true,
	showInstallButton = true,
	onConfigClick,
	showStatusDot = true,
	installedKeys = [],
	oauth,
	translationNamespace = variant === "select" ? "layout" : "setting",
}: IntegrationListProps) {
	const { t } = useTranslation();
	const [showEnvConfig, setShowEnvConfig] = useState(false);
	const [activeMcp, setActiveMcp] = useState<any | null>(null);
	const isSelectMode = variant === "select";

	// Use shared hook for integration management
	const {
		installed,
		fetchInstalled,
		saveEnvAndConfig,
		handleUninstall,
		createMcpFromItem,
	} = useIntegrationManagement(items);

	// Install handler - different logic for select vs manage mode
	const handleInstall = useCallback(
		async (item: IntegrationItem) => {
			console.log(item);
			const searchKey = isSelectMode ? "EXA Search" : "Search";

			if (item.key === searchKey) {
				const mcp = createMcpFromItem(item, 13);
				if (isSelectMode) {
					onShowEnvConfig?.(mcp);
				} else {
					setActiveMcp(mcp);
					setShowEnvConfig(true);
				}
				return;
			}

			if (item.key === "Google Calendar") {
				const mcp = createMcpFromItem(item, 14);
				if (isSelectMode) {
					onShowEnvConfig?.(mcp);
				} else {
					setActiveMcp(mcp);
					setShowEnvConfig(true);
				}
				return;
			}

			if (installed[item.key]) return;
			await item.onInstall();
			// Only refresh in select mode
			if (isSelectMode) {
				await fetchInstalled();
			}
		},
		[
			installed,
			createMcpFromItem,
			isSelectMode,
			onShowEnvConfig,
			fetchInstalled,
		]
	);

	// onConnect handler - different logic for select vs manage mode
	const onConnect = async (mcp: any) => {
		console.log("[IntegrationList onConnect] Starting for", mcp.key);

		// Refresh configs first to get latest state
		await fetchInstalled();

		// Save all environment variables
		await Promise.all(
			Object.keys(mcp.install_command.env).map(async (key) => {
				return saveEnvAndConfig(mcp.key, key, mcp.install_command.env[key]);
			})
		);

		// After saving env vars, handle Google Calendar authorization flow
		if (mcp.key === "Google Calendar") {
			console.log(
				"[IntegrationList onConnect] Google Calendar detected, starting auth flow"
			);

			// Trigger install/authorization
			const calendarItem = items.find((item) => item.key === "Google Calendar");
			try {
				if (calendarItem && calendarItem.onInstall) {
					await calendarItem.onInstall();
				} else {
					await fetchPost("/install/tool/google_calendar");
				}
			} catch (_) {}

			// Select mode: poll OAuth status
			if (isSelectMode) {
				console.log(
					"[IntegrationList onConnect] Starting OAuth status polling"
				);

				const start = Date.now();
				const timeoutMs = 5 * 60 * 1000; // 5 minutes
				while (Date.now() - start < timeoutMs) {
					try {
						const statusRes: any = await fetchGet(
							"/oauth/status/google_calendar"
						);
						console.log(
							"[IntegrationList onConnect] OAuth status:",
							statusRes?.status
						);

						if (statusRes?.status === "success") {
							console.log(
								"[IntegrationList onConnect] Success! Closing dialog"
							);
							await fetchInstalled();
							onClose();
							return;
						}
						if (
							statusRes?.status === "failed" ||
							statusRes?.status === "cancelled"
						) {
							console.log(
								"[IntegrationList onConnect] Failed/cancelled, keeping dialog open"
							);
							return;
						}
					} catch (err) {
						console.log("[IntegrationList onConnect] Polling error:", err);
					}
					await new Promise((r) => setTimeout(r, 1500));
				}
				console.log("[IntegrationList onConnect] Polling timeout");
				return;
			}
		}

		// Select mode: add to tools and close
		if (isSelectMode && addOption) {
			console.log(
				"[IntegrationList onConnect] Non-Google Calendar, closing immediately"
			);
			await fetchInstalled();
			addOption(mcp, true);
			onClose();
		} else {
			// Manage mode: just close
			await fetchInstalled();
			onClose();
		}
	};

	const onClose = () => {
		setShowEnvConfig(false);
		setActiveMcp(null);
	};

	const handleOpenConfig = useCallback(
		(item: IntegrationItem) => {
			// if external handler provided by parent, use it
			if (onConfigClick) {
				onConfigClick(item);
				return;
			}
			// default behavior: if item has env vars, open built-in MCP config dialog
			if (item?.env_vars && item.env_vars.length > 0) {
				const mcp = createMcpFromItem(item, -1);
				setActiveMcp(mcp);
				setShowEnvConfig(true);
			}
		},
		[onConfigClick, createMcpFromItem]
	);

	const COMING_SOON_ITEMS = [
		"Slack",
		"X(Twitter)",
		"WhatsApp",
		"LinkedIn",
		"Reddit",
		"Github",
	];

	const sortedItems = useMemo(() => {
		const available = items.filter((item) => !COMING_SOON_ITEMS.includes(item.name));
		const comingSoon = items.filter((item) => COMING_SOON_ITEMS.includes(item.name));
		return [...available, ...comingSoon];
	}, [items]);

	// Determine container and item styles based on variant
	const containerClassName = isSelectMode
		? "space-y-3"
		: "flex flex-col w-full items-start justify-start gap-4";

	const itemClassName = isSelectMode
		? "cursor-pointer hover:bg-gray-100 px-3 py-2 flex justify-between"
		: "w-full px-6 py-4 bg-surface-secondary rounded-2xl";

	const titleClassName = isSelectMode
		? "text-base leading-snug font-bold text-text-action"
		: "text-label-lg font-bold text-text-heading";

	return (
		<div className={containerClassName}>
			<MCPEnvDialog
				showEnvConfig={showEnvConfig}
				onClose={onClose}
				onConnect={onConnect}
				activeMcp={activeMcp}
			></MCPEnvDialog>
			{sortedItems.map((item) => {
				const isInstalled = !!installed[item.key];
				const isComingSoon = COMING_SOON_ITEMS.includes(item.name);

				return (
					<div key={item.key} className=" w-full">
						<div
							className={itemClassName}
							onClick={
								isSelectMode
									? () => {
											if (!isComingSoon) {
												if (item.env_vars.length === 0 || isInstalled) {
													// Ensure toolkit field is passed and normalized for known cases
													const normalizedToolkit =
														item.name === "Notion"
															? "notion_mcp_toolkit"
															: item.toolkit;
													addOption?.(
														{ ...item, toolkit: normalizedToolkit },
														true
													);
												} else {
													handleInstall(item);
												}
											}
									  }
									: undefined
							}
						>
							{isSelectMode ? (
								<div className="flex items-center gap-xs">
									{(isSelectMode || showStatusDot) && (
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
									)}
									<div className={titleClassName}>{item.name}</div>
									<div className="flex items-center">
										<TooltipSimple content={item.desc}>
											<CircleAlert className="w-4 h-4 text-icon-secondary" />
										</TooltipSimple>
									</div>
								</div>
							) : (
								<div className="flex flex-row w-full items-center justify-between gap-xs">
									<div className="flex flex-row items-center gap-xs">
										{showStatusDot && (
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
										)}
										<div className={titleClassName}>{item.name}</div>
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
									<div className="flex flex-row items-center gap-md">
										{showConfigButton && (
											<Button
												type="button"
												variant="outline"
												size="sm"
												onClick={(e) => {
													e.preventDefault();
													e.stopPropagation();
													handleOpenConfig(item);
												}}
											>
												<Settings2 className="w-4 h-4" />
												{t("setting.setting")}
											</Button>
										)}
										{showInstallButton && (
											<Button
												type="button"
												disabled={isComingSoon}
												variant={
													isComingSoon
														? "ghost"
														: isInstalled
														? "outline"
														: "primary"
												}
												size="sm"
												onClick={(e) => {
													e.preventDefault();
													e.stopPropagation();
													return isInstalled
														? handleUninstall(item)
														: handleInstall(item);
												}}
											>
												{isComingSoon
													? t(`${translationNamespace}.coming-soon`)
													: isInstalled
													? t(`${translationNamespace}.uninstall`)
													: t(`${translationNamespace}.install`)}
											</Button>
										)}
									</div>
								</div>
							)}
							{isSelectMode && item.env_vars.length !== 0 && (
								<Button
									disabled={isComingSoon}
									variant={isInstalled ? "secondary" : "primary"}
									size="sm"
									onClick={(e) => {
										e.stopPropagation();
										return isInstalled
											? handleUninstall(item)
											: handleInstall(item);
									}}
								>
									{isComingSoon
										? t(`${translationNamespace}.coming-soon`)
										: isInstalled
										? t(`${translationNamespace}.uninstall`)
										: t(`${translationNamespace}.install`)}
								</Button>
							)}
						</div>

						{!isSelectMode && showSelect && (
							<div className="flex flex-row w-full items-center gap-md mt-6 pt-6 border-b-0 border-x-0 border-solid border-border-secondary">
								<div className="flex flex-row w-full items-center justify-between gap-md">
									<div className="text-body-md text-text-body">
										{" "}
										Default {item.name}
									</div>
									<div className="flex-1 max-w-[300px]">
										<Select onValueChange={(v) => onSelectChange?.(v, item)}>
											<SelectTrigger size="default">
												<SelectValue placeholder={selectPlaceholder} />
											</SelectTrigger>
											<SelectContent className="z-100">
												{selectContent ?? (
													<>
														<SelectItem value="more">
															More integrations
														</SelectItem>
													</>
												)}
											</SelectContent>
										</Select>
									</div>
								</div>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
}
