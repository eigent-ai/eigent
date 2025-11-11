import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchGet, fetchDelete } from "@/api/http";
import { toast } from "sonner";
import {
	Trash2,
	Search,
	Cookie,
	RefreshCw,
	AlertTriangle
} from "lucide-react";
import { useTranslation } from "react-i18next";

interface CookieDomain {
	domain: string;
	cookie_count: number;
	last_access: string;
}

export default function CookieManager() {
	const { t } = useTranslation();
	const [domains, setDomains] = useState<CookieDomain[]>([]);
	const [filteredDomains, setFilteredDomains] = useState<CookieDomain[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [isDeleting, setIsDeleting] = useState<string | null>(null);

	const loadCookies = async () => {
		try {
			setIsLoading(true);
			const response = await fetchGet("/browser/cookies");

			if (response.success) {
				setDomains(response.domains || []);
				setFilteredDomains(response.domains || []);
			} else {
				toast.error(t("setting.failed-to-load-cookies"));
			}
		} catch (error) {
			console.error("Error loading cookies:", error);
			toast.error(t("setting.failed-to-load-cookies"));
		} finally {
			setIsLoading(false);
		}
	};

	useEffect(() => {
		loadCookies();
	}, []);

	useEffect(() => {
		if (searchQuery) {
			const filtered = domains.filter(domain =>
				domain.domain.toLowerCase().includes(searchQuery.toLowerCase())
			);
			setFilteredDomains(filtered);
		} else {
			setFilteredDomains(domains);
		}
	}, [searchQuery, domains]);

	const handleDeleteDomain = async (domain: string) => {
		try {
			setIsDeleting(domain);
			const response = await fetchDelete(`/browser/cookies/${domain}`);

			if (response.success) {
				toast.success(t("setting.cookies-deleted-successfully", { domain }));
				// Reload the list
				await loadCookies();
			} else {
				toast.error(t("setting.failed-to-delete-cookies"));
			}
		} catch (error) {
			console.error("Error deleting cookies:", error);
			toast.error(t("setting.failed-to-delete-cookies"));
		} finally {
			setIsDeleting(null);
		}
	};

	const handleDeleteAll = async () => {
		if (!window.confirm(t("setting.confirm-delete-all-cookies"))) {
			return;
		}

		try {
			setIsLoading(true);
			const response = await fetchDelete("/browser/cookies");

			if (response.success) {
				toast.success(t("setting.all-cookies-deleted"));
				setDomains([]);
				setFilteredDomains([]);
			} else {
				toast.error(t("setting.failed-to-delete-cookies"));
			}
		} catch (error) {
			console.error("Error deleting all cookies:", error);
			toast.error(t("setting.failed-to-delete-cookies"));
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="px-6 py-4 bg-surface-secondary rounded-2xl">
			<div className="flex items-center justify-between mb-4">
				<div>
					<div className="text-base font-bold leading-12 text-text-primary flex items-center gap-2">
						<Cookie className="w-5 h-5" />
						{t("setting.cookie-manager")}
					</div>
					<div className="text-sm leading-13 text-text-secondary mt-1">
						{t("setting.cookie-manager-description")}
					</div>
				</div>
				<div className="flex gap-2">
					<Button
						onClick={loadCookies}
						variant="outline"
						size="sm"
						disabled={isLoading}
					>
						<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
						{t("setting.refresh")}
					</Button>
					{domains.length > 0 && (
						<Button
							onClick={handleDeleteAll}
							variant="outline"
							size="sm"
							disabled={isLoading}
							className="text-red-600 hover:text-red-700"
						>
							<Trash2 className="w-4 h-4" />
							{t("setting.delete-all")}
						</Button>
					)}
				</div>
			</div>

			{/* Search Bar */}
			<div className="relative mb-4">
				<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-tertiary" />
				<Input
					type="text"
					placeholder={t("setting.search-domains")}
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="pl-10"
				/>
			</div>

			{/* Cookie List */}
			<div className="space-y-2">
				{isLoading ? (
					<div className="text-center py-8 text-text-secondary">
						<RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
						{t("setting.loading-cookies")}
					</div>
				) : filteredDomains.length === 0 ? (
					<div className="text-center py-8 text-text-secondary">
						<Cookie className="w-12 h-12 mx-auto mb-3 opacity-30" />
						<div className="text-base font-medium mb-1">
							{domains.length === 0
								? t("setting.no-cookies-found")
								: t("setting.no-matching-domains")}
						</div>
						{domains.length === 0 && (
							<div className="text-sm">
								{t("setting.login-to-save-cookies")}
							</div>
						)}
					</div>
				) : (
					filteredDomains.map((item) => (
						<div
							key={item.domain}
							className="flex items-center justify-between p-3 bg-surface-primary rounded-lg border border-border-primary hover:border-border-secondary transition-colors"
						>
							<div className="flex-1 min-w-0">
								<div className="font-medium text-text-primary truncate">
									{item.domain}
								</div>
								<div className="text-xs text-text-tertiary mt-1 flex items-center gap-3">
									<span>
										{t("setting.cookies-count", { count: item.cookie_count })}
									</span>
									<span>
										{t("setting.last-access")}: {item.last_access}
									</span>
								</div>
							</div>
							<Button
								onClick={() => handleDeleteDomain(item.domain)}
								variant="outline"
								size="xs"
								disabled={isDeleting === item.domain}
								className="ml-3 text-red-600 hover:text-red-700"
							>
								<Trash2 className="w-3 h-3" />
								{isDeleting === item.domain
									? t("setting.deleting")
									: t("setting.delete")}
							</Button>
						</div>
					))
				)}
			</div>

			{/* Warning */}
			{domains.length > 0 && (
				<div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
					<div className="flex items-start gap-2">
						<AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
						<div className="text-xs text-yellow-800 dark:text-yellow-200">
							{t("setting.cookie-delete-warning")}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
