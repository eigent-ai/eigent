// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Circle,
	Settings,
	ChevronUp,
	ChevronDown,
	ChevronRight,
	Eye,
	EyeOff,
	Info,
	RotateCcw,
	Loader2,
	Check,
	Cloud,
	Key,
	Server,
} from "lucide-react";
import { INIT_PROVODERS } from "@/lib/llm";
import { Provider } from "@/types";
import {
	proxyFetchPost,
	proxyFetchGet,
	proxyFetchPut,
	proxyFetchDelete,
	fetchPost,
} from "@/api/http";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectValue,
} from "@/components/ui/select";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthStore } from "@/store/authStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Import model images
import openaiImage from "@/assets/model/openai.svg";
import anthropicImage from "@/assets/model/anthropic.svg";
import geminiImage from "@/assets/model/gemini.svg";
import openrouterImage from "@/assets/model/openrouter.svg";
import qwenImage from "@/assets/model/qwen.svg";
import deepseekImage from "@/assets/model/deepseek.svg";
import minimaxImage from "@/assets/model/minimax.svg";
import zaiImage from "@/assets/model/zai.svg";
import moonshotImage from "@/assets/model/moonshot.svg";
import modelarkImage from "@/assets/model/modelark.svg";
import bedrockImage from "@/assets/model/bedrock.svg";
import azureImage from "@/assets/model/azure.svg";
import ollamaImage from "@/assets/model/ollama.svg";
import vllmImage from "@/assets/model/vllm.svg";
import sglangImage from "@/assets/model/sglang.svg";
import lmstudioImage from "@/assets/model/lmstudio.svg";
import eigentImage from "@/assets/model/eigent.svg";

const LOCAL_PROVIDER_NAMES = ["ollama", "vllm", "sglang", "lmstudio"];

// Sidebar tab types
type SidebarTab = 
	| "cloud" 
	| "byok" 
	| `byok-${string}` 
	| "local" 
	| "local-ollama" 
	| "local-vllm" 
	| "local-sglang" 
	| "local-lmstudio";

