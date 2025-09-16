import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Bot,
	CircleAlert,
	Plus,
	RefreshCw,
	ChevronLeft,
	ArrowRight,
	Edit,
} from "lucide-react";
import ToolSelect from "./ToolSelect";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef } from "react";
import githubIcon from "@/assets/github.svg";
import { fetchPost } from "@/api/http";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore, useWorkerList } from "@/store/authStore";
import { useTranslation } from "react-i18next";

interface EnvValue {
	value: string;
	required: boolean;
	tip: string;
}

interface McpItem {
	id: number;
	name: string;
	key: string;
	description: string;
	category?: { name: string };
	home_page?: string;
	install_command?: {
		env?: { [key: string]: string };
	};
	toolkit?: string;
	isLocal?: boolean;
	mcp_name?: string;
}

export function AddWorker({
	edit = false,
	workerInfo = null,
}: {
	edit?: boolean;
	workerInfo?: Agent | null;
}) {
	const { t } = useTranslation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const chatStore = useChatStore();
	const [showEnvConfig, setShowEnvConfig] = useState(false);
	const [activeMcp, setActiveMcp] = useState<McpItem | null>(null);
	const [envValues, setEnvValues] = useState<{ [key: string]: EnvValue }>({});
	const toolSelectRef = useRef<{
		installMcp: (id: number, env?: any, activeMcp?: any) => Promise<void>;
	} | null>(null);
	const { email, setWorkerList } = useAuthStore();
	const workerList = useWorkerList();
	// save AddWorker form data
	const [workerName, setWorkerName] = useState("");
	const [workerDescription, setWorkerDescription] = useState("");
	const [selectedTools, setSelectedTools] = useState<McpItem[]>([]);
	
	// error status management
	const [nameError, setNameError] = useState<string>("");

	// environment variable management
	const initializeEnvValues = (mcp: McpItem) => {
		console.log(mcp);
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
			});
			setEnvValues(initialValues);
		}
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

	const handleConfigureMcpEnvSetting = async () => {
		if (!activeMcp) return;

		// switch back to tool selection interface, ensure ToolSelect component is visible
		setShowEnvConfig(false);

		// wait for component re-rendering
		await new Promise((resolve) => setTimeout(resolve, 100));

		// call ToolSelect's install method
		if (toolSelectRef.current) {
			if (activeMcp.key === "EXA Search") {
				await toolSelectRef.current.installMcp(
					activeMcp.id,
					{ ...envValues },
					activeMcp
				);
			} else {
				await toolSelectRef.current.installMcp(activeMcp.id, { ...envValues });
			}
		}

		// clean status
		setActiveMcp(null);
		setEnvValues({});
	};

	const handleCloseMcpEnvSetting = () => {
		setShowEnvConfig(false);
		setActiveMcp(null);
		setEnvValues({});
	};

	const handleShowEnvConfig = (mcp: McpItem) => {
		setActiveMcp(mcp);
		initializeEnvValues(mcp);
		setShowEnvConfig(true);
	};

	const handleSelectedToolsChange = (tools: McpItem[]) => {
		setSelectedTools(tools);
	};

	const resetForm = () => {
		setWorkerName("");
		setWorkerDescription("");
		setSelectedTools([]);
		setShowEnvConfig(false);
		setActiveMcp(null);
		setEnvValues({});
		setNameError("");
	};

	// tool function
	const getCategoryIcon = (categoryName?: string) => {
		if (!categoryName) return <Bot className="w-10 h-10 text-icon-primary" />;
		return <Bot className="w-10 h-10 text-icon-primary" />;
	};

	const getGithubRepoName = (homePage?: string) => {
		if (!homePage || !homePage.startsWith("https://github.com/")) return null;
		const parts = homePage.split("/");
		return parts.length > 4 ? parts[4] : homePage;
	};

	// create Worker node
	const handleAddWorker = async () => {
		// clear previous errors
		setNameError("");
		
		if (!workerName) {
			setNameError(t("workforce.worker-name-cannot-be-empty"));
			return;
		}

		if (!edit && workerList.find((worker: any) => worker.name === workerName)) {
			setNameError(t("workforce.worker-name-already-exists"));
			return;
		}
		let mcpLocal: any = {};
		if (window.ipcRenderer) {
			mcpLocal = await window.ipcRenderer.invoke("mcp-list");
		}
		const localTool: string[] = [];
		const mcpList: string[] = [];
		selectedTools.map((tool: any) => {
			if (tool.isLocal) {
				localTool.push(tool.toolkit as string);
			} else {
				mcpList.push(tool?.key || tool?.mcp_name);
			}
		});
		Object.keys(mcpLocal.mcpServers).map((key) => {
			console.log("mcpList", mcpList);
			console.log("mcpLocal.mcpServers", mcpLocal.mcpServers);

			if (!mcpList.includes(key)) {
				delete mcpLocal.mcpServers[key];
			}
		});
		if (edit) {
			const newWorkerList = workerList.map((worker) => {
				if (worker.type === workerInfo?.type) {
					const newWorker: Agent = {
						tasks: [],
						agent_id: workerName,
						name: workerName,
						type: workerName as AgentNameType,
						log: [],
						tools: [...selectedTools.map((tool) => tool.name)],
						activeWebviewIds: [],
						workerInfo: {
							name: workerName,
							description: workerDescription,
							tools: localTool,
							mcp_tools: mcpLocal,
							selectedTools: JSON.parse(JSON.stringify(selectedTools)),
						},
					};
					return {
						...newWorker,
					};
				} else {
					return worker;
				}
			});
			setWorkerList(newWorkerList);
		} else if (
			chatStore.activeTaskId &&
			chatStore.tasks[chatStore.activeTaskId].messages.length === 0
		) {
			const worker: Agent = {
				tasks: [],
				agent_id: workerName,
				name: workerName,
				type: workerName as AgentNameType,
				log: [],
				tools: [
					...selectedTools.map((tool) => tool?.key || tool?.mcp_name || ""),
				],
				activeWebviewIds: [],
				workerInfo: {
					name: workerName,
					description: workerDescription,
					tools: localTool,
					mcp_tools: mcpLocal,
					selectedTools: JSON.parse(JSON.stringify(selectedTools)),
				},
			};
			setWorkerList([...workerList, worker]);
		} else {
			fetchPost(`/task/${chatStore.activeTaskId}/add-agent`, {
				name: workerName,
				description: workerDescription,
				tools: localTool,
				mcp_tools: mcpLocal,
				email: email,
			});
			const worker: Agent = {
				tasks: [],
				agent_id: workerName,
				name: workerName,
				type: workerName as AgentNameType,
				log: [],
				activeWebviewIds: [],
				workerInfo: {
					name: workerName,
					description: workerDescription,
					tools: localTool,
					mcp_tools: mcpLocal,
					selectedTools: JSON.parse(JSON.stringify(selectedTools)),
				},
			};
			setWorkerList([...workerList, worker]);
		}

		setDialogOpen(false);

		// reset form
		resetForm();
	};

	return (
		<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
			<form>
				<DialogTrigger asChild>
					{edit ? (
						<Button
							variant="ghost"
							size="sm"
							className="w-full"
							onClick={(e) => {
								e.stopPropagation();
								setDialogOpen(true);
								setWorkerName(workerInfo?.workerInfo?.name || "");
								setWorkerDescription(workerInfo?.workerInfo?.description || "");
								setSelectedTools(workerInfo?.workerInfo?.selectedTools || []);
							}}
						>
							<Edit size={16} />
							{t("workforce.edit")}
						</Button>
					) : (
						<Button onClick={() => setDialogOpen(true)} variant="ghost">
							<Plus className="w-6 h-6 text-icon-primary" />
							<span className="text-text-body text-[13px] leading-13 font-bold">
								{t("workforce.new-worker")}
							</span>
						</Button>
					)}
				</DialogTrigger>
				<DialogContent className="sm:max-w-[425px] p-0 !bg-popup-surface gap-0 !rounded-xl border border-zinc-300 shadow-sm">
					<DialogHeader className="!bg-popup-surface !rounded-t-xl p-md">
						<DialogTitle className="m-0">
							<div className="flex gap-xs items-center justify-start">
								{showEnvConfig && (
									<ChevronLeft
										onClick={handleCloseMcpEnvSetting}
										size={16}
										className="text-icon-primary cursor-pointer"
									/>
								)}
								<div className="text-base font-bold leading-10 text-text-action">
									{showEnvConfig
										? t("workforce.configure-mcp-server")
										: t("workforce.add-your-mcp-server")}
								</div>
								<CircleAlert size={16} />
							</div>
						</DialogTitle>
					</DialogHeader>

					{showEnvConfig ? (
						// environment configuration interface
						<>
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
									{Object.keys(activeMcp?.install_command?.env || {}).map(
										(key) => (
											<div key={key}>
												<div className="text-text-body text-sm leading-normal font-bold">
													{key}*
												</div>
												<Input
													placeholder=""
													className="h-7 rounded-sm border border-solid border-input-border-default bg-input-bg-default !shadow-none text-sm leading-normal !ring-0 !ring-offset-0 resize-none"
													value={envValues[key]?.value || ""}
													onChange={(e) => updateEnvValue(key, e.target.value)}
												/>
												<div className="text-input-label-default text-xs leading-normal">
													{envValues[key]?.tip}
												</div>
											</div>
										)
									)}
								</div>
							</div>
							<DialogFooter className="bg-white-100% !rounded-b-xl p-md">
								<Button
									onClick={handleCloseMcpEnvSetting}
									variant="ghost"
									size="sm"
								>
									{t("workforce.cancel")}
								</Button>
								<Button size="sm" onClick={handleConfigureMcpEnvSetting}>
									<span>{t("workforce.configure")}</span>
									<ArrowRight size={16} />
								</Button>
							</DialogFooter>
							{/* hidden but keep rendering ToolSelect component */}
							<div style={{ display: "none" }}>
								<ToolSelect
									onShowEnvConfig={handleShowEnvConfig}
									onSelectedToolsChange={handleSelectedToolsChange}
									initialSelectedTools={selectedTools}
									ref={toolSelectRef}
								/>
							</div>
						</>
					) : (
						// default add interface
						<>
							<div className="flex flex-col gap-3 bg-white-100% p-md">
								<div className="flex flex-col gap-2">
									<div className="flex items-center gap-sm pb-md border-[0px] border-b border-solid border-border-secondary">
										<Bot size={32} className="text-icon-primary" />
										<Input
											placeholder=""
											value={workerName}
											onChange={(e) => {
												setWorkerName(e.target.value);
												// when user starts input, clear error
												if (nameError) setNameError("");
											}}
											className={`!border-none !bg-transparent !shadow-none text-xl leading-2xl font-bold !ring-0 !ring-offset-0 ${
												nameError ? "border-red-500" : ""
											}`}
										/>
										<RefreshCw
											size={16}
											className="text-button-transparent-icon-disabled"
										/>
									</div>
									{nameError && (
										<div className="text-red-500 text-sm font-medium">
											{nameError}
										</div>
									)}
								</div>
								<div className="flex flex-col gap-sm ">
									<div className="text-text-body text-sm leading-normal font-bold">
										{t("workforce.description-optional")}
									</div>
									<Textarea
										placeholder=""
										value={workerDescription}
										onChange={(e) => setWorkerDescription(e.target.value)}
										className="rounded-sm border border-solid border-input-border-default bg-input-bg-default  !shadow-none text-sm leading-normal !ring-0 !ring-offset-0 resize-none"
									/>
								</div>
								<div>
									<div className="flex items-center gap-sm ">
										<div className="text-text-body text-sm leading-normal font-bold">
											{t("workforce.agent-tool")}
										</div>
										<CircleAlert size={16} />
									</div>
								</div>
								<ToolSelect
									onShowEnvConfig={handleShowEnvConfig}
									onSelectedToolsChange={handleSelectedToolsChange}
									initialSelectedTools={selectedTools}
									ref={toolSelectRef}
								/>
							</div>
							<DialogFooter className="bg-white-100% !rounded-b-xl p-md">
								<DialogClose asChild>
									<Button onClick={resetForm} variant="ghost" size="sm">
										{t("workforce.cancel")}
									</Button>
								</DialogClose>
								<Button size="sm" onClick={handleAddWorker} type="submit">
									<span>{t("workforce.save-changes")}</span>
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</form>
		</Dialog>
	);
}
