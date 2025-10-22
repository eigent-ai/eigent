import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Circle,
	Settings,
	ChevronUp,
	ChevronDown,
	Eye,
	EyeOff,
	Info,
	RotateCcw,
	Loader2,
	Check,
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
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuthStore } from "@/store/authStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function SettingModels() {
	const { modelType, cloud_model_type, setModelType, setCloudModelType } =
		useAuthStore();
	const navigate = useNavigate();
	const { t } = useTranslation();
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

	// Cloud Model
	const [cloudPrefer, setCloudPrefer] = useState(false);

	// Local Model independent state
	const [localEnabled, setLocalEnabled] = useState(true);
	const [localPlatform, setLocalPlatform] = useState("ollama");
	const [localEndpoint, setLocalEndpoint] = useState("");
	const [localType, setLocalType] = useState("");
	const [localVerifying, setLocalVerifying] = useState(false);
	const [localError, setLocalError] = useState<string | null>(null);
	const [localInputError, setLocalInputError] = useState(false);
	const [localPrefer, setLocalPrefer] = useState(false); // Local model prefer state
	const [localProviderId, setLocalProviderId] = useState<number | undefined>(
		undefined
	); // Local model provider_id

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
				// Handle local model
				const local = providerList.find(
					(p: any) => p.provider_name === "Local Model"
				);
				console.log(123123, local);
				if (local) {
					setLocalEndpoint(local.endpoint_url || "");
					setLocalPlatform(local.encrypted_config?.model_platform || "ollama");
					setLocalType(local.encrypted_config?.model_type || "llama3.2");
					setLocalEnabled(local.is_valid ?? true);
					setLocalPrefer(local.prefer ?? false);
					setLocalProviderId(local.id);
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
            next[idx].apiKey = res?.message || t("setting.validate-failed");
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
          next[idx].apiKey = t("setting.validate-failed");
          return next;
        });
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
			handleSwitch(idx, true);
		} finally {
			setLoading(null);
		}
	};

	// Local Model verification
	const handleLocalVerify = async () => {
		setLocalVerifying(true);
		setLocalError(null);
		setLocalInputError(false);
		if (!localEndpoint) {
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
					model_type: localType,
					api_key: "not-required",
					url: localEndpoint,
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
						description: res.message,
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
			} finally {
				setLoading(null);
			}

			// 2. Save to /api/provider/ (save only base URL)
			const data: any = {
				provider_name: localPlatform,
				api_key: "not-required",
				endpoint_url: localEndpoint, // Save base URL without specific endpoints
				is_valid: true,
				model_type: localType,
				encrypted_config: {
					model_platform: localPlatform,
					model_type: localType,
				},
			};
			await proxyFetchPost("/api/provider", data);
			setLocalError(null);
			setLocalInputError(false);
			// add: refresh provider list after saving, update localProviderId and localPrefer
			const res = await proxyFetchGet("/api/providers");
			const providerList = Array.isArray(res) ? res : res.items || [];
			const local = providerList.find(
				(p: any) => p.provider_name === localPlatform
			);
			if (local) {
				handleLocalSwitch(true);

				setLocalProviderId(local.id);
				setLocalPrefer(local.prefer ?? false);
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
	const handleLocalSwitch = async (checked: boolean) => {
		if (!checked) {
			setLocalEnabled(false);
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
			if (localProviderId === undefined) return;
			await proxyFetchPost("/api/provider/prefer", {
				provider_id: localProviderId,
			});
			setModelType("local");
			setLocalEnabled(true);
			setActiveModelIdx(null);
			setForm((f) => f.map((fi) => ({ ...fi, prefer: false }))); // Set all others' prefer to false
			setLocalPrefer(true);
		} catch (e) {
			// Optional: add error message
		}
	};

	const handleLocalReset = async () => {
		try {
			if (localProviderId !== undefined) {
				await proxyFetchDelete(`/api/provider/${localProviderId}`);
			}
			setLocalEndpoint("");
			setLocalType("");
			setLocalPrefer(false);
			setLocalProviderId(undefined);
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

	return (
		<div className="flex flex-col gap-4 pb-40">
			{import.meta.env.VITE_USE_LOCAL_PROXY !== "true" && (
				<div className="w-full pt-4 self-stretch px-6 py-4 bg-gradient-to-t from-orange-50 to-surface-tertiary rounded-2xl inline-flex flex-col justify-start items-start gap-4 border-solid border-border-disabled">
					<div className="self-stretch flex flex-col justify-start items-start gap-1">
						<div className="self-stretch inline-flex justify-start items-center gap-2">
							<div className="flex-1 justify-center text-body-lg text-text-heading font-bold">
								{t("setting.eigent-cloud-version")}
							</div>
						{cloudPrefer ? (
							<Button
								variant="success"
								size="sm"
								className="focus-none"
								onClick={() => {
									// currently selected -> unselect
									setCloudPrefer(false);
									setModelType("custom");
								}}
							>
								Default
								<Check/>
							</Button>
						) : (
							<Button
								variant="ghost"
								size="sm"
								className="!text-text-label"
								onClick={() => {
									// not selected -> select cloud prefer
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
							<span className="text-text-body text-xs font-normal font-['Inter'] leading-tight">
								.
							</span>
						</div>
					</div>
					<div className="flex flex-row items-center justify-start gap-4 w-full pb-2">
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
						<div className="text-text-body text-body-sm">
							{t("setting.credits")}:{" "}
							{loadingCredits ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								credits
							)}
						</div>
					</div>
					<div className="w-full flex items-center flex-1 justify-between pt-6 border-b-0 border-x-0 border-solid border-border-disabled">
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
											: cloud_model_type === "claude-sonnet-4-20250514"
											? t("setting.claude-sonnet-4")
											: cloud_model_type === "claude-3-5-haiku-20241022"
											? t("setting.claude-3.5-haiku")
											: cloud_model_type === "gpt-5"
											? t("setting.gpt-5")
											: cloud_model_type === "gpt-5-mini"
											? t("setting.gpt-5-mini")
											: cloud_model_type === "gpt-5-nano"
											? t("setting.gpt-5-nano")
											: t("setting.gemini-2.5-pro")}
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
									<SelectItem value="gemini/gemini-2.5-pro">Gemini 2.5 Pro</SelectItem>
									<SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
									<SelectItem value="gpt-4.1-mini">GPT-4.1 mini</SelectItem>
									<SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
									<SelectItem value="gpt-5">GPT-5</SelectItem>
									<SelectItem value="gpt-5-mini">GPT-5 mini</SelectItem>
									<SelectItem value="gpt-5-nano">GPT-5 nano</SelectItem>
									<SelectItem value="claude-sonnet-4-5">
										Claude Sonnet 4-5
									</SelectItem>
									<SelectItem value="claude-sonnet-4-20250514">
										Claude Sonnet 4
									</SelectItem>
									<SelectItem value="claude-3-5-haiku-20241022">
										Claude 3.5 Haiku
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
			)}
			{/* customer models */}
			<div className="self-stretch my-2 border-border-disabled inline-flex flex-col justify-start items-start border-x-0 border-solid">
				{/* header */}
				<div className="sticky top-[87px] py-2 z-10 bg-surface-tertiary self-stretch inline-flex justify-start items-start gap-2 pl-6 pr-2 my-6 border-y-0 border-r-0 border-solid border-border-secondary">
						<div className="flex flex-col w-full items-start gap-1">
								<span className="justify-center text-text-body text-body-md font-bold">
									{t("setting.custom-model")}
								</span>
								<span className="justify-center text-text-body text-label-sm font-normal">
									{t("setting.use-your-own-api-keys-or-set-up-a-local-model")}
								</span>
						</div>
					<Button
						variant="ghost"
						size="md"
						onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							setCollapsed((c) => !c);
						}}
					>
						{collapsed ? (
							<ChevronDown className="w-4 h-4" />
						) : (
							<ChevronUp className="w-4 h-4" />
						)}
					</Button>
				</div>

				{/*  model list */}
				<div
					className={`self-stretch inline-flex flex-col justify-start items-start gap-8 transition-all duration-300 ease-in-out overflow-hidden ${
						collapsed
							? "max-h-0 opacity-0 pointer-events-none"
							: "opacity-100"
					}`}
					style={{
						transform: collapsed ? "translateY(-10px)" : "translateY(0)",
					}}
				>
					{items.map((item, idx) => {
						const canSwitch = !!form[idx].provider_id;
						return (
							<div
								key={item.id}
								className="w-full bg-surface-secondary rounded-2xl overflow-hidden"
							>
								<div className="flex flex-col justify-between items-start gap-1 px-6 py-4">
								  <div className="self-stretch inline-flex justify-between items-center gap-2">
										<div className="flex-1 justify-center text-body-lg text-text-heading font-bold">
											{item.name}
										</div>
									{form[idx].prefer ? (
										<Button
											variant="success"
											size="sm"
											className="focus-none"
											disabled={!canSwitch || loading === idx}
											onClick={() => handleVerify(idx)}
										>
											Default
											<Check />
										</Button>
									) : (
										<Button
											variant="ghost"
											size="sm"
											disabled={!canSwitch || loading === idx}
											onClick={() => handleVerify(idx)}
											className={canSwitch ? "!text-text-label" : ""}
										>
											{!canSwitch ? "Not Configured" : "Set as Default"}
										</Button>
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
											placeholder={` ${t("setting.enter-your-api-key")} ${
											    item.name
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
											placeholder={`${t("setting.enter-your-api-host")} ${
												item.name
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
											placeholder={`${t("setting.enter-your-model-type")} ${
												item.name
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
								<div className="flex justify-end mt-6 px-6 py-4 gap-2 border-b-0 border-x-0 border-solid border-border-secondary">
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
					})}
				</div>
			</div>
			{/* Local Model */}
			<div className="mt-2 bg-surface-secondary rounded-2xl flex flex-col gap-4">
				<div className="flex items-center justify-between mb-2 px-6 pt-4">
					<div className="font-bold text-body-lg text-text-heading">{t("setting.local-model")}</div>
					{localPrefer ? (
						<Button
							variant="success"
							size="sm"
							className="focus-none"
							disabled={!localEndpoint}
							onClick={() => handleLocalSwitch(false)}
						>
							Default
							<Check />
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							disabled={!localEndpoint}
							onClick={() => handleLocalSwitch(true)}
							className={localEndpoint ? "!text-text-success" : ""}
						>
							{!localEndpoint ? "Not Configured" : "Set as Default"}
						</Button>
					)}
				</div>
				<div className="flex flex-col gap-4 px-6">

						<Select
							value={localPlatform}
							onValueChange={(v) => {
								console.log(v);
								setLocalPlatform(v);
							}}
							disabled={!localEnabled}
						>
							<SelectTrigger size="default" title={t("setting.model-platform")} state={localInputError ? "error" : undefined} note={localError ?? undefined}>
								<SelectValue placeholder="Select platform" />
							</SelectTrigger>
							<SelectContent className="bg-white-100%">
								<SelectItem value="ollama">Ollama</SelectItem>
								<SelectItem value="vllm">vLLM</SelectItem>
								<SelectItem value="sglang">Sglang</SelectItem>
								<SelectItem value="lmstudio">LMStudio</SelectItem>
							</SelectContent>
						</Select>

						<Input
						  size="default"
							title={t("setting.model-endpoint-url")}
							state={localInputError ? "error" : "default"}
							value={localEndpoint}
							onChange={(e) => {
								setLocalEndpoint(e.target.value);
								setLocalInputError(false);
								setLocalError(null);
							}}
							disabled={!localEnabled}
							placeholder="http://localhost:11434/v1"
							note={localError ?? undefined}
						/>
						<Input
							size="default"
							title={t("setting.model-type")}
							state={localInputError ? "error" : "default"}
							placeholder={t("setting.enter-your-local-model-type")}
							value={localType}
							onChange={(e) => setLocalType(e.target.value)}
							disabled={!localEnabled}
						/>
				</div>
				<div className="flex justify-end mt-2 px-6 py-4 gap-2 border-b-0 border-x-0 border-solid border-border-secondary">
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
		</div>
	);
}
