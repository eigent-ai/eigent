import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogContentSection,
	DialogFooter,
	DialogHeader,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Bot,
	Plus,
	Edit,
	Eye,
	EyeOff,
} from "lucide-react";
import ToolSelect from "./ToolSelect";
import { Textarea } from "@/components/ui/textarea";
import { useState, useRef } from "react";
import githubIcon from "@/assets/github.svg";
import { fetchPost } from "@/api/http";
import { useAuthStore, useWorkerList } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

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
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	const activeProjectId = projectStore.activeProjectId;
	const activeTaskId = chatStore.activeTaskId;
	const tasks = chatStore.tasks;
	const [showEnvConfig, setShowEnvConfig] = useState(false);
	const [activeMcp, setActiveMcp] = useState<McpItem | null>(null);
	const [envValues, setEnvValues] = useState<{ [key: string]: EnvValue }>({});
	const [secretVisible, setSecretVisible] = useState<{ [key: string]: boolean }>({});
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
			const initialVisibility: { [key: string]: boolean } = {};
			for(const key of Object.keys(mcp.install_command.env)) {
				initialValues[key] = {
					value: "",
					required: true,
					tip:
						mcp.install_command?.env?.[key]
							?.replace(/{{/g, "")
							?.replace(/}}/g, "") || "",
				};
				initialVisibility[key] = false;
			}
			setEnvValues(initialValues);
			setSecretVisible(initialVisibility);
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
			if (activeMcp.key === "EXA Search" || activeMcp.key === "Google Calendar") {
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
		setSecretVisible({});
	};

	const handleCloseMcpEnvSetting = () => {
		setShowEnvConfig(false);
		setActiveMcp(null);
		setEnvValues({});
		setSecretVisible({});
	};

	const handleShowEnvConfig = (mcp: McpItem) => {
		setActiveMcp(mcp);
		initializeEnvValues(mcp);
		setShowEnvConfig(true);
	};

	const isSensitiveKey = (key: string) => /token|key|secret|password|id/i.test(key);
	const toggleSecretVisibility = (key: string) => {
		setSecretVisible((prev) => ({ ...prev, [key]: !prev[key] }));
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
		setSecretVisible({});
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
		selectedTools.forEach((tool: any) => {
			if (tool.isLocal) {
				localTool.push(tool.toolkit as string);
			} else {
				mcpList.push(tool?.key || tool?.mcp_name);
			}
		});
		console.log("mcpLocal.mcpServers", mcpLocal.mcpServers);
		if (mcpLocal.mcpServers && typeof mcpLocal.mcpServers === 'object') {
			for(const key of Object.keys(mcpLocal.mcpServers)) {
				if (!mcpList.includes(key)) {
					delete mcpLocal.mcpServers[key];
				}
			}
		}
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
			activeTaskId && tasks[activeTaskId].messages.length === 0
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
			fetchPost(`/task/${activeProjectId}/add-agent`, {
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
				<DialogContent 
					size="sm" 
					className="p-0 gap-0"
					onInteractOutside={(e) => e.preventDefault()}
					onEscapeKeyDown={(e) => e.preventDefault()}
				>
					<DialogHeader
						title={showEnvConfig ? t("workforce.configure-mcp-server") : t("workforce.add-your-agent")}
						tooltip={t("layout.configure-your-mcp-worker-node-here")}
						showTooltip={true}
						showBackButton={showEnvConfig}
						onBackClick={handleCloseMcpEnvSetting}
					/>

					{showEnvConfig ? (
						// environment configuration interface
						<>
							<DialogContentSection className="flex flex-col gap-3 bg-white-100% p-md">
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
												<Input
													size="default"
													title={key}
													required
													placeholder={envValues[key]?.tip || `Enter ${key}`}
													type={isSensitiveKey(key) && !secretVisible[key] ? "password" : "text"}
													value={envValues[key]?.value || ""}
													onChange={(e) => updateEnvValue(key, e.target.value)}
													note={envValues[key]?.tip}
													backIcon={isSensitiveKey(key) ? (
														secretVisible[key] ? (
															<EyeOff size={16} className="text-button-transparent-icon-disabled" />
														) : (
															<Eye size={16} className="text-button-transparent-icon-disabled" />
														)
													) : undefined}
													onBackIconClick={isSensitiveKey(key) ? () => toggleSecretVisibility(key) : undefined}
												/>
											</div>
										)
									)}
								</div>
							</DialogContentSection>
							<DialogFooter 
								className="bg-white-100% !rounded-b-xl p-md"
								showCancelButton={true}
								showConfirmButton={true}
								cancelButtonText={t("workforce.cancel")}
								confirmButtonText={t("layout.connect")}
								onCancel={handleCloseMcpEnvSetting}
								onConfirm={handleConfigureMcpEnvSetting}
								cancelButtonVariant="ghost"
								confirmButtonVariant="primary"
							>
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
							<DialogContentSection className="flex flex-col gap-3 bg-white-100% p-md">
								<div className="flex flex-col gap-4">
									<div className="flex items-center gap-sm">
										<div className="flex w-16 h-16 items-center justify-center">
										<Bot size={32} className="text-icon-primary" />
										</div>
										<Input
											size="sm"
											title={t("layout.name-your-agent")}
											placeholder={t("layout.add-an-agent-name")}
											value={workerName}
											onChange={(e) => {
												setWorkerName(e.target.value);
												// when user starts input, clear error
												if (nameError) setNameError("");
											}}
											state={nameError ? "error" : "default"}
											note={nameError || ""}
											required
										/>
									</div>
								</div>

								<Textarea
									  variant="enhanced"
										size="sm"
										title={t("workforce.description-optional")}
										placeholder={t("layout.im-an-agent-specially-designed-for")}
										value={workerDescription}
										onChange={(e) => setWorkerDescription(e.target.value)}
								/>

								<ToolSelect
									onShowEnvConfig={handleShowEnvConfig}
									onSelectedToolsChange={handleSelectedToolsChange}
									initialSelectedTools={selectedTools}
									ref={toolSelectRef}
								/>
							</DialogContentSection>
							<DialogFooter 
								className="bg-white-100% !rounded-b-xl p-md"
								showCancelButton={true}
								showConfirmButton={true}
								cancelButtonText={t("workforce.cancel")}
								confirmButtonText={t("workforce.save-changes")}
								onCancel={() => {
									resetForm();
									setDialogOpen(false);
								}}
								onConfirm={handleAddWorker}
								cancelButtonVariant="ghost"
								confirmButtonVariant="primary"
							/>
						</>
					)}
				</DialogContent>
			</form>
		</Dialog>
	);
}
