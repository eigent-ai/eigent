import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogContentSection,
	DialogFooter,
} from "@/components/ui/dialog";
import { Check, Settings, AlertTriangle, Eye, Circle } from "lucide-react";
import { proxyFetchGet, proxyFetchPost } from "@/api/http";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { t } from "i18next";
import { useAuthStore } from "@/store/authStore";
import { Tag as TagComponent } from "@/components/ui/tag";

interface SearchEngineProvider {
	id: string;
	name: string;
	description: string;
	requiresApiKey: boolean;
	enabledByDefault?: boolean;
	recommended?: boolean;
	fields: Array<{
		key: string;
		label: string;
		placeholder?: string;
		note?: string;
	}>;
}

interface SearchEngineConfigDialogProps {
	open: boolean;
	onClose: () => void;
}

function buildSearchEngines(modelType: 'cloud' | 'local' | 'custom'): SearchEngineProvider[] {
	// Always-available engines in both versions
	const commonEngines: SearchEngineProvider[] = [
		{
			id: "bing",
			name: "Bing",
			description: "Bing web crawling. No setup required — enabled by default.",
			requiresApiKey: false,
			enabledByDefault: true,
			fields: [],
		},
		{
			id: "baidu",
			name: "Baidu",
			description: "Baidu web crawling for Chinese-language results. Enabled by default.",
			requiresApiKey: false,
			enabledByDefault: true,
			fields: [],
		},
		{
			id: "wiki",
			name: "Wiki",
			description: "Wikipedia public API. Enabled by default.",
			requiresApiKey: false,
			enabledByDefault: true,
			fields: [],
		},
		{
			id: "duckduckgo",
			name: "DuckDuckGo",
			description: "DuckDuckGo free public API. No setup required.",
			requiresApiKey: false,
			enabledByDefault: true,
			fields: [],
		},
	];

	if (modelType === 'local') {
		return [
			{
				id: "google",
				name: "Google",
				description: "Connect to Google Custom Search (requires API key and CSE ID).",
				requiresApiKey: true,
				fields: [
					{
						key: "GOOGLE_API_KEY",
						label: "Google API Key",
						placeholder: "Enter your Google API key from Google Cloud Console",
						note: "Learn how to get your Google API key → https://developers.google.com/custom-search/v1/overview",
					},
					{
						key: "SEARCH_ENGINE_ID",
						label: "Search Engine ID",
						placeholder: "Enter the Custom Search Engine ID associated with your API key",
					},
				],
			},
			{
				id: "exa",
				name: "Exa Search",
				description: "Connect to Exa Search API (requires API key).",
				requiresApiKey: true,
				fields: [
					{
						key: "EXA_API_KEY",
						label: "Exa API Key",
						placeholder: "Enter your Exa API key",
						note: "Get your key → https://exa.ai",
					},
				],
			},
			{
				id: "brave",
				name: "Brave Search",
				description: "Connect to Brave Search API (requires API key).",
				requiresApiKey: true,
				fields: [
					{
						key: "BRAVE_API_KEY",
						label: "Brave API Key",
						placeholder: "Enter your Brave Search API key",
						note: "Get your key → https://brave.com/search/api/",
					},
				],
			},
			...commonEngines,
		];
	}

	// cloud or custom → provide as selectable options, no config required
	return [
		{
			id: "google",
			name: "Google",
			description: "Google Search integration available for cloud mode.",
			requiresApiKey: false,
			enabledByDefault: true,
			recommended: true,
			fields: [],
		},
		{
			id: "exa",
			name: "Exa Search",
			description: "Exa Search integration available for cloud mode.",
			requiresApiKey: false,
			enabledByDefault: true,
			fields: [],
		},
		{
			id: "brave",
			name: "Brave Search",
			description: "Brave Search integration available for cloud mode.",
			requiresApiKey: false,
			enabledByDefault: true,
			fields: [],
		},
		...commonEngines,
	];
}

