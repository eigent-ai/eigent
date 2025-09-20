import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Bot, CircleAlert, Eye, EyeOff } from "lucide-react";
import githubIcon from "@/assets/github.svg";
import { Input } from "@/components/ui/input";
import { useState, FC, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface EnvValue {
	value: string;
	required: boolean;
	tip: string;
	error?: string;
}

interface MCPEnvDialogProps {
	showEnvConfig: boolean;
	onClose: () => void;
	onConnect: (mcp: any) => void;
	activeMcp?: any;
}

export async function google_check(apiKey: string, searchEngineId: string) {
	const query = "hello"; // rand word
	const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(
		query
	)}&num=1`;

	try {
		const res = await fetch(url);
		if (!res.ok) {
			throw new Error(`Google API error: ${res.status}`);
		}
		const data = await res.json();

		if ("items" in data) {
			return { success: true, message: "Google key is valid ✅", sample: data.items[0] };
		} else {
			return { success: false, message: "Google key invalid ❌", error: data.error };
		}
	} catch (err: any) {
		return { success: false, message: `Google check failed: ${err.message}` };
	}
}

export async function exa_check(apiKey: string) {
	const query = "hello"; // rand search word

	try {
		const res = await fetch("https://api.exa.ai/search", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query }),
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(`Exa API error: ${res.status} ${data.error}`);
		}

		const data = await res.json();
		if ("results" in data) {
			return { success: true, message: "Exa key is valid ✅", sample: data.results[0] };
		} else {
			return { success: false, message: "Exa key invalid ❌", error: data };
		}
	} catch (err: any) {
		return { success: false, message: `Exa check failed: ${err.message}` };
	}
}


export const MCPEnvDialog: FC<MCPEnvDialogProps> = ({
	showEnvConfig,
	onClose,
	onConnect,
	activeMcp,
}) => {
	const [envValues, setEnvValues] = useState<{ [key: string]: EnvValue }>({});
	const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});
	const [isValidating, setIsValidating] = useState<boolean>(false);
	const { t } = useTranslation();
	useEffect(() => {
		initializeEnvValues(activeMcp);
	}, [activeMcp]);

	const initializeEnvValues = (mcp: any) => {
		if (mcp?.install_command?.env) {
			const initialValues: { [key: string]: EnvValue } = {};
			Object.keys(mcp.install_command.env).forEach((key) => {

				initialValues[key] = {
					value: "",
					required: true,
					tip:
						mcp.install_command?.env?.[key]
							?.replace(/{{/g, "")
							?.replace(/}}/g, "") || "",
				};
				if (key === 'EXA_API_KEY') {
					initialValues[key].required = false;
				}
				if (key === 'GOOGLE_REFRESH_TOKEN') {
					initialValues[key].required = false;
				}
			});
			setEnvValues(initialValues);
		}
	};

	const getCategoryIcon = (categoryName?: string) => {
		if (!categoryName) return <Bot className="w-10 h-10 text-icon-primary" />;
		return <Bot className="w-10 h-10 text-icon-primary" />;
	};

	const getGithubRepoName = (homePage?: string) => {
		if (!homePage || !homePage.startsWith("https://github.com/")) return null;
		const parts = homePage.split("/");
		return parts.length > 4 ? parts[4] : homePage;
	};
	const updateEnvValue = (key: string, value: string) => {
		setEnvValues((prev) => ({
			...prev,
			[key]: {
				value,
				required: prev[key]?.required || true,
				tip: prev[key]?.tip || "",
			},
		}));
	};
	const handleCloseMcpEnvSetting = () => {
		setEnvValues({});
		setShowKeys({});
		onClose();
	};

	const setFieldError = (key: string, error: string) => {
		setEnvValues((prev) => ({
			...prev,
			[key]: {
				...prev[key],
				error,
			},
		}));
	};

	const clearFieldErrors = () => {
		setEnvValues((prev) => {
			const updated: typeof prev = {};
			Object.keys(prev).forEach((key) => {
				updated[key] = { ...prev[key], error: "" };
			});
			return updated;
		});
	};

	const handleConfigureMcpEnvSetting = async () => {
		if (isValidating) return;

		setIsValidating(true);
		clearFieldErrors();

		const env: { [key: string]: string } = {};
		Object.keys(envValues).forEach((key) => {
			env[key] = envValues[key]?.value;
		});

		// Validate Google API key
		if (env["GOOGLE_API_KEY"] && env["SEARCH_ENGINE_ID"]) {
			const result = await google_check(env["GOOGLE_API_KEY"], env["SEARCH_ENGINE_ID"]);
			if (!result.success) {
				setFieldError("GOOGLE_API_KEY", result.message);
				setFieldError("SEARCH_ENGINE_ID", result.message);
				setIsValidating(false);
				return;
			}
		}

		// Validate Exa API key
		if (env["EXA_API_KEY"]) {
			const result = await exa_check(env["EXA_API_KEY"]);
			if (!result.success) {
				setFieldError("EXA_API_KEY", result.message);
				setIsValidating(false);
				return;
			}
		}

		// Save only if all validations succeed
		const mcp = { ...activeMcp, install_command: { ...activeMcp.install_command, env } };
		setEnvValues({});
		setShowKeys({});
		setIsValidating(false);
		onConnect(mcp);
	};
	return (
		<Dialog
			open={showEnvConfig}
			onOpenChange={(open) => {
				if (!open) handleCloseMcpEnvSetting();
			}}
		>
			<form>
				<DialogContent aria-describedby={undefined} className="sm:max-w-[425px] p-0 !bg-popup-surface gap-0 !rounded-xl border border-zinc-300 shadow-sm">
					<DialogHeader className="!bg-popup-surface !rounded-t-xl p-md">
						<DialogTitle className="m-0">
							<div className="flex gap-xs items-center justify-start">
								<div className="text-base font-bold leading-10 text-text-action">
									{t("setting.configure {name} Toolkit", { name: activeMcp?.name })}
								</div>
								<CircleAlert size={16} />
							</div>
						</DialogTitle>
					</DialogHeader>

					<div className="flex flex-col gap-3 bg-white-100% p-md">
						<div className="flex gap-md items-center">
							{getCategoryIcon(activeMcp?.category?.name)}
							<div>
								<div className="text-text-action text-base font-bold leading-9">
									{activeMcp?.name}
								</div>
								<div className="text-text-body text-sm leading-normal font-bold">
									{getGithubRepoName(activeMcp?.home_page) && (
										<div className="flex items-center">
											<img
												src={githubIcon}
												alt="github"
												style={{
													width: 14.7,
													height: 14.7,
													marginRight: 4,
													display: "inline-block",
													verticalAlign: "middle",
												}}
											/>
											<span className="self-stretch items-center justify-center text-xs font-medium leading-normal overflow-hidden text-ellipsis break-words line-clamp-1">
												{getGithubRepoName(activeMcp?.home_page)}
											</span>
										</div>
									)}
								</div>
							</div>
						</div>
						<div className="flex flex-col gap-sm">
							{Object.keys(activeMcp?.install_command?.env || {}).map((key) => (
								<div key={key}>
									<div className="text-text-body text-sm leading-normal font-bold">
										{key}{envValues[key]?.required && '*'}
									</div>
									<div className="relative">
										<Input
											type={showKeys[key] ? "text" : "password"}
											placeholder=""
											className="h-7 pr-8 rounded-sm border border-solid border-input-border-default bg-input-bg-default !shadow-none text-sm leading-normal !ring-0 !ring-offset-0 resize-none"
											value={envValues[key]?.value || ""}
											onChange={(e) => updateEnvValue(key, e.target.value)}
										/>
										<span
											className="absolute inset-y-0 right-2 flex items-center cursor-pointer text-gray-500 hover:text-gray-700"
											onClick={() => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))}
										>
											{showKeys[key] ? (
												<Eye className="w-4 h-4" />
											) : (
												<EyeOff className="w-4 h-4" />
											)}
										</span>
									</div>
									<div className="text-input-label-default text-xs leading-normal">
										{envValues[key]?.tip}
										{envValues[key]?.error && (
											<div className="text-red-500 text-xs mt-1">{envValues[key]?.error}</div>
										)}
										{key === 'SEARCH_ENGINE_ID' && (
											<div className="mt-1">
												{t("setting.get-it-from")}: <a onClick={() => {
													window.location.href = "https://developers.google.com/custom-search/v1/overview";
												}} className="underline text-blue-500">{t("setting.google-custom-search-api")}</a>
											</div>
										)}
										{key === 'GOOGLE_API_KEY' && (
											<div className="mt-1">
												{t("setting.get-it-from")}: <a onClick={() => {
													window.location.href = "https://console.cloud.google.com/apis/credentials";
												}} className="underline text-blue-500">{t("setting.google-cloud-console")}</a>
											</div>
										)}
										{key === 'EXA_API_KEY' && (
											<div className="mt-1">
												{t("setting.get-it-from")}: <a onClick={() => {
													window.location.href = "https://exa.ai";
												}} className="underline text-blue-500">Exa.ai</a> (Optional)
											</div>
										)}
									</div>
								</div>
							))}
						</div>
					</div>
					<DialogFooter className="bg-white-100% !rounded-b-xl p-md">
						<Button
							onClick={handleCloseMcpEnvSetting}
							variant="outline"
							size="md"
						>
							{t("setting.cancel")}
						</Button>
						<Button
							onClick={handleConfigureMcpEnvSetting}
							variant="primary"
							size="md"
							disabled={isValidating}
						>
							{isValidating ? "Validating..." : t("setting.connect")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</form>
		</Dialog>
	);
};
