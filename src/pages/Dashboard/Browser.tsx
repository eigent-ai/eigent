import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Globe, Cookie, Trash2, RefreshCw, RotateCw, Plus, EllipsisVertical } from "lucide-react";
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
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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