export default function SettingModels() {
	const { modelType, cloud_model_type, setModelType, setCloudModelType } =
		useAuthStore();
	const navigate = useNavigate();
	const { t } = useTranslation();
	const getValidateMessage = (res: any) =>
		res?.message ??
		res?.detail?.message ??
		res?.detail?.error?.message ??
		res?.error?.message ??
		t("setting.validate-failed");
	const [items, setItems] = useState<Provider[]>(
		INIT_PROVODERS.filter((p) => p.id !== "local")
	);
	const [form, setForm] = useState(() =>
		INIT_PROVODERS.filter((p) => p.id !== "local").map((p) => ({
			apiKey: p.apiKey,
			apiHost: p.apiHost,
			is_valid: p.is_valid ?? false,
			model_type: p.model_type ?? "",
			externalConfig: p.externalConfig
				? p.externalConfig.map((ec) => ({ ...ec }))
				: undefined,
			provider_id: p.provider_id ?? undefined,
			prefer: p.prefer ?? false,
		}))
	);
	const [showApiKey, setShowApiKey] = useState(() =>
		INIT_PROVODERS.filter((p) => p.id !== "local").map(() => false)
	);
	const [loading, setLoading] = useState<number | null>(null);
	const [errors, setErrors] = useState<
		{ apiKey?: string; apiHost?: string; model_type?: string; externalConfig?: string }[]
	>(() =>
		INIT_PROVODERS.filter((p) => p.id !== "local").map(() => ({
			apiKey: "",
			apiHost: "",
		}))
	);
	const [collapsed, setCollapsed] = useState(false);

	// Sidebar selected tab - default to cloud
	const [selectedTab, setSelectedTab] = useState<SidebarTab>("cloud");
	
	// BYOK accordion state
	const [byokCollapsed, setByokCollapsed] = useState(false);
	
	// Local Model accordion state
	const [localCollapsed, setLocalCollapsed] = useState(false);

	// Cloud Model
	const [cloudPrefer, setCloudPrefer] = useState(false);

	// Local Model independent state - per platform
	const [localEnabled, setLocalEnabled] = useState(true);
	const [localPlatform, setLocalPlatform] = useState("ollama");
	const [localEndpoints, setLocalEndpoints] = useState<Record<string, string>>({});
	const [localTypes, setLocalTypes] = useState<Record<string, string>>({});
	const [localProviderIds, setLocalProviderIds] = useState<Record<string, number | undefined>>({});
	const [localVerifying, setLocalVerifying] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [localInputError, setLocalInputError] = useState(false);
	const [localPrefer, setLocalPrefer] = useState(false); // Local model prefer state (for current platform)

	// Default model dropdown state (removed - using DropdownMenu's built-in state)

	// Pending model to set as default after configuration
	const [pendingDefaultModel, setPendingDefaultModel] = useState<{
		category: "cloud" | "custom" | "local";
		modelId: string;
	} | null>(null);

	// Load provider list and populate form
	useEffect(() => {
		(async () => {
			try {
				const res = await proxyFetchGet("/api/providers");
				const providerList = Array.isArray(res) ? res : res.items || [];
				// Handle custom models
				setForm((f) =>
					f.map((fi, idx) => {
						const item = items[idx];
						const found = providerList.find(
							(p: any) => p.provider_name === item.id
						);
						if (found) {
							return {
								...fi,
								provider_id: found.id,
								apiKey: found.api_key || "",
								apiHost: found.endpoint_url || "",
								is_valid: !!found?.is_valid,
								prefer: found.prefer ?? false,
								model_type: found.model_type ?? "",
								externalConfig: fi.externalConfig
									? fi.externalConfig.map((ec) => {
										if (
											found.encrypted_config &&
											found.encrypted_config[ec.key] !== undefined
										) {
											return { ...ec, value: found.encrypted_config[ec.key] };
										}
										return ec;
									})
									: undefined,
							};
						}
						return fi;
					})
				);
				// Handle local models - load all local providers per platform
				const localProviders = providerList.filter(
					(p: any) => LOCAL_PROVIDER_NAMES.includes(p.provider_name)
				);
				
				const endpoints: Record<string, string> = {};
				const types: Record<string, string> = {};
				const providerIds: Record<string, number | undefined> = {};
				
				localProviders.forEach((local: any) => {
					const platform = local.encrypted_config?.model_platform || local.provider_name;
					endpoints[platform] = local.endpoint_url || "";
					types[platform] = local.encrypted_config?.model_type || "";
					providerIds[platform] = local.id;
					
					// Set prefer state if any local model is preferred
					if (local.prefer) {
						setLocalPrefer(true);
						setLocalPlatform(platform);
					}
				});
				
				setLocalEndpoints(endpoints);
				setLocalTypes(types);
				setLocalProviderIds(providerIds);
				
				// If no local providers found, initialize empty state
				if (localProviders.length === 0) {
					LOCAL_PROVIDER_NAMES.forEach(platform => {
						endpoints[platform] = "";
						types[platform] = "";
						providerIds[platform] = undefined;
					});
					setLocalEndpoints(endpoints);
					setLocalTypes(types);
					setLocalProviderIds(providerIds);
				}
				if (modelType === "cloud") {
					setCloudPrefer(true);
					setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
					setLocalPrefer(false);
				} else if (modelType === "local") {
					setLocalEnabled(true);
					setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
					setLocalPrefer(true);
					setCloudPrefer(false);
				} else {
					setLocalPrefer(false);
					setCloudPrefer(false);
				}
			} catch (e) {
				// ignore error
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps
		if (import.meta.env.VITE_USE_LOCAL_PROXY !== "true") {
			fetchSubscription();
			updateCredits();
		}
	}, []);


	// Get current default model display text
	const getDefaultModelDisplayText = (): string => {
		if (cloudPrefer) {
			const cloudModel = cloudModelOptions.find(m => m.id === cloud_model_type);
			const modelName = cloudModel ? cloudModel.name : cloud_model_type.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			return `Cloud / ${modelName}`;
		}
		
		// Check for custom model preference
		const preferredIdx = form.findIndex(f => f.prefer);
		if (preferredIdx !== -1) {
			const item = items[preferredIdx];
			const modelType = form[preferredIdx].model_type || "";
			return `Custom / ${item.name}${modelType ? ` (${modelType})` : ""}`;
		}
		
		// Check for local model preference
		if (localPrefer && localPlatform) {
			const localModel = localModelOptions.find(m => m.id === localPlatform);
			const platformName = localModel ? localModel.name : 
				localPlatform === "ollama" ? "Ollama" : 
				localPlatform === "vllm" ? "vLLM" : 
				localPlatform === "sglang" ? "SGLang" : "LM Studio";
			const modelType = localTypes[localPlatform] || "";
			return `Local / ${platformName}${modelType ? ` (${modelType})` : ""}`;
		}
		
		return t("setting.select-default-model");
	};

	// Check if a model is configured
	const isModelConfigured = (category: "cloud" | "custom" | "local", modelId: string): boolean => {
		if (category === "cloud") {
			return import.meta.env.VITE_USE_LOCAL_PROXY !== "true";
		}
		if (category === "custom") {
			const idx = items.findIndex(item => item.id === modelId);
			return idx !== -1 && !!form[idx]?.provider_id;
		}
		if (category === "local") {
			return !!localEndpoints[modelId];
		}
		return false;
	};

	// Handle model selection from dropdown
	const handleDefaultModelSelect = async (category: "cloud" | "custom" | "local", modelId: string) => {
		const configured = isModelConfigured(category, modelId);

		if (!configured) {
			// Store pending model to set as default after configuration
			setPendingDefaultModel({ category, modelId });
			
			// Navigate to the appropriate tab for configuration
			if (category === "cloud") {
				setSelectedTab("cloud");
			} else if (category === "custom") {
				setSelectedTab(`byok-${modelId}` as SidebarTab);
				// Expand BYOK section if collapsed
				if (byokCollapsed) setByokCollapsed(false);
			} else if (category === "local") {
				setSelectedTab(`local-${modelId}` as SidebarTab);
				// Expand Local section if collapsed
				if (localCollapsed) setLocalCollapsed(false);
			}
			return;
		}

		// Model is configured, set it as default
		await setModelAsDefault(category, modelId);
	};

	// Set a model as the default
	const setModelAsDefault = async (category: "cloud" | "custom" | "local", modelId: string) => {
		if (category === "cloud") {
			setLocalPrefer(false);
			setActiveModelIdx(null);
			setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
			setCloudPrefer(true);
			setModelType("cloud");
			if (modelId !== "cloud") {
				setCloudModelType(modelId as any);
			}
		} else if (category === "custom") {
			const idx = items.findIndex(item => item.id === modelId);
			if (idx !== -1) {
				await handleSwitch(idx, true);
			}
		} else if (category === "local") {
			// Update local platform if different
			if (localPlatform !== modelId) {
				setLocalPlatform(modelId);
			}
			const providerId = localProviderIds[modelId];
			await handleLocalSwitch(true, providerId);
		}
		setPendingDefaultModel(null);
	};

	// Cloud model options
	const cloudModelOptions = [
		{ id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
		{ id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
		{ id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
		{ id: "gpt-4.1", name: "GPT-4.1" },
		{ id: "gpt-5", name: "GPT-5" },
		{ id: "gpt-5.1", name: "GPT-5.1" },
		{ id: "gpt-5.2", name: "GPT-5.2" },
		{ id: "gpt-5-mini", name: "GPT-5 Mini" },
		{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4-5" },
	];

	// Local model options
	const localModelOptions = [
		{ id: "ollama", name: "Ollama" },
		{ id: "vllm", name: "vLLM" },
		{ id: "sglang", name: "SGLang" },
		{ id: "lmstudio", name: "LM Studio" },
	];

	const handleVerify = async (idx: number) => {
		const { apiKey, apiHost, externalConfig, model_type, provider_id } =
			form[idx];
		let hasError = false;
		const newErrors = [...errors];
		if (items[idx].id !== "local") {
			if (!apiKey || apiKey.trim() === "") {
				newErrors[idx].apiKey = t("setting.api-key-can-not-be-empty");
				hasError = true;
			} else {
				newErrors[idx].apiKey = "";
			}
		}
		if (!apiHost || apiHost.trim() === "") {
			newErrors[idx].apiHost = t("setting.api-host-can-not-be-empty");
			hasError = true;
		} else {
			newErrors[idx].apiHost = "";
		}
		if (!model_type || model_type.trim() === "") {
			newErrors[idx].model_type = t("setting.model-type-can-not-be-empty");
			hasError = true;
		} else {
			newErrors[idx].model_type = "";
		}
		setErrors(newErrors);
		if (hasError) return;

		setLoading(idx);
		const item = items[idx];
		let external: any = {};
		if (form[idx]?.externalConfig) {
			form[idx]?.externalConfig.map((item) => {
				external[item.key] = item.value;
			});
		}

		console.log(form[idx]);
		try {
			const res = await fetchPost("/model/validate", {
				model_platform: item.id,
				model_type: form[idx].model_type,
				api_key: form[idx].apiKey,
				url: form[idx].apiHost,
				extra_params: external,
			});
			if (res.is_tool_calls && res.is_valid) {
				console.log("success");
				toast(t("setting.validate-success"), {
					description: t(
						"setting.the-model-has-been-verified-to-support-function-calling-which-is-required-to-use-eigent"
					),
					closeButton: true,
				});
			} else {
				console.log("failed", res.message);
				// Surface error inline on API Key input
				setErrors((prev) => {
					const next = [...prev];
					if (!next[idx]) next[idx] = {} as any;
					next[idx].apiKey = getValidateMessage(res);
					return next;
				});
				return;
			}
			console.log(res);
		} catch (e) {
			console.log(e);
			// Network/exception case: show inline error
			setErrors((prev) => {
				const next = [...prev];
				if (!next[idx]) next[idx] = {} as any;
				next[idx].apiKey = getValidateMessage(e);
				return next;
			});
			return;
		} finally {
			setLoading(null);
		}

		const data: any = {
			provider_name: item.id,
			api_key: form[idx].apiKey,
			endpoint_url: form[idx].apiHost,
			is_valid: form[idx].is_valid,
			model_type: form[idx].model_type,
		};
		if (externalConfig) {
			data.encrypted_config = {};
			externalConfig.forEach((ec) => {
				data.encrypted_config[ec.key] = ec.value;
			});
		}
		try {
			if (provider_id) {
				await proxyFetchPut(`/api/provider/${provider_id}`, data);
			} else {
				await proxyFetchPost("/api/provider", data);
			}
			// add: refresh provider list after saving, update form and switch editable status
			const res = await proxyFetchGet("/api/providers");
			const providerList = Array.isArray(res) ? res : res.items || [];
			setForm((f) =>
				f.map((fi, i) => {
					const item = items[i];
					const found = providerList.find(
						(p: any) => p.provider_name === item.id
					);
					if (found) {
						return {
							...fi,
							provider_id: found.id,
							apiKey: found.api_key || "",
							apiHost: found.endpoint_url || "",
							is_valid: !!found.is_valid,
							prefer: found.prefer ?? false,
							externalConfig: fi.externalConfig
								? fi.externalConfig.map((ec) => {
									if (
										found.encrypted_config &&
										found.encrypted_config[ec.key] !== undefined
									) {
										return { ...ec, value: found.encrypted_config[ec.key] };
									}
									return ec;
								})
								: undefined,
						};
					}
					return fi;
				})
			);
			
			// Check if this was a pending default model selection
			if (pendingDefaultModel && pendingDefaultModel.category === "custom" && pendingDefaultModel.modelId === item.id) {
				await handleSwitch(idx, true);
				setPendingDefaultModel(null);
			} else {
				handleSwitch(idx, true);
			}
		} finally {
			setLoading(null);
		}
	};

	// Local Model verification
	const handleLocalVerify = async () => {
		setLocalVerifying(true);
		setLocalError(null);
		setLocalInputError(false);
		const currentEndpoint = localEndpoints[localPlatform] || "";
		const currentType = localTypes[localPlatform] || "";
		
		if (!currentEndpoint) {
			setLocalError(t("setting.endpoint-url-can-not-be-empty"));
			setLocalInputError(true);
			setLocalVerifying(false);
			return;
		}
		try {
			// // 1. Check if endpoint returns response
			// let baseUrl = localEndpoint;
			// let testUrl = baseUrl;
			// let testMethod = "GET";
			// let testBody = undefined;

			// // Extract base URL if it contains specific endpoints
			// if (baseUrl.includes('/chat/completions')) {
			// 	baseUrl = baseUrl.replace('/chat/completions', '');
			// } else if (baseUrl.includes('/completions')) {
			// 	baseUrl = baseUrl.replace('/completions', '');
			// }

			// // Always test with chat completions endpoint for OpenAI-compatible APIs
			// testUrl = `${baseUrl}/chat/completions`;
			// testMethod = "POST";
			// testBody = JSON.stringify({
			// 	model: localType || "test",
			// 	messages: [{ role: "user", content: "test" }],
			// 	max_tokens: 1,
			// 	stream: false
			// });

			// const resp = await fetch(testUrl, {
			// 	method: testMethod,
			// 	headers: {
			// 		"Content-Type": "application/json",
			// 		"Authorization": "Bearer dummy"
			// 	},
			// 	body: testBody
			// });

			// if (!resp.ok) {
			// 	throw new Error("Endpoint is not responding");
			// }

			try {
				const res = await fetchPost("/model/validate", {
					model_platform: localPlatform,
					model_type: currentType,
					api_key: "not-required",
					url: currentEndpoint,
				});
				if (res.is_tool_calls && res.is_valid) {
					console.log("success");
					toast(t("setting.validate-success"), {
						description: t(
							"setting.the-model-has-been-verified-to-support-function-calling-which-is-required-to-use-eigent"
						),
						closeButton: true,
					});
				} else {
					console.log("failed", res.message);
					const toastId = toast(t("setting.validate-failed"), {
						description: getValidateMessage(res),
						action: {
							label: t("setting.close"),
							onClick: () => {
								toast.dismiss(toastId);
							},
						},
					});

					return;
				}
				console.log(res);
			} catch (e) {
				console.log(e);
				const toastId = toast(t("setting.validate-failed"), {
					description: getValidateMessage(e),
					action: {
						label: t("setting.close"),
						onClick: () => {
							toast.dismiss(toastId);
						},
					},
				});
				return;
			} finally {
				setLoading(null);
			}

			// 2. Save to /api/provider/ (save only base URL)
			const currentProviderId = localProviderIds[localPlatform];
			const data: any = {
				provider_name: localPlatform,
				api_key: "not-required",
				endpoint_url: currentEndpoint, // Save base URL without specific endpoints
				is_valid: true,
				model_type: currentType,
				encrypted_config: {
					model_platform: localPlatform,
					model_type: currentType,
				},
			};
			
			// Update or create provider
			if (currentProviderId) {
				await proxyFetchPut(`/api/provider/${currentProviderId}`, data);
			} else {
				await proxyFetchPost("/api/provider", data);
			}
			
			setLocalError(null);
			setLocalInputError(false);
			// add: refresh provider list after saving, update localProviderIds and localPrefer
			const res = await proxyFetchGet("/api/providers");
			const providerList = Array.isArray(res) ? res : res.items || [];
			const local = providerList.find(
				(p: any) => p.provider_name === localPlatform
			);
			if (local) {
				setLocalProviderIds(prev => ({ ...prev, [localPlatform]: local.id }));
				setLocalPrefer(local.prefer ?? false);
				
				// Check if this was a pending default model selection
				if (pendingDefaultModel && pendingDefaultModel.category === "local" && pendingDefaultModel.modelId === localPlatform) {
					await handleLocalSwitch(true, local.id);
					setPendingDefaultModel(null);
				} else {
					await handleLocalSwitch(true, local.id);
				}
			}
		} catch (e: any) {
			setLocalError(
				e.message || t("setting.verification-failed-please-check-endpoint-url")
			);
			setLocalInputError(true);
		} finally {
			setLocalVerifying(false);
		}
	};

	const [activeModelIdx, setActiveModelIdx] = useState<number | null>(null); // Current active model idx

	// Switch linkage logic: only one switch can be enabled
	useEffect(() => {
		if (activeModelIdx !== null) {
			setLocalEnabled(false);
		} else {
			setLocalEnabled(true);
		}
	}, [activeModelIdx]);
	useEffect(() => {
		if (localEnabled) {
			setActiveModelIdx(null);
		}
	}, [localEnabled]);

	const handleSwitch = async (idx: number, checked: boolean) => {
		if (!checked) {
			setActiveModelIdx(null);
			setLocalEnabled(true);
			return;
		}
		const hasSearchKey = await checkHasSearchKey();
		if (!hasSearchKey) {
			// Show warning toast instead of blocking
			toast(t("setting.warning-google-search-not-configured"), {
				description: t(
					"setting.search-functionality-may-be-limited-without-google-api"
				),
				closeButton: true,
			});
		}
		try {
			await proxyFetchPost("/api/provider/prefer", {
				provider_id: form[idx].provider_id,
			});
			setModelType("custom");
			setActiveModelIdx(idx);
			setLocalEnabled(false);
			setCloudPrefer(false);
			setForm((f) => f.map((fi, i) => ({ ...fi, prefer: i === idx }))); // Only one prefer allowed
			setLocalPrefer(false);
		} catch (e) {
			// Optional: add error message
		}
	};
	const handleLocalSwitch = async (checked: boolean, providerId?: number) => {
		if (!checked) {
			setLocalEnabled(false);
			setLocalPrefer(false);
			return;
		}
		const hasSearchKey = await checkHasSearchKey();
		if (!hasSearchKey) {
			// Show warning toast instead of blocking
			toast(t("setting.warning-google-search-not-configured"), {
				description: t(
					"setting.search-functionality-may-be-limited-without-google-api"
				),
				closeButton: true,
			});
		}
		try {
			const targetProviderId =
				providerId !== undefined ? providerId : localProviderIds[localPlatform];
			if (targetProviderId === undefined) return;
			await proxyFetchPost("/api/provider/prefer", {
				provider_id: targetProviderId,
			});
			setModelType("local");
			setLocalEnabled(true);
			setActiveModelIdx(null);
			setForm((f) => f.map((fi) => ({ ...fi, prefer: false }))); // Set all others' prefer to false
			setLocalPrefer(true);
			setCloudPrefer(false);
		} catch (e) {
			// Optional: add error message
		}
	};

	const handleLocalReset = async () => {
		try {
			const currentProviderId = localProviderIds[localPlatform];
			if (currentProviderId !== undefined) {
				await proxyFetchDelete(`/api/provider/${currentProviderId}`);
			}
			setLocalEndpoints(prev => ({ ...prev, [localPlatform]: "" }));
			setLocalTypes(prev => ({ ...prev, [localPlatform]: "" }));
			setLocalProviderIds(prev => ({ ...prev, [localPlatform]: undefined }));
			// Reset prefer state only if this platform was the preferred one
			if (localPrefer && localPlatform === localPlatform) {
				setLocalPrefer(false);
			}
			setLocalEnabled(true);
			setActiveModelIdx(null);
			toast.success(t("setting.reset-success"));
		} catch (e) {
			toast.error(t("setting.reset-failed"));
		}
	};
	const handleDelete = async (idx: number) => {
		try {
			const { provider_id } = form[idx];
			if (provider_id) {
				await proxyFetchDelete(`/api/provider/${provider_id}`);
			}
			// reset single form entry to default empty values
			setForm((prev) =>
				prev.map((fi, i) => {
					if (i !== idx) return fi;
					const item = items[i];
					return {
						apiKey: "",
						apiHost: "",
						is_valid: false,
						model_type: "",
						externalConfig: item.externalConfig
							? item.externalConfig.map((ec) => ({ ...ec, value: "" }))
							: undefined,
						provider_id: undefined,
						prefer: false,
					};
				})
			);
			setErrors((prev) =>
				prev.map((er, i) => (i === idx ? { apiKey: "", apiHost: "", model_type: "" } as any : er))
			);
			if (activeModelIdx === idx) {
				setActiveModelIdx(null);
				setLocalEnabled(true);
			}
			toast.success(t("setting.reset-success"));
		} catch (e) {
			toast.error(t("setting.reset-failed"));
		}
	};

	// removed bulk reset; only single-provider delete is supported

	const checkHasSearchKey = async () => {
		const configsRes = await proxyFetchGet("/api/configs");
		const configs = Array.isArray(configsRes) ? configsRes : [];
		console.log(configsRes, configs);
		const _hasApiKey = configs.find(
			(item) => item.config_name === "GOOGLE_API_KEY"
		);
		const _hasApiId = configs.find(
			(item) => item.config_name === "SEARCH_ENGINE_ID"
		);
		return _hasApiKey && _hasApiId;
	};

	const [subscription, setSubscription] = useState<any>(null);
	const fetchSubscription = async () => {
		const res = await proxyFetchGet("/api/subscription");
		console.log(res);
		if (res) {
			setSubscription(res);
		}
	};
	const [credits, setCredits] = useState<any>(0);
	const [loadingCredits, setLoadingCredits] = useState(false);
	const updateCredits = async () => {
		try {
			setLoadingCredits(true);
			const res = await proxyFetchGet(`/api/user/current_credits`);
			console.log(res?.credits);
			setCredits(res?.credits);
		} catch (error) {
			console.error(error);
		} finally {
			setLoadingCredits(false);
		}
	};

	// Helper to get model image based on model ID
	const getModelImage = (modelId: string | null): string | null => {
		if (!modelId) return null;
		const modelImageMap: Record<string, string> = {
			// Cloud version
			cloud: eigentImage,
			// Cloud models
			openai: openaiImage,
			anthropic: anthropicImage,
			gemini: geminiImage,
			openrouter: openrouterImage,
			"tongyi-qianwen": qwenImage,
			deepseek: deepseekImage,
			minimax: minimaxImage,
			"Z.ai": zaiImage,
			moonshot: moonshotImage,
			ModelArk: modelarkImage,
			"aws-bedrock": bedrockImage,
			azure: azureImage,
			"openai-compatible-model": openaiImage, // Use OpenAI icon as fallback
			// Local models
			ollama: ollamaImage,
			vllm: vllmImage,
			sglang: sglangImage,
			lmstudio: lmstudioImage,
			// Local model tab IDs
			"local-ollama": ollamaImage,
			"local-vllm": vllmImage,
			"local-sglang": sglangImage,
			"local-lmstudio": lmstudioImage,
		};
		return modelImageMap[modelId] || null;
	};

	// Helper to render sidebar tab item
	const renderSidebarItem = (
		tabId: SidebarTab,
		label: string,
		modelId: string | null,
		isActive: boolean,
		isSubItem: boolean = false,
		isConfigured: boolean = false
	) => {
		const modelImage = getModelImage(modelId);
		const fallbackIcon = modelId === "cloud" ? <Cloud className="w-5 h-5" /> : 
			modelId?.startsWith("local") ? <Server className="w-5 h-5" /> : 
			<Key className="w-5 h-5" />;

		return (
			<button
				key={tabId}
				onClick={() => setSelectedTab(tabId)}
				className={`
					w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all duration-200
					${isSubItem ? "pl-3" : ""}
					${isActive 
						? "bg-fill-fill-transparent-active" 
						: "bg-fill-fill-transparent hover:bg-fill-fill-transparent-hover"
					}
				`}
			>
				<div className="flex items-center justify-center gap-3">
					{modelImage ? (
						<img 
							src={modelImage} 
							alt={label}
							className="w-5 h-5"
						/>
					) : (
						<span className={isActive ? "text-text-body" : "text-text-label"}>
							{fallbackIcon}
						</span>
					)}
					<span className={`text-body-sm font-medium ${isActive ? "text-text-body" : "text-text-label"}`}>
						{label}
					</span>
				</div>
				{isConfigured && (
					<div className="w-2 h-2 m-1 rounded-full bg-text-success" />
				)}
			</button>
		);
	};

	// Render content based on selected tab
	const renderContent = () => {
		// Cloud version content
		if (selectedTab === "cloud") {
			if (import.meta.env.VITE_USE_LOCAL_PROXY === "true") {
				return (
					<div className="flex items-center justify-center h-64 text-text-label">
						Cloud version is not available in local proxy mode
					</div>
				);
			}
			return (
				<div className="w-full bg-surface-secondary rounded-2xl flex flex-col">
					<div className="self-stretch flex flex-col justify-start mx-6 pt-2 pb-4 mb-4 border-t-0 border-b-[0.5px] border-x-0 border-solid border-border-secondary">
						<div className="self-stretch inline-flex justify-start items-center gap-2">
							<div className="flex-1 justify-center text-body-base text-text-heading font-bold my-2">
								{t("setting.eigent-cloud")}
							</div>
							{cloudPrefer ? (
								<Button
									variant="success"
									size="xs"
									className="focus-none rounded-full"
									onClick={() => {
										setCloudPrefer(false);
										setModelType("custom");
									}}
								>
									Default
								</Button>
							) : (
								<Button
									variant="ghost"
									size="xs"
									className="!text-text-label rounded-full"
									onClick={() => {
										setLocalPrefer(false);
										setActiveModelIdx(null);
										setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
										setCloudPrefer(true);
										setModelType("cloud");
									}}
								>
									Set as Default
								</Button>
							)}
						</div>
						<div className="self-stretch justify-center">
							<span className="text-text-label text-body-sm">
								{t("setting.you-are-currently-subscribed-to-the")}{" "}
								{subscription?.plan_key?.charAt(0).toUpperCase() +
									subscription?.plan_key?.slice(1)}
								. {t("setting.discover-more-about-our")}{" "}
							</span>
							<span
								onClick={() => {
									window.location.href = `https://www.eigent.ai/pricing`;
								}}
								className="cursor-pointer text-text-label text-body-sm underline"
							>
								{t("setting.pricing-options")}
							</span>
							<span className="text-text-body text-label-sm font-normal">
								.
							</span>
						</div>
					</div>
					{/*Content Area*/}
					<div className="flex flex-row items-center justify-between gap-4 w-full px-6 pb-4">
					  <div className="text-text-body text-body-sm">
							{t("setting.credits")}:{" "}
							{loadingCredits ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								credits
							)}
						</div>
						<Button
							onClick={() => {
								window.location.href = `https://www.eigent.ai/dashboard`;
							}}
							variant="primary"
							size="sm"
						>
							{loadingCredits ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								subscription?.plan_key?.charAt(0).toUpperCase() +
								subscription?.plan_key?.slice(1)
							)}
							<Settings />
						</Button>
					</div>
					<div className="w-full flex items-center flex-1 justify-between px-6 pb-4">
						<div className="flex items-center flex-1 min-w-0">
							<span className="whitespace-nowrap overflow-hidden text-ellipsis text-body-sm">
								{t("setting.select-model-type")}
							</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="ml-1 cursor-pointer inline-flex items-center">
										<Info className="w-4 h-4 text-icon-secondary" />
									</span>
								</TooltipTrigger>
								<TooltipContent
									side="top"
									className="flex items-center justify-center text-center min-w-[220px] min-h-[40px]"
								>
									<span className="w-full flex items-center justify-center">
										{cloud_model_type === "gpt-4.1-mini"
											? t("setting.gpt-4.1-mini")
											: cloud_model_type === "gpt-4.1"
												? t("setting.gpt-4.1")
												: cloud_model_type === "claude-sonnet-4-5"
													? t("setting.claude-sonnet-4-5")
													: cloud_model_type === "gemini-3-pro-preview"
																? t("setting.gemini-3-pro-preview")
																: cloud_model_type === "gpt-5"
																	? t("setting.gpt-5")
																	: cloud_model_type === "gpt-5.1"
																		? t("setting.gpt-5")
																		: cloud_model_type === "gpt-5.2"
																			? t("setting.gpt-5")
																	: cloud_model_type === "gpt-5-mini"
																		? t("setting.gpt-5-mini")
																		: t("setting.gemini-3-flash-preview")}
									</span>
								</TooltipContent>
							</Tooltip>
						</div>
						<div className="flex-shrink-0">
							<Select
								value={cloud_model_type}
								onValueChange={setCloudModelType}
							>
								<SelectTrigger size="sm">
									<SelectValue placeholder="Select Model Type" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="gemini-3-pro-preview">Gemini 3 Pro Preview</SelectItem>
									<SelectItem value="gemini-3-flash-preview">Gemini 3 Flash Preview</SelectItem>
									<SelectItem value="gpt-4.1-mini">GPT-4.1 mini</SelectItem>
									<SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
									<SelectItem value="gpt-5">GPT-5</SelectItem>
									<SelectItem value="gpt-5.1">GPT-5.1</SelectItem>
									<SelectItem value="gpt-5.2">GPT-5.2</SelectItem>
									<SelectItem value="gpt-5-mini">GPT-5 mini</SelectItem>
									<SelectItem value="claude-sonnet-4-5">
										Claude Sonnet 4-5
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			);
		}

		// BYOK (Bring Your Own Key) content - show specific model
		if (selectedTab.startsWith("byok-")) {
			const modelId = selectedTab.replace("byok-", "");
			const idx = items.findIndex((item) => item.id === modelId);
			if (idx === -1) return null;
			
			const item = items[idx];
			const canSwitch = !!form[idx].provider_id;
			
			return (
				<div className="w-full bg-surface-secondary rounded-2xl flex flex-col">
					<div className="flex flex-col justify-between items-start mx-6 pt-2 pb-4 mb-4 border-t-0 border-b-[0.5px] border-x-0 border-solid border-border-secondary">
						<div className="self-stretch inline-flex justify-between items-center gap-2">
							<div className="flex items-center gap-2">
								<div className="text-body-base text-text-heading font-bold my-2">
									{item.name}
								</div>
								{form[idx].prefer ? (
									<Button
										variant="success"
										size="xs"
										className="focus-none rounded-full shadow-none"
										disabled={!canSwitch || loading === idx}
										onClick={() => handleSwitch(idx, false)}
									>
										Default
									</Button>
								) : (
									<Button
										variant="ghost"
										size="xs"
										disabled={!canSwitch || loading === idx}
										onClick={() => handleSwitch(idx, true)}
										className={canSwitch ? "!text-text-label rounded-full shadow-none bg-button-transparent-fill-hover" : ""}
									>
										{!canSwitch ? "Not Configured" : "Set as Default"}
									</Button>
								)}
							</div>
							{form[idx].provider_id ? (
								<div className="w-2 h-2 rounded-full bg-text-success" />
							) : (
								<div className="w-2 h-2 rounded-full bg-text-label opacity-10" />
							)}
						</div>
						<div className="text-body-sm text-text-label">
							{item.description}
						</div>
					</div>
					<div className="flex flex-col w-full items-center gap-4 px-6">
						{/* API Key Setting */}
						<Input
							id={`apiKey-${item.id}`}
							type={showApiKey[idx] ? "text" : "password"}
							size="default"
							title="API Key Setting"
							state={errors[idx]?.apiKey ? "error" : "default"}
							note={errors[idx]?.apiKey ?? undefined}
							placeholder={` ${t("setting.enter-your-api-key")} ${item.name
								} ${t("setting.key")}`}
							backIcon={showApiKey[idx] ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
							onBackIconClick={() =>
								setShowApiKey((arr) => arr.map((v, i) => (i === idx ? !v : v)))
							}
							value={form[idx].apiKey}
							onChange={(e) => {
								const v = e.target.value;
								setForm((f) =>
									f.map((fi, i) =>
										i === idx ? { ...fi, apiKey: v } : fi
									)
								);
								setErrors((errs) =>
									errs.map((er, i) =>
										i === idx ? { ...er, apiKey: "" } : er
									)
								);
							}}
						/>
						{/* API Host Setting */}
						<Input
							id={`apiHost-${item.id}`}
							size="default"
							title="API Host Setting"
							state={errors[idx]?.apiHost ? "error" : "default"}
							note={errors[idx]?.apiHost ?? undefined}
							placeholder={`${t("setting.enter-your-api-host")} ${item.name
								} ${t("setting.url")}`}
							value={form[idx].apiHost}
							onChange={(e) => {
								const v = e.target.value;
								setForm((f) =>
									f.map((fi, i) =>
										i === idx ? { ...fi, apiHost: v } : fi
									)
								);
								setErrors((errs) =>
									errs.map((er, i) =>
										i === idx ? { ...er, apiHost: "" } : er
									)
								);
							}}
						/>
						{/* Model Type Setting */}
						<Input
							id={`modelType-${item.id}`}
							size="default"
							title="Model Type Setting"
							state={errors[idx]?.model_type ? "error" : "default"}
							note={errors[idx]?.model_type ?? undefined}
							placeholder={`${t("setting.enter-your-model-type")} ${item.name
								} ${t("setting.model-type")}`}
							value={form[idx].model_type}
							onChange={(e) => {
								const v = e.target.value;
								setForm((f) =>
									f.map((fi, i) =>
										i === idx ? { ...fi, model_type: v } : fi
									)
								);
								setErrors((errs) =>
									errs.map((er, i) =>
										i === idx ? { ...er, model_type: "" } : er
									)
								);
							}}
						/>
						{/* externalConfig render */}
						{item.externalConfig &&
							form[idx].externalConfig &&
							form[idx].externalConfig.map((ec, ecIdx) => (
								<div key={ec.key} className="w-full h-full flex flex-col gap-4">
									{ec.options && ec.options.length > 0 ? (
										<Select
											value={ec.value}
											onValueChange={(v) => {
												setForm((f) =>
													f.map((fi, i) =>
														i === idx
															? {
																...fi,
																externalConfig: fi.externalConfig?.map(
																	(eec, i2) =>
																		i2 === ecIdx
																			? { ...eec, value: v }
																			: eec
																),
															}
															: fi
													)
												);
											}}
										>
											<SelectTrigger size="default" title={ec.name} state={errors[idx]?.externalConfig ? "error" : undefined} note={errors[idx]?.externalConfig ?? undefined}>
												<SelectValue placeholder="please select" />
											</SelectTrigger>
											<SelectContent>
												{ec.options.map((opt) => (
													<SelectItem key={opt.value} value={opt.value}>
														{opt.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									) : (
										<Input
											size="default"
											title={ec.name}
											state={errors[idx]?.externalConfig ? "error" : undefined}
											note={errors[idx]?.externalConfig ?? undefined}
											value={ec.value}
											onChange={(e) => {
												const v = e.target.value;
												setForm((f) =>
													f.map((fi, i) =>
														i === idx
															? {
																...fi,
																externalConfig: fi.externalConfig?.map(
																	(eec, i2) =>
																		i2 === ecIdx
																			? { ...eec, value: v }
																			: eec
																),
															}
															: fi
													)
												);
											}}
										/>
									)}
								</div>
							))}
					</div>
					{/* Action Button */}
					<div className="flex justify-end px-6 py-4 gap-2">
						<Button variant="ghost" size="sm" className="!text-text-label" onClick={() => handleDelete(idx)}>{t("setting.reset")}</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={() => handleVerify(idx)}
							disabled={loading === idx}
						>
							<span className="text-text-inverse-primary">
								{loading === idx ? "Configuring..." : "Save"}
							</span>
						</Button>
					</div>
				</div>
			);
		}

		// Local model content - specific platforms
		if (selectedTab.startsWith("local-")) {
			const platform = selectedTab.replace("local-", "");
			// Update localPlatform when switching to a local model tab
			if (localPlatform !== platform) {
				setLocalPlatform(platform);
			}
			
			const currentEndpoint = localEndpoints[platform] || "";
			const currentType = localTypes[platform] || "";
			const isConnected = !!currentEndpoint;
			const isPreferred = localPrefer && localPlatform === platform;
			
			return (
				<div className="w-full bg-surface-secondary rounded-2xl flex flex-col">
					<div className="flex flex-col justify-between items-start mx-6 pt-2 pb-4 mb-4 border-t-0 border-b-[0.5px] border-x-0 border-solid border-border-secondary">
						<div className="self-stretch inline-flex justify-between items-center gap-2">
							<div className="flex items-center gap-2">
								<div className="text-body-base text-text-heading font-bold my-2">
									{platform === "ollama" ? "Ollama" : 
									 platform === "vllm" ? "vLLM" : 
									 platform === "sglang" ? "SGLang" : "LM Studio"}
								</div>
								{isPreferred ? (
									<Button
										variant="success"
										size="xs"
										className="focus-none rounded-full shadow-none"
										disabled={!isConnected}
										onClick={() => handleLocalSwitch(false)}
									>
										Default
									</Button>
								) : (
									<Button
										variant="ghost"
										size="xs"
										disabled={!isConnected}
										onClick={() => handleLocalSwitch(true)}
										className={isConnected ? "!text-text-label rounded-full shadow-none bg-button-transparent-fill-hover" : ""}
									>
										{!isConnected ? "Not Configured" : "Set as Default"}
									</Button>
								)}
							</div>
							{isConnected ? (
								<div className="w-2 h-2 rounded-full bg-text-success" />
							) : (
								<div className="w-2 h-2 rounded-full bg-text-label opacity-10" />
							)}
						</div>
					</div>
					{/* Model Endpoint URL Setting */}
					<div className="flex flex-col w-full items-center gap-4 px-6">
						<Input
							size="default"
							title={t("setting.model-endpoint-url")}
							state={localInputError ? "error" : "default"}
							value={currentEndpoint}
							onChange={(e) => {
								setLocalEndpoints(prev => ({ ...prev, [platform]: e.target.value }));
								setLocalInputError(false);
								setLocalError(null);
							}}
							disabled={!localEnabled}
							placeholder={platform === "ollama" ? "http://localhost:11434/v1" : 
								platform === "lmstudio" ? "http://localhost:1234/v1" :
								"http://localhost:8000/v1"}
							note={localError ?? undefined}
						/>
						<Input
							size="default"
							title={t("setting.model-type")}
							state={localInputError ? "error" : "default"}
							placeholder={t("setting.enter-your-local-model-type")}
							value={currentType}
							onChange={(e) => setLocalTypes(prev => ({ ...prev, [platform]: e.target.value }))}
							disabled={!localEnabled}
						/>
					</div>
					{/* Action Button */}
					<div className="flex justify-end px-6 py-4 gap-2">
						<Button variant="ghost" size="sm" className="!text-text-label" onClick={handleLocalReset}>{t("setting.reset")}</Button>
						<Button
							onClick={handleLocalVerify}
							disabled={!localEnabled || localVerifying}
							variant="primary"
							size="sm"
						>
							<span className="text-text-inverse-primary">
								{localVerifying ? "Configuring..." : "Save"}
							</span>
						</Button>
					</div>
				</div>
			);
		}

		return null;
	};

	return (
		<div className="flex-1 w-full h-auto m-auto flex flex-col">
			{/* Header Section */}
			<div className="sticky top-0 z-10 bg-surface-primary flex pl-6 pt-8 pb-6 w-full items-center justify-between">
				<div className="flex flex-row items-center justify-between w-full gap-4">
					<div className="flex flex-col">
						<div className="text-heading-sm font-bold text-text-heading">{t("setting.models")}</div>
					</div>
					{/* Default Model Cascading Dropdown */}
					<div className="flex flex-row items-center w-fit gap-4">
						<div className="text-body-sm text-text-body">Default</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button className="flex items-center gap-2 px-3 py-1 rounded-lg border border-solid border-input-border-default bg-input-bg-input hover:bg-input-bg-hover hover:border-input-border-hover transition-colors w-fit justify-between">
									<span className="text-body-sm text-text-body whitespace-nowrap">
										{getDefaultModelDisplayText()}
									</span>
									<ChevronDown className="w-4 h-4 text-icon-primary flex-shrink-0" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-[180px]">
								{/* Cloud Category */}
								{import.meta.env.VITE_USE_LOCAL_PROXY !== "true" && (
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="gap-2">
											<img src={eigentImage} alt="Cloud" className="w-5 h-5" />
											<span className="text-body-sm">{t("setting.eigent-cloud")}</span>
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="w-[200px] max-h-[300px] overflow-y-auto">
											{cloudModelOptions.map((model) => (
												<DropdownMenuItem
													key={model.id}
													onClick={() => handleDefaultModelSelect("cloud", model.id)}
													className="flex items-center justify-between"
												>
													<span className="text-body-sm">{model.name}</span>
													{cloudPrefer && cloud_model_type === model.id && (
														<Check className="w-4 h-4 text-text-success" />
													)}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								)}
								
								{/* Custom Model Category */}
								<DropdownMenuSub>
									<DropdownMenuSubTrigger className="gap-2">
										<Key className="w-5 h-5 text-icon-primary" />
										<span className="text-body-sm">{t("setting.custom-model")}</span>
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent className="w-[220px] max-h-[440px] overflow-y-auto">
										{items.map((item, idx) => {
											const isConfigured = !!form[idx]?.provider_id;
											const isPreferred = form[idx]?.prefer;
											const modelImage = getModelImage(item.id);
											
											return (
												<DropdownMenuItem
													key={item.id}
													onClick={() => handleDefaultModelSelect("custom", item.id)}
													className="flex items-center justify-between"
												>
													<div className="flex items-center gap-2">
														{modelImage ? (
															<img src={modelImage} alt={item.name} className="w-4 h-4" />
														) : (
															<Key className="w-4 h-4 text-icon-secondary" />
														)}
														<span className={`text-body-sm ${isConfigured ? "text-text-body" : "text-text-label"}`}>
															{item.name}
														</span>
													</div>
													<div className="flex items-center gap-1">
														{!isConfigured && (
															<div className="w-2 h-2 rounded-full bg-text-label opacity-10" />
														)}
														{isPreferred && (
															<Check className="w-4 h-4 text-text-success" />
														)}
														{isConfigured && !isPreferred && (
															<div className="w-2 h-2 rounded-full bg-text-success" />
														)}
													</div>
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuSubContent>
								</DropdownMenuSub>
								
								{/* Local Host Category */}
								<DropdownMenuSub>
									<DropdownMenuSubTrigger className="gap-2">
										<Server className="w-5 h-5 text-icon-primary" />
										<span className="text-body-sm">{t("setting.local-model")}</span>
									</DropdownMenuSubTrigger>
									<DropdownMenuSubContent className="w-[200px]">
										{localModelOptions.map((model) => {
											const isConfigured = !!localEndpoints[model.id];
											const isPreferred = localPrefer && localPlatform === model.id;
											const modelImage = getModelImage(`local-${model.id}`);
											
											return (
												<DropdownMenuItem
													key={model.id}
													onClick={() => handleDefaultModelSelect("local", model.id)}
													className="flex items-center justify-between"
												>
													<div className="flex items-center gap-2">
														{modelImage ? (
															<img src={modelImage} alt={model.name} className="w-4 h-4" />
														) : (
															<Server className="w-4 h-4 text-icon-secondary" />
														)}
														<span className={`text-body-sm ${isConfigured ? "text-text-body" : "text-text-label"}`}>
															{model.name}
														</span>
													</div>
													<div className="flex items-center gap-1">
														{!isConfigured && (
															<div className="w-2 h-2 rounded-full bg-text-label opacity-10" />
														)}
														{isPreferred && (
															<Check className="w-4 h-4 text-text-success" />
														)}
														{isConfigured && !isPreferred && (
															<div className="w-2 h-2 rounded-full bg-text-success" />
														)}
													</div>
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</div>

			{/* Content Section with Sidebar */}
			<div className="flex w-full mx-auto pb-8 flex-1 min-h-0 sticky top-[88px] self-start">
				{/* Sidebar */}
				<div className="w-[240px] flex-shrink-0 pl-3 pr-2 py-2 bg-surface-secondary rounded-2xl mr-4 overflow-y-auto max-h-[calc(100vh-200px)] hover-style-scrollbar">
					<div className="flex flex-col gap-4">
						{/* Eigent Cloud Section */}
						<div className="flex flex-col gap-1">
						  <div className="px-3 py-2 text-body-base font-bold text-text-heading">
								{t("setting.eigent-cloud")}
							</div>
							{import.meta.env.VITE_USE_LOCAL_PROXY !== "true" && (
								renderSidebarItem(
									"cloud",
									t("setting.eigent-cloud"),
									"cloud",
									selectedTab === "cloud",
									false,
									cloudPrefer
								)
							)}
						</div>
						{/* Bring Your Own Key Section */}
						<div className="flex flex-col gap-1">
							<button
								onClick={() => setByokCollapsed(!byokCollapsed)}
								className="flex items-center justify-between px-3 py-2 bg-transparent hover:bg-surface-secondary rounded-lg transition-colors"
							>
								<div className="text-body-base font-bold text-text-heading">
									{t("setting.custom-model")}
								</div>
								{byokCollapsed ? (
									<ChevronDown className="w-4 h-4 text-text-label" />
								) : (
									<ChevronUp className="w-4 h-4 text-text-label" />
								)}
							</button>
							<div
								className={`overflow-hidden transition-all duration-300 ease-in-out ${
									byokCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
								}`}
							>
								{items.map((item, idx) => (
									renderSidebarItem(
										`byok-${item.id}` as SidebarTab,
										item.name,
										item.id,
										selectedTab === `byok-${item.id}`,
										true,
										!!form[idx].provider_id
									)
								))}
							</div>
						</div>

						{/* Local Model Section */}
						<div className="flex flex-col gap-1">
							<button
								onClick={() => setLocalCollapsed(!localCollapsed)}
								className="flex items-center justify-between px-3 py-2 bg-transparent hover:bg-surface-secondary rounded-lg transition-colors"
							>
								<div className="text-body-base font-bold text-text-heading">
									{t("setting.local-model")}
								</div>
								{localCollapsed ? (
									<ChevronDown className="w-4 h-4 text-text-label" />
								) : (
									<ChevronUp className="w-4 h-4 text-text-label" />
								)}
							</button>
							<div
								className={`overflow-hidden transition-all duration-300 ease-in-out ${
									localCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
								}`}
							>
								{renderSidebarItem(
									"local-ollama",
									"Ollama",
									"local-ollama",
									selectedTab === "local-ollama",
									true,
									!!localEndpoints["ollama"]
								)}
								{renderSidebarItem(
									"local-vllm",
									"vLLM",
									"local-vllm",
									selectedTab === "local-vllm",
									true,
									!!localEndpoints["vllm"]
								)}
								{renderSidebarItem(
									"local-sglang",
									"SGLang",
									"local-sglang",
									selectedTab === "local-sglang",
									true,
									!!localEndpoints["sglang"]
								)}
								{renderSidebarItem(
									"local-lmstudio",
									"LM Studio",
									"local-lmstudio",
									selectedTab === "local-lmstudio",
									true,
									!!localEndpoints["lmstudio"]
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Main Content */}
				<div className="flex-1 min-w-0">
					{renderContent()}
				</div>
			</div>
		</div>
	);
}
