import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Globe, Cookie, Trash2, RefreshCw, RotateCw, Plus, EllipsisVertical, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { fetchPost, fetchGet, fetchDelete } from "@/api/http";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import AlertDialog from "@/components/ui/alertDialog";
import { Input } from "@/components/ui/input";
import { CdpBrowser } from "electron/main/index";

interface CookieDomain {
	domain: string;
	cookie_count: number;
	last_access: string;
}

interface GroupedDomain {
	mainDomain: string;
	subdomains: CookieDomain[];
	totalCookies: number;
}

interface CdpPortStatus {
	checking: boolean;
	available: boolean | null;
	error?: string;
	data?: any;
}

export default function Browser() {
	const { t } = useTranslation();
	const [loginLoading, setLoginLoading] = useState(false);
	const [cookiesLoading, setCookiesLoading] = useState(false);
	const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
	const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
	const [deletingAll, setDeletingAll] = useState(false);
	const [showRestartDialog, setShowRestartDialog] = useState(false);
	const [cookiesBeforeBrowser, setCookiesBeforeBrowser] = useState<number>(0);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

	// CDP port configuration
	const [cdpPort, setCdpPort] = useState<number>(9223);
	const [customPort, setCustomPort] = useState<string>("9223");
	const [portStatus, setPortStatus] = useState<CdpPortStatus>({
		checking: false,
		available: null,
	});

	// Dialog states
	const [showUseExistingDialog, setShowUseExistingDialog] = useState(false);
	const [showLaunchNewDialog, setShowLaunchNewDialog] = useState(false);
	const [pendingPort, setPendingPort] = useState<number | null>(null);

	// CDP Browser Pool
	const [cdpBrowsers, setCdpBrowsers] = useState<CdpBrowser[]>([]);
	const [deletingBrowser, setDeletingBrowser] = useState<string | null>(null);
	const [runningPorts, setRunningPorts] = useState<number[]>([]);

	// Extract main domain (e.g., "aa.bb.cc" -> "bb.cc", "www.google.com" -> "google.com")
	const getMainDomain = (domain: string): string => {
		// Remove leading dot if present
		const cleanDomain = domain.startsWith('.') ? domain.substring(1) : domain;
		const parts = cleanDomain.split('.');

		// For domains with 2 or fewer parts, return as is
		if (parts.length <= 2) {
			return cleanDomain;
		}

		// For domains with more parts, return last 2 parts (main domain)
		return parts.slice(-2).join('.');
	};

	// Group domains by main domain
	const groupDomainsByMain = (domains: CookieDomain[]): GroupedDomain[] => {
		const grouped = new Map<string, CookieDomain[]>();

		domains.forEach(item => {
			const mainDomain = getMainDomain(item.domain);
			if (!grouped.has(mainDomain)) {
				grouped.set(mainDomain, []);
			}
			grouped.get(mainDomain)!.push(item);
		});

		return Array.from(grouped.entries()).map(([mainDomain, subdomains]) => ({
			mainDomain,
			subdomains,
			totalCookies: subdomains.reduce((sum, item) => sum + item.cookie_count, 0)
		})).sort((a, b) => a.mainDomain.localeCompare(b.mainDomain));
	};

	// Auto-load cookies on component mount
	useEffect(() => {
		handleLoadCookies();
		// Load current browser port on mount
		loadCurrentBrowserPort();
		// Load CDP browser pool
		loadCdpBrowsers();
	}, []);

	const loadCurrentBrowserPort = async () => {
		if (window.ipcRenderer) {
			const port = await window.ipcRenderer.invoke('get-browser-port');
			setCdpPort(port);
			setCustomPort(String(port));
		}
	};

	const loadCdpBrowsers = async () => {
		if (window.electronAPI?.getCdpBrowsers) {
			try {
				console.log('[FRONTEND CDP LOAD] Loading CDP browser pool...');
				const browsers = await window.electronAPI.getCdpBrowsers();
				console.log('[FRONTEND CDP LOAD] Loaded browsers:', browsers);
				console.log(`[FRONTEND CDP LOAD] Pool size: ${browsers.length}`);
				setCdpBrowsers(browsers);

				// Also load running browser ports
				if (window.electronAPI?.getRunningBrowserPorts) {
					const ports = await window.electronAPI.getRunningBrowserPorts();
					console.log('[FRONTEND CDP LOAD] Running browser ports:', ports);
					setRunningPorts(ports);
				}
			} catch (error) {
				console.error("[FRONTEND CDP LOAD] Failed to load CDP browsers:", error);
			}
		}
	};

	// Periodically refresh running browser ports
	useEffect(() => {
		const interval = setInterval(async () => {
			if (window.electronAPI?.getRunningBrowserPorts) {
				try {
					const ports = await window.electronAPI.getRunningBrowserPorts();
					setRunningPorts(ports);
				} catch (error) {
					console.error("Failed to refresh running ports:", error);
				}
			}
		}, 3000); // Refresh every 3 seconds

		return () => clearInterval(interval);
	}, []);

	const handleCheckPort = async () => {
		const portNumber = parseInt(customPort);

		if (isNaN(portNumber) || portNumber < 1 || portNumber > 65535) {
			toast.error("Please enter a valid port number (1-65535)");
			return;
		}

		setPortStatus({ checking: true, available: null });

		try {
			if (!window.electronAPI?.checkCdpPort) {
				toast.error("CDP port check not available");
				setPortStatus({ checking: false, available: false, error: "Not available" });
				return;
			}

			const result = await window.electronAPI.checkCdpPort(portNumber);

			if (result.available) {
				setPortStatus({
					checking: false,
					available: true,
					data: result.data,
				});
				// Browser exists, ask if user wants to use it
				setPendingPort(portNumber);
				setShowUseExistingDialog(true);
			} else {
				setPortStatus({
					checking: false,
					available: false,
					error: result.error,
				});
				// No browser on this port, ask if user wants to launch one
				setPendingPort(portNumber);
				setShowLaunchNewDialog(true);
			}
		} catch (error: any) {
			setPortStatus({
				checking: false,
				available: false,
				error: error.message,
			});
			toast.error(error.message || "Failed to check port");
		}
	};

	const handleUseExistingBrowser = async () => {
		setShowUseExistingDialog(false);
		if (pendingPort) {
			try {
				console.log(`[FRONTEND CDP ADD] Attempting to add external browser on port ${pendingPort}`);
				// Add browser to pool
				if (window.electronAPI?.addCdpBrowser) {
					const result = await window.electronAPI.addCdpBrowser(pendingPort, true, `External Browser (${pendingPort})`);
					console.log(`[FRONTEND CDP ADD] Result:`, result);
					if (result.success) {
						console.log(`[FRONTEND CDP ADD] ✅ Successfully added browser ${result.browser.id} on port ${pendingPort}`);
						toast.success(`Added external browser on port ${pendingPort} to pool`);
						await loadCdpBrowsers();
					} else {
						console.error(`[FRONTEND CDP ADD] ❌ Failed to add browser:`, result.error);
						toast.error(result.error || "Failed to add browser to pool");
					}
				}
			} catch (error: any) {
				console.error(`[FRONTEND CDP ADD] ❌ Exception:`, error);
				toast.error(error.message || "Failed to add browser to pool");
			}
		}
		setPendingPort(null);
	};

	const handleLaunchNewBrowser = async () => {
		setShowLaunchNewDialog(false);

		if (!pendingPort) {
			return;
		}

		const port = pendingPort;
		setPendingPort(null);

		try {
			if (!window.electronAPI?.launchCdpBrowser) {
				toast.error("Launch CDP browser not available");
				return;
			}

			console.log(`[FRONTEND CDP LAUNCH] Launching browser on port ${port}...`);
			toast.loading(`Launching browser on port ${port}...`, { id: 'launch-browser' });

			const result = await window.electronAPI.launchCdpBrowser(port);
			console.log(`[FRONTEND CDP LAUNCH] Launch result:`, result);

			if (result.success) {
				console.log(`[FRONTEND CDP LAUNCH] ✅ Browser launched successfully on port ${port}`);
				toast.success(`Browser launched successfully on port ${port}`, { id: 'launch-browser' });

				// Add launched browser to pool
				console.log(`[FRONTEND CDP LAUNCH] Adding launched browser to pool...`);
				if (window.electronAPI?.addCdpBrowser) {
					const addResult = await window.electronAPI.addCdpBrowser(port, false, `Launched Browser (${port})`);
					console.log(`[FRONTEND CDP LAUNCH] Add to pool result:`, addResult);
					if (addResult.success) {
						console.log(`[FRONTEND CDP LAUNCH] ✅ Browser added to pool: ${addResult.browser.id}`);
						await loadCdpBrowsers();
					} else {
						console.error(`[FRONTEND CDP LAUNCH] ❌ Failed to add to pool:`, addResult.error);
						toast.error(addResult.error || "Failed to add browser to pool");
					}
				}

				// Update port status
				setPortStatus({
					checking: false,
					available: true,
					data: result.data,
				});
			} else {
				console.error(`[FRONTEND CDP LAUNCH] ❌ Launch failed:`, result.error);
				toast.error(result.error || "Failed to launch browser", { id: 'launch-browser' });
			}
		} catch (error: any) {
			console.error(`[FRONTEND CDP LAUNCH] ❌ Exception:`, error);
			toast.error(error.message || "Failed to launch browser", { id: 'launch-browser' });
		}
	};

	const handleRemoveBrowser = async (browserId: string) => {
		setDeletingBrowser(browserId);
		try {
			if (window.electronAPI?.removeCdpBrowser) {
				const result = await window.electronAPI.removeCdpBrowser(browserId);
				if (result.success) {
					toast.success("Browser removed from pool");
					await loadCdpBrowsers();
				} else {
					toast.error(result.error || "Failed to remove browser");
				}
			}
		} catch (error: any) {
			toast.error(error.message || "Failed to remove browser");
		} finally {
			setDeletingBrowser(null);
		}
	};

	const handleBrowserLogin = async () => {
		setLoginLoading(true);
		try {
			// Record current cookie count before opening browser
			const currentCookieCount = cookieDomains.reduce((sum, item) => sum + item.cookie_count, 0);
			setCookiesBeforeBrowser(currentCookieCount);

			const response = await fetchPost("/browser/login");
			if (response) {
				toast.success("Browser opened successfully for login");
				// Listen for browser close event to reload cookies
				const checkInterval = setInterval(async () => {
					try {
						// Check if browser is still open by making a request
						// When browser closes, reload cookies
						const statusResponse = await fetchGet("/browser/status");
						if (!statusResponse || !statusResponse.is_open) {
							clearInterval(checkInterval);
							await handleLoadCookies();
							// Check if cookies changed
							const newResponse = await fetchGet("/browser/cookies");
							if (newResponse && newResponse.success) {
								const newDomains = newResponse.domains || [];
								const newCookieCount = newDomains.reduce((sum: number, item: CookieDomain) => sum + item.cookie_count, 0);

								if (newCookieCount > currentCookieCount) {
									// Cookies were added, show success toast and restart dialog
									const addedCount = newCookieCount - currentCookieCount;
									toast.success(`Added ${addedCount} cookie${addedCount !== 1 ? 's' : ''}`);
									setHasUnsavedChanges(true);
									setShowRestartDialog(true);
								} else if (newCookieCount < currentCookieCount) {
									// Cookies were deleted (shouldn't happen here, but handle it)
									setHasUnsavedChanges(true);
									setShowRestartDialog(true);
								}
							}
						}
					} catch (error) {
						// Browser might be closed
						clearInterval(checkInterval);
						await handleLoadCookies();
					}
				}, 500); // Check every 2 seconds
			}
		} catch (error: any) {
			toast.error(error?.message || "Failed to open browser");
		} finally {
			setLoginLoading(false);
		}
	};

	const handleLoadCookies = async () => {
		setCookiesLoading(true);
		try {
			const response = await fetchGet("/browser/cookies");
			if (response && response.success) {
				const domains = response.domains || [];
				setCookieDomains(domains);
			} else {
				setCookieDomains([]);
			}
		} catch (error: any) {
			toast.error(error?.message || "Failed to load cookies");
			setCookieDomains([]);
		} finally {
			setCookiesLoading(false);
		}
	};

	const handleDeleteMainDomain = async (mainDomain: string, subdomains: CookieDomain[]) => {
		setDeletingDomain(mainDomain);
		try {
			// Delete all subdomains under this main domain
			const deletePromises = subdomains.map(item =>
				fetchDelete(`/browser/cookies/${encodeURIComponent(item.domain)}`)
			);
			await Promise.all(deletePromises);

			toast.success(`Deleted cookies for ${mainDomain} and all subdomains`);
			// Remove from local state
			const domainsToRemove = new Set(subdomains.map(item => item.domain));
			setCookieDomains(prev => prev.filter(item => !domainsToRemove.has(item.domain)));

			// Mark as having unsaved changes
			setHasUnsavedChanges(true);
			// Show restart dialog after successful deletion
			setShowRestartDialog(true);
		} catch (error: any) {
			toast.error(error?.message || `Failed to delete cookies for ${mainDomain}`);
		} finally {
			setDeletingDomain(null);
		}
	};
4
	const handleDeleteAll = async () => {
		setDeletingAll(true);
		try {
			await fetchDelete("/browser/cookies");
			toast.success("Deleted all cookies");
			setCookieDomains([]);

			// Mark as having unsaved changes
			setHasUnsavedChanges(true);
			// Show restart dialog after successful deletion
			setShowRestartDialog(true);
		} catch (error: any) {
			toast.error(error?.message || "Failed to delete all cookies");
		} finally {
			setDeletingAll(false);
		}
	};

	const handleRestartApp = () => {
		if (window.electronAPI && window.electronAPI.restartApp) {
			window.electronAPI.restartApp();
		} else {
			toast.error("Restart function not available");
		}
	};

	const handleConfirmRestart = () => {
		setShowRestartDialog(false);
		handleRestartApp();
	};

	return (
		<div className="flex-1 h-auto m-auto">
			{/* Restart Dialog */}
			<AlertDialog
				isOpen={showRestartDialog}
				onClose={() => setShowRestartDialog(false)}
				onConfirm={handleConfirmRestart}
				title="Cookies Updated"
				message="Cookies have been updated. Would you like to restart the application to use the new cookies?"
				confirmText="Yes, Restart"
				cancelText="No, Add More"
				confirmVariant="information"
			/>

			{/* Use Existing Browser Dialog */}
			<AlertDialog
				isOpen={showUseExistingDialog}
				onClose={() => {
					setShowUseExistingDialog(false);
					setPendingPort(null);
				}}
				onConfirm={handleUseExistingBrowser}
				title="Browser Found"
				message={`A browser is running on port ${pendingPort}. Would you like to use it for browser operations?`}
				confirmText="Yes, Use This Browser"
				cancelText="Cancel"
				confirmVariant="information"
			/>

			{/* Launch New Browser Dialog */}
			<AlertDialog
				isOpen={showLaunchNewDialog}
				onClose={() => {
					setShowLaunchNewDialog(false);
					setPendingPort(null);
				}}
				onConfirm={handleLaunchNewBrowser}
				title="No Browser Found"
				message={`No browser is running on port ${pendingPort}. Would you like to launch a new Chrome browser with CDP enabled on this port?`}
				confirmText="Yes, Launch Browser"
				cancelText="Cancel"
				confirmVariant="information"
			/>

			{/* Header Section */}
			<div className="flex w-full border-solid border-t-0 border-x-0 border-border-disabled">
				<div className="flex px-6 pt-8 pb-4 max-w-[900px] mx-auto w-full items-center justify-between">
					<div className="flex flex-row items-center justify-between w-full gap-4">
						<div className="flex flex-col">
							<div className="text-heading-sm font-bold text-text-heading">{t("layout.browser-management")}</div>
							<p className="text-body-sm text-text-label max-w-[700px]">
							{t("layout.browser-management-description")}.</p>
						</div>
					</div>
				</div>
			</div>
      
			{/* Content Section */}
			<div className="flex w-full">
				<div className="flex flex-col px-6 py-8 max-w-[900px] min-h-[calc(100vh-86px)] mx-auto w-full items-start justify-center">

					<div className="flex flex-col w-full min-h-full items-center justify-start border-border-disabled border-solid rounded-xl p-6 bg-surface-secondary relative">
						<div className="absolute top-6 right-6">
							<Button
								variant="information"
								size="xs"
								onClick={handleRestartApp}
								className="justify-center gap-0 rounded-full overflow-hidden transition-all duration-300 ease-in-out"
							>
								<RefreshCw className="flex-shrink-0" />
								<span
									className={`overflow-hidden transition-all duration-300 ease-in-out ${
										hasUnsavedChanges
											? "max-w-[150px] opacity-100 pl-2"
											: "max-w-0 opacity-0 ml-0"
									}`}
								>
									{t("layout.restart-to-apply")}
								</span>
							</Button>
						</div>
						<div className="text-body-lg font-bold text-text-heading">{t("layout.browser-cookies")}</div>
						<p className="max-w-[600px] text-center text-body-sm text-text-label">{t("layout.browser-cookies-description")}
						</p>

						{/* CDP Port Configuration Section */}
						<div className="flex flex-col max-w-[600px] w-full gap-3 border-[0.5px] border-border-secondary border-b-0 border-x-0 border-solid pt-3 mt-3">
							<div className="flex flex-row items-center justify-between py-2">
								<div className="flex flex-col items-start">
									<div className="text-body-base font-bold text-text-body">
										CDP Browser Connection
									</div>
									<p className="text-label-xs text-text-label mt-1">
										Connect to a Chrome browser with remote debugging enabled
									</p>
								</div>
							</div>

							<div className="flex flex-col gap-3 px-4 py-3 bg-surface-tertiary rounded-xl">
								<div className="flex flex-col gap-2">
									<div className="text-label-sm font-medium text-text-body">
										Current Port: <span className="font-bold text-text-information">{cdpPort}</span>
									</div>
									<p className="text-label-xs text-text-label">
										Check if a browser is available on a specific port
									</p>
								</div>

								<div className="flex items-center gap-2">
									<Input
										type="number"
										placeholder="Port number (e.g., 9222)"
										value={customPort}
										onChange={(e) => setCustomPort(e.target.value)}
										className="flex-1"
										min={1}
										max={65535}
									/>
									<Button
										variant="primary"
										size="sm"
										onClick={handleCheckPort}
										disabled={portStatus.checking}
										className="min-w-[100px]"
									>
										{portStatus.checking ? (
											<>
												<Loader2 className="w-4 h-4 animate-spin" />
												Checking
											</>
										) : (
											"Check Port"
										)}
									</Button>
								</div>

								{portStatus.available !== null && (
									<div className={`flex items-start gap-2 p-3 rounded-lg ${
										portStatus.available
											? 'bg-tag-fill-success text-text-success'
											: 'bg-tag-fill-error text-text-cuation'
									}`}>
										{portStatus.available ? (
											<>
												<CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
												<div className="flex flex-col gap-1">
													<div className="text-label-sm font-bold">
														Browser Available
													</div>
													{portStatus.data && (
														<div className="text-label-xs opacity-90">
															{portStatus.data['Browser']} - {portStatus.data['User-Agent']?.split(' ')[0]}
														</div>
													)}
												</div>
											</>
										) : (
											<>
												<XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
												<div className="flex flex-col gap-1">
													<div className="text-label-sm font-bold">
														Browser Not Available
													</div>
													<div className="text-label-xs opacity-90">
														{portStatus.error}
													</div>
												</div>
											</>
										)}
									</div>
								)}
							</div>
						</div>

						{/* CDP Browser Pool Section */}
						<div className="flex flex-col max-w-[600px] w-full gap-3 border-[0.5px] border-border-secondary border-b-0 border-x-0 border-solid pt-3 mt-3">
							<div className="flex flex-row items-center justify-between py-2">
								<div className="flex flex-col items-start">
									<div className="flex items-center gap-2">
										<div className="text-body-base font-bold text-text-body">
											CDP Browser Pool
										</div>
										<span className="text-label-xs px-2 py-0.5 rounded bg-tag-fill-info text-text-information">
											{runningPorts.length} / {cdpBrowsers.length} Running
										</span>
									</div>
									<p className="text-label-xs text-text-label mt-1">
										Manage multiple CDP browsers for task execution
									</p>
								</div>
							</div>

							{cdpBrowsers.length > 0 ? (
								<div className="flex flex-col gap-2">
									{cdpBrowsers.map((browser) => (
										<div
											key={browser.id}
											className="flex items-center justify-between px-4 py-3 bg-surface-tertiary rounded-xl border-solid border-border-disabled"
										>
											<div className="flex flex-col w-full items-start justify-start">
												<div className="flex items-center gap-2">
													<span className="text-body-sm text-text-body font-bold">
														{browser.name || `Browser ${browser.port}`}
													</span>
													<span className={`text-label-xs px-2 py-0.5 rounded ${
														browser.isExternal
															? 'bg-tag-fill-info text-text-information'
															: 'bg-tag-fill-success text-text-success'
													}`}>
														{browser.isExternal ? 'External' : 'Launched'}
													</span>
													{/* Running status indicator */}
													{runningPorts.includes(browser.port) ? (
														<span className="flex items-center gap-1 text-label-xs px-2 py-0.5 rounded bg-tag-fill-success text-text-success">
															<span className="w-2 h-2 rounded-full bg-text-success animate-pulse"></span>
															Running
														</span>
													) : (
														!browser.isExternal && (
															<span className="flex items-center gap-1 text-label-xs px-2 py-0.5 rounded bg-tag-fill-error text-text-cuation">
																<span className="w-2 h-2 rounded-full bg-text-cuation"></span>
																Stopped
															</span>
														)
													)}
												</div>
												<span className="text-label-xs text-text-label mt-1">
													Port: {browser.port}
												</span>
											</div>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleRemoveBrowser(browser.id)}
												disabled={deletingBrowser === browser.id}
												className="ml-3 flex-shrink-0"
											>
												<Trash2 className="w-4 h-4 text-text-cuation" />
											</Button>
										</div>
									))}
								</div>
							) : (
								<div className="flex flex-col items-center justify-center py-8 px-4 bg-surface-tertiary rounded-xl">
									<Globe className="w-12 h-12 text-icon-secondary opacity-50 mb-4" />
									<div className="text-body-base font-bold text-text-label text-center">
										No browsers in pool
									</div>
									<p className="text-label-xs font-medium text-text-label text-center mt-1">
										Add browsers using the check port tool above
									</p>
								</div>
							)}
						</div>

						{/* Cookies Section */}
						<div className="flex flex-col max-w-[600px] w-full gap-3 border-[0.5px] border-border-secondary border-b-0 border-x-0 border-solid pt-3 mt-3">

							<div className="flex flex-row items-center justify-between py-2">
								<div className="flex flex-row items-center justify-start gap-2">
									<div className="text-body-base font-bold text-text-body">
										{t("layout.cookie-domains")}
									</div>
									{cookieDomains.length > 0 && (
										<div className="text-label-sm font-bold text-text-information bg-tag-fill-info rounded-lg px-2">
											{groupDomainsByMain(cookieDomains).length}
										</div>
									)}
								</div>

								<div className="flex items-center gap-2">
									{cookieDomains.length > 0 && (
										<Button
											variant="ghost"
											size="sm"
											onClick={handleDeleteAll}
											disabled={deletingAll}
											className="!text-text-cuation uppercase"
										>
											{deletingAll ? t("layout.deleting") : t("layout.delete-all")}
										</Button>
									)}
									<Button
										variant="ghost"
										size="sm"
										onClick={handleLoadCookies}
										disabled={cookiesLoading}
									>
										<RefreshCw className={`w-4 h-4 ${cookiesLoading ? 'animate-spin' : ''}`} />
									</Button>
									<Button
										variant="primary"
										size="sm"
										onClick={handleBrowserLogin}
										disabled={loginLoading}
									>
										<Plus className="w-4 h-4" />
										{loginLoading ? t("layout.opening") : t("layout.open-browser")}
									</Button>
								</div>
							</div>	

							{cookieDomains.length > 0 ? (
								<div className="flex flex-col gap-2">
									{groupDomainsByMain(cookieDomains).map((group, index) => (
										<div
											key={index}
											className="flex items-center justify-between px-4 py-2 bg-surface-tertiary rounded-xl border-solid border-border-disabled"
										>
											<div className="flex flex-col w-full items-start justify-start">
												<span className="text-body-sm text-text-body font-bold truncate">
													{group.mainDomain}
												</span>
												<span className="text-label-xs text-text-label mt-1">
													{group.totalCookies} Cookie{group.totalCookies !== 1 ? 's' : ''}
												</span>
											</div>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => handleDeleteMainDomain(group.mainDomain, group.subdomains)}
												disabled={deletingDomain === group.mainDomain}
												className="ml-3 flex-shrink-0"
											>
												<Trash2 className="w-4 h-4 text-text-cuation" />
											</Button>
										</div>
									))}
								</div>
							) : (
								<div className="flex flex-col items-center justify-center py-8 px-4">
									<Cookie className="w-12 h-12 text-icon-secondary opacity-50 mb-4" />
									<div className="text-body-base font-bold text-text-label text-center">
										{t("layout.no-cookies-saved-yet")}
									</div>
									<p className="text-label-xs font-medium text-text-label text-center">
										{t("layout.no-cookies-saved-yet-description")}
									</p>
								</div>
							)}
						</div>
					</div>
          
					<div className="flex-1 w-full items-center justify-center text-label-xs text-text-label text-center">
						For more information, check out our 
					<a href="https://www.eigent.ai/privacy-policy" target="_blank" className="text-text-information underline ml-1">{t("layout.privacy-policy")}</a>
          </div>

				</div>
			</div>
		</div>
	);
}
