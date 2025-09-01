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

interface EnvValue {
	value: string;
	required: boolean;
	tip: string;
}

interface MCPEnvDialogProps {
	showEnvConfig: boolean;
	onClose: () => void;
	onConnect: (mcp: any) => void;
	activeMcp?: any;
}

export const MCPEnvDialog: FC<MCPEnvDialogProps> = ({
	showEnvConfig,
	onClose,
	onConnect,
	activeMcp,
}) => {
	const [envValues, setEnvValues] = useState<{ [key: string]: EnvValue }>({});
	const [showKeys, setShowKeys] = useState<{ [key: string]: boolean }>({});

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
				if (key === "EXA_API_KEY") {
					initialValues[key].required = false;
				}
				if (key === "GOOGLE_REFRESH_TOKEN") {
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

	const handleConfigureMcpEnvSetting = () => {
		setEnvValues({});
		setShowKeys({});
		const mcp = { ...activeMcp };
		const env: { [key: string]: string } = {};
		Object.keys(envValues).map((key) => {
			env[key] = envValues[key]?.value;
		});
		mcp.install_command.env = env;
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
				<DialogContent
					aria-describedby={undefined}
					className="sm:max-w-[425px] p-0 !bg-popup-surface gap-0 !rounded-xl border border-zinc-300 shadow-sm"
				>
					<DialogHeader className="!bg-popup-surface !rounded-t-xl p-md">
						<DialogTitle className="m-0">
							<div className="flex gap-xs items-center justify-start">
								<div className="text-base font-bold leading-10 text-text-action">
									Configure {activeMcp?.name} Toolkit
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
										{key}
										{envValues[key]?.required && "*"}
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
											onClick={() =>
												setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))
											}
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
										{key === "SEARCH_ENGINE_ID" && (
											<div className="mt-1">
												Get it from:{" "}
												<a
													onClick={() => {
														window.location.href =
															"https://developers.google.com/custom-search/v1/overview";
													}}
													className="underline text-blue-500"
												>
													Google Custom Search API
												</a>
											</div>
										)}
										{key === "GOOGLE_API_KEY" && (
											<div className="mt-1">
												Get it from:{" "}
												<a
													onClick={() => {
														window.location.href =
															"https://console.cloud.google.com/apis/credentials";
													}}
													className="underline text-blue-500"
												>
													Google Cloud Console
												</a>
											</div>
										)}
										{key === "EXA_API_KEY" && (
											<div className="mt-1">
												Get it from:{" "}
												<a
													onClick={() => {
														window.location.href = "https://exa.ai";
													}}
													className="underline text-blue-500"
												>
													Exa.ai
												</a>{" "}
												(Optional)
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
							Cancel
						</Button>
						<Button
							onClick={handleConfigureMcpEnvSetting}
							variant="primary"
							size="md"
						>
							Connect
						</Button>
					</DialogFooter>
				</DialogContent>
			</form>
		</Dialog>
	);
};
