import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Globe, Cookie, Trash2, RefreshCw, RotateCw } from "lucide-react";
import { fetchPost, fetchGet, fetchDelete } from "@/api/http";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import AlertDialog from "@/components/ui/alertDialog";

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

export default function Browser() {
	const { t } = useTranslation();
	const [loginLoading, setLoginLoading] = useState(false);
	const [cookiesLoading, setCookiesLoading] = useState(false);
	const [cookieDomains, setCookieDomains] = useState<CookieDomain[]>([]);
	const [deletingDomain, setDeletingDomain] = useState<string | null>(null);
	const [deletingAll, setDeletingAll] = useState(false);
	const [showRestartDialog, setShowRestartDialog] = useState(false);
	const [cookiesBeforeBrowser, setCookiesBeforeBrowser] = useState<number>(0);

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
	}, []);

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

								if (newCookieCount !== currentCookieCount) {
									// Cookies have changed, show restart dialog
									setShowRestartDialog(true);
								} else {
									toast.info("Browser closed, no cookie changes detected");
								}
							}
						}
					} catch (error) {
						// Browser might be closed
						clearInterval(checkInterval);
						await handleLoadCookies();
					}
				}, 2000); // Check every 2 seconds
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
				if (domains.length > 0) {
					toast.success(`Loaded ${domains.length} cookie domains`);
				} else {
					toast.info(response.message || "No cookies found");
				}
			} else {
				setCookieDomains([]);
				toast.info("No cookies found");
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

			// Show restart dialog after successful deletion
			setShowRestartDialog(true);
		} catch (error: any) {
			toast.error(error?.message || `Failed to delete cookies for ${mainDomain}`);
		} finally {
			setDeletingDomain(null);
		}
	};

	const handleDeleteAll = async () => {
		setDeletingAll(true);
		try {
			await fetchDelete("/browser/cookies");
			toast.success("Deleted all cookies");
			setCookieDomains([]);

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
		<div className="max-w-[900px] h-auto m-auto flex flex-col px-20 pb-40 pt-8">
			{/* Restart Dialog */}
			<AlertDialog
				isOpen={showRestartDialog}
				onClose={() => setShowRestartDialog(false)}
				onConfirm={handleConfirmRestart}
				title="Cookies Updated"
				message="Cookies have been updated. Would you like to restart the application to use the new cookies?"
				confirmText="Yes, Restart"
				cancelText="No, Later"
			/>

			{/* Title and Restart Button */}
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-heading-lg font-bold text-text-heading">Browser Management</h2>
				<Button
					variant="outline"
					size="sm"
					onClick={handleRestartApp}
				>
					<RotateCw className="w-4 h-4" />
					Restart to Apply Changes
				</Button>
			</div>

			<div className="flex flex-col gap-6">
				{/* Browser Login Card */}
				<div className="flex flex-col gap-4 p-6 border border-border-secondary rounded-lg bg-bg-surface-primary">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-lg bg-bg-fill-browser-default flex items-center justify-center">
							<Globe className="w-5 h-5 text-bg-fill-browser-active" />
						</div>
						<div className="flex flex-col gap-1">
							<h3 className="text-body-lg font-bold text-text-heading">
								Browser Login
							</h3>
							<p className="text-body-sm text-text-label">
								Open a dedicated browser for website logins. Your login sessions will be saved and reused by Eigent agents.
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							onClick={handleBrowserLogin}
							disabled={loginLoading}
						>
							<Globe className="w-4 h-4" />
							{loginLoading ? "Opening..." : "Open Browser"}
						</Button>
					</div>
				</div>

				{/* Cookies Card */}
				<div className="flex flex-col gap-4 p-6 border border-border-secondary rounded-lg bg-bg-surface-primary">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-lg bg-bg-fill-multimodal-default flex items-center justify-center">
							<Cookie className="w-5 h-5 text-bg-fill-multimodal-active" />
						</div>
						<div className="flex flex-col gap-1 flex-1">
							<h3 className="text-body-lg font-bold text-text-heading">
								Cookies
							</h3>
							<p className="text-body-sm text-text-label">
								View and manage cookies from your browser login sessions.
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							onClick={handleLoadCookies}
							disabled={cookiesLoading}
						>
							<RefreshCw className={`w-4 h-4 ${cookiesLoading ? 'animate-spin' : ''}`} />
							{cookiesLoading ? "Loading..." : "Load Cookies"}
						</Button>
						{cookieDomains.length > 0 && (
							<Button
								variant="warning"
								size="sm"
								onClick={handleDeleteAll}
								disabled={deletingAll}
							>
								<Trash2 className="w-4 h-4" />
								{deletingAll ? "Deleting..." : "Delete All"}
							</Button>
						)}
					</div>
					{cookieDomains.length > 0 && (
						<div className="flex flex-col gap-3 mt-2">
							<p className="text-body-sm font-semibold text-text-heading">
								Cookie Domains ({groupDomainsByMain(cookieDomains).length}):
							</p>
							<div className="max-h-[500px] overflow-y-auto flex flex-col gap-2 border-2 border-border-secondary rounded-lg p-3 shadow-md bg-white">
								{groupDomainsByMain(cookieDomains).map((group, index) => (
									<div
										key={index}
										className="flex items-center justify-between px-4 py-3 bg-bg-surface-secondary rounded-lg hover:bg-bg-surface-tertiary transition-colors border border-border-disabled shadow-sm"
									>
										<div className="flex items-center gap-3 flex-1 min-w-0">
											<span className="text-sm text-text-heading font-semibold truncate">
												{group.mainDomain}
											</span>
											<span className="text-xs text-text-label px-2 py-1 bg-bg-surface-tertiary rounded">
												{group.totalCookies} cookie{group.totalCookies !== 1 ? 's' : ''}
											</span>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleDeleteMainDomain(group.mainDomain, group.subdomains)}
											disabled={deletingDomain === group.mainDomain}
											className="ml-3 flex-shrink-0"
										>
											<Trash2 className="w-4 h-4 text-text-danger" />
										</Button>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