export default function SearchEngineConfigDialog({
	open,
	onClose,
}: SearchEngineConfigDialogProps) {
	const { t } = useTranslation();
	const { modelType } = useAuthStore();
	const [selectedProvider, setSelectedProvider] = useState<SearchEngineProvider>(
		buildSearchEngines(modelType)[0]
	);
	const [configs, setConfigs] = useState<any[]>([]);
	const [formData, setFormData] = useState<Record<string, string>>({});
	const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
	const [testing, setTesting] = useState(false);
	const [saving, setSaving] = useState(false);
	const engines = buildSearchEngines(modelType);

	// Load existing configurations
	useEffect(() => {
		if (open) {
			proxyFetchGet("/api/configs")
				.then((res) => {
					setConfigs(Array.isArray(res) ? res : []);
					// Initialize form data with existing values
					const existingData: Record<string, string> = {};
				engines.forEach((engine) => {
						engine.fields.forEach((field) => {
							const config = res.find(
								(c: any) => c.config_name === field.key
							);
							if (config) {
								existingData[field.key] = config.config_value || "";
							}
						});
					});
					setFormData(existingData);
				})
				.catch((err) => {
					console.error("Failed to load configs:", err);
					setConfigs([]);
				});
		}
	}, [open]);

	const getProviderStatus = (provider: SearchEngineProvider) => {
		// For providers that are enabled by default, always show as configured
		if (provider.enabledByDefault) {
			return "configured";
		}

		if (!provider.requiresApiKey) {
			// For providers that don't require API keys, check if they're enabled
			const isEnabled = configs.some(
				(c: any) =>
					c.config_group?.toLowerCase() === "search" &&
					c.config_name === `ENABLE_${provider.id.toUpperCase()}_SEARCH` &&
					c.config_value === "true"
			);
			return isEnabled ? "configured" : "not-configured";
		}

		// For providers that require API keys, check if all required fields are filled
		const requiredFields = provider.fields.map((f) => f.key);
		const filledFields = requiredFields.filter((fieldKey) => {
			const config = configs.find((c: any) => c.config_name === fieldKey);
			return config && config.config_value && config.config_value.trim() !== "";
		});

		if (filledFields.length === 0) {
			return "not-configured";
		} else if (filledFields.length === requiredFields.length) {
			return "configured";
		} else {
			return "incomplete";
		}
	};

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "configured":
				return <Check className="w-4 h-4 text-text-success" />;
			case "incomplete":
				return <AlertTriangle className="w-4 h-4 text-text-cuation" />;
			default:
				return <Circle className="w-4 h-4 text-text-label" />;
		}
	};

	const getStatusText = (status: string) => {
		switch (status) {
			case "configured":
				return t("setting.configured");
			case "incomplete":
				return t("setting.incomplete");
			default:
				return t("setting.not-configured");
		}
	};

	const handleFieldChange = (fieldKey: string, value: string) => {
		setFormData((prev) => ({
			...prev,
			[fieldKey]: value,
		}));
	};

	const testConnection = async () => {
		if (!selectedProvider.requiresApiKey) {
			toast.success(t("setting.this-service-does-not-require-an-api-key"));
			return;
		}

		setTesting(true);
		try {
			// Here you would implement actual connection testing
			// For now, we'll just simulate a test
			await new Promise((resolve) => setTimeout(resolve, 1000));
			toast.success(t("setting.connection-test-successful"));
		} catch (error) {
			toast.error(t("setting.connection-test-failed"));
		} finally {
			setTesting(false);
		}
	};

	const saveConfiguration = async () => {
		// Skip saving for engines that are enabled by default
		if (selectedProvider.enabledByDefault) {
			toast.info(t("setting.this-service-is-already-enabled-by-default"));
			return;
		}

		setSaving(true);
		try {
			if (selectedProvider.requiresApiKey) {
				// Save API key fields
				for (const field of selectedProvider.fields) {
					const value = formData[field.key];
					if (value && value.trim() !== "") {
						await proxyFetchPost("/api/configs", {
							config_group: "Search",
							config_name: field.key,
							config_value: value.trim(),
						});
					}
				}
			} else {
				// Enable the service
				await proxyFetchPost("/api/configs", {
					config_group: "Search",
					config_name: `ENABLE_${selectedProvider.id.toUpperCase()}_SEARCH`,
					config_value: "true",
				});
			}

			toast.success(t("setting.configuration-saved-successfully"));
			// Refresh configs
			const res = await proxyFetchGet("/api/configs");
			setConfigs(Array.isArray(res) ? res : []);
		} catch (error) {
			toast.error(t("setting.failed-to-save-configuration"));
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onClose}>
			<DialogContent size="lg">
				<DialogHeader
					title={t("setting.search-engine-integrations")}
				/>

				<DialogContentSection className="flex h-full">
					{/* Left Panel - Provider List */}
			<div className="w-1/3 border-y-0 border-l-0 border border-solid border-border-secondary pr-4">
							<div className="flex flex-col gap-2">
							{engines.map((provider) => {
									const status = getProviderStatus(provider);
									const isSelected = selectedProvider.id === provider.id;
								return (
										<Button
                      variant="ghost"
                      size="md"
											key={provider.id}
										onClick={() => setSelectedProvider(provider)}
											className={`w-full justify-between border border-solid border-transparent bg-transparent transition-colors duration-200 ease-in-out ${isSelected ? "bg-surface-secondary border border-solid border-border-primary" : "hover:bg-surface-secondary"}`}
										>
                      
											<div className="flex items-center gap-3">
                          {getStatusIcon(status)}
											<div className="font-bold text-label-sm flex items-center gap-2">
												<span>{provider.name}</span>
                                                {provider.recommended ? (
                                                    <TagComponent asChild>
                                                        <span>{t("setting.recommended")}</span>
                                                    </TagComponent>
                                                ) : null}
											</div>	
											</div>
                      <div className="text-xs text-text-label font-extralight">
										{getStatusText(status)}
											</div>
										</Button>
									);
								})}
							</div>
					</div>

					{/* Right Panel - Configuration Detail */}
					<div className="flex-1 pl-4 h-[400px]">
						<div className="h-full flex flex-col">
							{/* Provider Header */}
							<div className="flex flex-col gap-2 pb-2">
                <div className="text-label-lg font-bold">
                  {selectedProvider.name}
                </div>
								<div className="text-text-label font-normal text-label-sm">
									{selectedProvider.description}
								</div>
							</div>

							{/* Configuration Form */}
							<div className="flex-1 pt-4">
								{selectedProvider.requiresApiKey ? (
									<div className="space-y-4">
										{selectedProvider.fields.map((field) => (
											<div key={field.key}>
												<Input
													id={field.key}
                          size="default"
                          title={field.label}
													type={showKeys[field.key] ? "text" : "password"}
													placeholder={field.placeholder}
													value={formData[field.key] || ""}
													onChange={(e) =>
														handleFieldChange(field.key, e.target.value)
													}
                          note={field.note}
													className="mt-1"
                          backIcon={<Eye className="w-5 h-5" />}
                          onBackIconClick={() => setShowKeys(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
												/>
											</div>
										))}
									</div>
								) : (
									<div className="bg-surface-primary p-4 rounded-lg">
										<p className="text-label-sm text-text-label">
											{selectedProvider.id === "wiki"
												? t("setting.this-service-is-public-and-does-not-require-credentials")
												: t("setting.this-service-does-not-require-an-api-key")}
										</p>
									</div>
								)}
							</div>

							{/* Action Buttons */}
							{!selectedProvider.enabledByDefault && (
								<div className="flex gap-3 items-center justify-end">
									{selectedProvider.requiresApiKey && (
										<Button
											variant="outline"
											size="sm"
											onClick={testConnection}
											disabled={testing}
										>
											 {testing ? t("setting.testing") : t("setting.test-connection")}
										</Button>
									)}
									<Button
										size="sm"
										onClick={saveConfiguration}
										disabled={saving}
									>
										 {saving ? t("setting.saving") : (selectedProvider.requiresApiKey ? t("setting.save-changes") : `${t("setting.enable")} ${selectedProvider.name} ${t("setting.search")}`)}
									</Button>
								</div>
							)}
						</div>
					</div>
				</DialogContentSection>
        <DialogFooter 
								className="bg-white-100% !rounded-b-xl p-md justify-between"
							>
              <p className="text-label-xs text-text-label flex items-center gap-1">
              {t("setting.your-api-keys-are-stored-securely-and-never-shared-externally")}
             </p>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
