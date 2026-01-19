import ChatBox from "@/components/ChatBox";
import Workflow from "@/components/WorkFlow";
import Folder from "@/components/Folder";
import Terminal from "@/components/Terminal";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ReactFlowProvider } from "@xyflow/react";
import { AnimatePresence, motion } from "framer-motion";
import BottomBar from "@/components/BottomBar";
import BrowserAgentWorkSpace from "@/components/BrowserAgentWorkSpace";
import TerminalAgentWrokSpace from "@/components/TerminalAgentWrokSpace";
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from "@/components/ui/resizable";
import UpdateElectron from "@/components/update";
import Overview from "./Project/Triggers";
import { usePageTabStore } from "@/store/pageTabStore";
import { MenuToggleGroup, MenuToggleItem } from "@/components/MenuButton/MenuButton";
import { LayoutGrid, Inbox, Zap, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddWorker } from "@/components/AddWorker";
import { TriggerDialog } from "@/components/Trigger/TriggerDialog";
import { TriggerInput } from "@/types";
import { useAuthStore } from "@/store/authStore";
import { useTriggerStore, WebSocketConnectionStatus } from "@/store/triggerStore";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";

// Connection status icon component
function ConnectionStatusIcon({ status }: { status: WebSocketConnectionStatus }) {
	const getStatusColor = () => {
		switch (status) {
			case 'connected':
				return 'text-green-500';
			case 'connecting':
				return 'text-yellow-500 animate-pulse';
			case 'unhealthy':
				return 'text-orange-500';
			case 'disconnected':
			default:
				return 'text-red-400';
		}
	};

	const getStatusTooltip = () => {
		switch (status) {
			case 'connected':
				return 'Connected to trigger listener';
			case 'connecting':
				return 'Connecting...';
			case 'unhealthy':
				return 'Connection unhealthy - click refresh to reconnect';
			case 'disconnected':
			default:
				return 'Disconnected from trigger listener';
		}
	};

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Zap className={getStatusColor()} />
				</TooltipTrigger>
				<TooltipContent>
					<p>{getStatusTooltip()}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

export default function Home() {
	const { t } = useTranslation();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	const {
		activeTab,
		activeWorkspaceTab,
		setActiveWorkspaceTab,
		chatPanelPosition,
		hasTriggers,
		setHasTriggers,
		hasAgentFiles,
		setHasAgentFiles,
		unviewedTabs,
		markTabAsUnviewed
	} = usePageTabStore();
	
	const { wsConnectionStatus, triggerReconnect } = useTriggerStore();

	const [activeWebviewId, setActiveWebviewId] = useState<string | null>(null);
	const [isChatBoxVisible, setIsChatBoxVisible] = useState(true);
	const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
	const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const toggleChatBox = () => {
		setIsChatBoxVisible(prev => !prev);
	};

	// Handle file upload
	const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || files.length === 0) return;

		// Get the active project's folder path
		const activeProjectId = projectStore.activeProjectId;
		if (!activeProjectId) return;

		// Upload files using electron API
		for (const file of Array.from(files)) {
			try {
				const reader = new FileReader();
				reader.onload = async () => {
					if (reader.result && window.ipcRenderer) {
						await window.ipcRenderer.invoke('save-file-to-agent-folder', {
							projectId: activeProjectId,
							fileName: file.name,
							content: reader.result,
						});
						// Mark the inbox tab as having new content
						setHasAgentFiles(true);
						if (activeWorkspaceTab !== 'inbox') {
							markTabAsUnviewed('inbox');
						}
					}
				};
				reader.readAsArrayBuffer(file);
			} catch (error) {
				console.error('Error uploading file:', error);
			}
		}

		// Reset input
		e.target.value = '';
	};

	const handleTriggerCreating = (data: TriggerInput) => {
		console.log('Creating trigger:', data);
	};

	const handleTriggerCreated = (data: TriggerInput) => {
		console.log('Trigger created:', data);
		setTriggerDialogOpen(false);
		// Mark the triggers tab as having new content
		setHasTriggers(true);
		if (activeWorkspaceTab !== 'triggers') {
			markTabAsUnviewed('triggers');
		}
	};

	if (!chatStore) {
		return <div>{t('triggers.loading')}</div>;
	}

	const authStore = useAuthStore.getState();

	// Add webview-show listener in useEffect with cleanup
	useEffect(() => {
		const handleWebviewShow = (_event: any, id: string) => {
			setActiveWebviewId(id);
		};

		window.ipcRenderer?.on("webview-show", handleWebviewShow);

		// Cleanup: remove listener on unmount
		return () => {
			window.ipcRenderer?.off("webview-show", handleWebviewShow);
		};
	}, []); // Empty dependency array means this only runs once

	// Detect files and triggers when project loads
	useEffect(() => {
		const detectAgentFiles = async () => {
			if (!projectStore.activeProjectId || !authStore.email) return;
			try {
				const files = await window.ipcRenderer?.invoke(
					"get-project-file-list",
					authStore.email,
					projectStore.activeProjectId
				);
				setHasAgentFiles(files && files.length > 0);
			} catch (error) {
				console.error('Error detecting agent files:', error);
			}
		};

		// For triggers, since we're using mock data, we set hasTriggers to true
		// When you have real trigger data, replace this with an API call
		setHasTriggers(true); // Mock data has triggers

		detectAgentFiles();
	}, [projectStore.activeProjectId, authStore.email, setHasAgentFiles, setHasTriggers]);

	useEffect(() => {
		let taskAssigning = [
			...(chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning ||
				[]),
		];
		let webviews: { id: string; agent_id: string; index: number }[] = [];
		taskAssigning.map((item) => {
			if (item.type === "browser_agent") {
				item.activeWebviewIds?.map((webview, index) => {
					webviews.push({ ...webview, agent_id: item.agent_id, index });
				});
			}
		});

		if (taskAssigning.length === 0) {
			return;
		}

		if (webviews.length === 0) {
			const browserAgent = taskAssigning.find(agent => agent.type === 'browser_agent');
			if (browserAgent && browserAgent.activeWebviewIds && browserAgent.activeWebviewIds.length > 0) {
				browserAgent.activeWebviewIds.forEach((webview, index) => {
					webviews.push({ ...webview, agent_id: browserAgent.agent_id, index });
				});
			}
		}

		if (webviews.length === 0) {
			return;
		}

		// capture webview
		const captureWebview = async () => {
			const activeTask = chatStore.tasks[chatStore.activeTaskId as string];
			if (!activeTask || activeTask.status === "finished") {
				return;
			}
			webviews.map((webview) => {
				window.ipcRenderer
					.invoke("capture-webview", webview.id)
					.then((base64: string) => {
						const currentTask = chatStore.tasks[chatStore.activeTaskId as string];
						if (!currentTask || currentTask.type) return;
						let taskAssigning = [
							...currentTask.taskAssigning,
						];
						const browserAgentIndex = taskAssigning.findIndex(
							(agent) => agent.agent_id === webview.agent_id
						);

						if (
							browserAgentIndex !== -1 &&
							base64 !== "data:image/jpeg;base64,"
						) {
							taskAssigning[browserAgentIndex].activeWebviewIds![
								webview.index
							].img = base64;
							chatStore.setTaskAssigning(
								chatStore.activeTaskId as string,
								taskAssigning
							);
							const { processTaskId, url } =
								taskAssigning[browserAgentIndex].activeWebviewIds![
									webview.index
								];
							chatStore.setSnapshotsTemp(chatStore.activeTaskId as string, {
								api_task_id: chatStore.activeTaskId,
								camel_task_id: processTaskId,
								browser_url: url,
								image_base64: base64,
							});

						}
					})
					.catch((error) => {
						console.error("capture webview error:", error);
					});
			});
		};

		let intervalTimer: NodeJS.Timeout | null = null;

		const initialTimer = setTimeout(() => {
			captureWebview();
			intervalTimer = setInterval(captureWebview, 2000);
		}, 2000);

		// cleanup function
		return () => {
			clearTimeout(initialTimer);
			if (intervalTimer) {
				clearInterval(intervalTimer);
			}
		};
	}, [chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning]);

	useEffect(() => {
		if (!chatStore.activeTaskId) {
			projectStore.createProject(t("layout.new-project"));
		}

		const webviewContainer = document.getElementById("webview-container");
		if (webviewContainer) {
			const resizeObserver = new ResizeObserver(() => {
				getSize();
			});
			resizeObserver.observe(webviewContainer);

			return () => {
				resizeObserver.disconnect();
			};
		}
	}, []);

	const getSize = () => {
		const webviewContainer = document.getElementById("webview-container");
		if (webviewContainer) {
			const rect = webviewContainer.getBoundingClientRect();
			window.electronAPI.setSize({
				x: rect.left,
				y: rect.top,
				width: rect.width,
				height: rect.height,
			});
		}
	};

	// Render workspace content based on active workspace tab
	const renderWorkspaceContent = () => {
		const activeTask = chatStore.activeTaskId ? chatStore.tasks[chatStore.activeTaskId] : null;
		const activeWorkSpace = activeTask?.activeWorkSpace;

		switch (activeWorkspaceTab) {
			case 'triggers':
				return (
					<div className={`w-full h-full ${wsConnectionStatus === 'disconnected' ? 'opacity-50 grayscale pointer-events-none' : ''}`}>
						<Overview />
					</div>
				);
			case 'inbox':
				return (
					<div className="w-full h-full flex-1 flex items-center justify-center">
						<div className="w-full h-full relative z-10">
							<Folder />
						</div>
					</div>
				);
			case 'workforce':
			default:
				// If no active task, show default workflow view
				if (!activeTask || !activeWorkSpace) {
					return (
						<div className="w-full h-full flex-1 flex items-center justify-center">
							<div className="w-full h-full flex flex-col relative">
								<div className="absolute inset-0 pointer-events-none bg-transparent rounded-xl"></div>
								<div className="w-full h-full relative z-10">
									<Workflow taskAssigning={[]} />
								</div>
							</div>
						</div>
					);
				}

				return (
					<>
						{activeTask.taskAssigning?.find(
							(agent) =>
								agent.agent_id === activeWorkSpace
						)?.type === "browser_agent" && (
								<div className="w-full h-full flex-1 flex animate-in fade-in-0 slide-in-from-right-2 duration-300">
									<BrowserAgentWorkSpace />
								</div>
							)}
						{activeWorkSpace === "workflow" && (
							<div className="w-full h-full flex-1 flex items-center justify-center">
								<div className="w-full h-full flex flex-col relative">
									{/*filter blur */}
									<div className="absolute inset-0 pointer-events-none bg-transparent rounded-xl"></div>
									<div className="w-full h-full relative z-10">
										<Workflow
											taskAssigning={activeTask.taskAssigning || []}
										/>
									</div>
								</div>
							</div>
						)}
						{activeTask.taskAssigning?.find(
							(agent) =>
								agent.agent_id === activeWorkSpace
						)?.type === "developer_agent" && (
								<div className="w-full h-full flex-1 flex">
									<TerminalAgentWrokSpace></TerminalAgentWrokSpace>
									{/* <Terminal content={[]} /> */}
								</div>
							)}
						{activeWorkSpace === "documentWorkSpace" && (
							<div className="w-full h-full flex-1 flex items-center justify-center">
								<div className="w-full h-full flex flex-col relative">
									{/*filter blur */}
									<div className="absolute inset-0 blur-bg pointer-events-none bg-surface-secondary rounded-xl"></div>
									<div className="w-full h-full relative z-10">
										<Folder />
									</div>
								</div>
							</div>
						)}
						{activeTask.taskAssigning?.find(
							(agent) =>
								agent.agent_id === activeWorkSpace
						)?.type === "document_agent" && (
								<div className="w-full h-full flex-1 flex items-center justify-center">
									<div className="w-full h-full flex flex-col relative">
										{/*filter blur */}
										<div className="absolute inset-0 blur-bg pointer-events-none bg-surface-secondary rounded-xl"></div>
										<div className="w-full h-full relative z-10">
											<Folder
												data={activeTask.taskAssigning?.find(
													(agent) =>
														agent.agent_id === activeWorkSpace
												)}
											/>
										</div>
									</div>
								</div>
							)}
						{/* Inbox Workspace - kept for backward compatibility */}
						{activeWorkSpace === "inbox" && (
							<div className="w-full h-full flex-1 flex items-center justify-center">
								<div className="w-full h-full flex flex-col relative">
									{/*filter blur */}
									<div className="absolute inset-0 blur-bg pointer-events-none bg-surface-secondary rounded-xl"></div>
									<div className="w-full h-full relative z-10">
										<Folder />
									</div>
								</div>
							</div>
						)}
					</>
				);
		}
	};

	// Render Tasks tab content (default)
	return (
		<ReactFlowProvider>
			<div className="h-full min-h-0 flex flex-row overflow-hidden pt-10 px-2 pb-2">
				<div className="flex-1 min-w-0 min-h-0 flex h-full items-center justify-center gap-4 relative overflow-hidden">
					<ResizablePanelGroup direction="horizontal" key={`${isChatBoxVisible}-${chatPanelPosition}`} className="w-full gap-0.5 justify-center items-center">
						{/* ChatBox Panel - Left side */}
						{isChatBoxVisible && chatPanelPosition === 'left' && (
							<>
								<ResizablePanel defaultSize={30} minSize={20} className="h-full">
									<ChatBox />
								</ResizablePanel>
								<ResizableHandle withHandle={true} className="custom-resizable-handle" />
							</>
						)}
						<ResizablePanel className="h-full w-full">
							{chatStore.activeTaskId && chatStore.tasks[chatStore.activeTaskId]?.activeWorkSpace ? (
								<div className="w-full h-full flex flex-col bg-surface-secondary border-solid border-border-tertiary rounded-2xl">
									{/* Header with workspace tabs */}
									<div className="w-full px-2 py-2 flex items-center justify-between">
										<div className="w-full flex flex-row items-center justify-start gap-4">
											<MenuToggleGroup
												type="single"
												variant="info"
												size="xs"
												orientation="horizontal"
												value={activeWorkspaceTab}
												onValueChange={(val) => val && setActiveWorkspaceTab(val as 'triggers' | 'workforce' | 'inbox')}
												className="bg-surface-primary rounded-lg"
											>
												<MenuToggleItem
													value="workforce"
													variant="info"
													size="xs"
													icon={<LayoutGrid />}
													className="w-32"
												>
													{t('triggers.workspace')}
												</MenuToggleItem>
												<MenuToggleItem
													value="inbox"
													variant="info"
													size="xs"
													icon={<Inbox />}
													showSubIcon={unviewedTabs.has('inbox')}
													subIcon={<span className="w-2 h-2 bg-red-500 rounded-full" />}
													className="w-32"
												>
													{t('triggers.agent-folder')}
												</MenuToggleItem>
												<MenuToggleItem
													value="triggers"
													variant="info"
													size="xs"
													icon={<ConnectionStatusIcon status={wsConnectionStatus} />}
													showSubIcon={unviewedTabs.has('triggers')}
													subIcon={<span className="w-2 h-2 bg-red-500 rounded-full" />}
													className="w-32"
												>
													{t('triggers.title')}
												</MenuToggleItem>
											</MenuToggleGroup>
										</div>
										<div className="flex items-center gap-2">
											{/* Refresh connection button - show when on triggers tab and not connected */}
											{activeWorkspaceTab === 'triggers' && wsConnectionStatus !== 'connected' && (
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8"
																onClick={triggerReconnect}
															>
																<RefreshCw className={`h-4 w-4 ${wsConnectionStatus === 'connecting' ? 'animate-spin' : ''}`} />
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															<p>Reconnect to trigger listener</p>
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											)}
											<Button
													variant="primary"
													size="sm"
													className="rounded-lg w-24 items-center justify-center"
													onClick={() => {
														if (activeWorkspaceTab === 'workforce') {
															setAddWorkerDialogOpen(true);
														} else if (activeWorkspaceTab === 'inbox') {
															fileInputRef.current?.click();
														} else if (activeWorkspaceTab === 'triggers') {
															setTriggerDialogOpen(true);
													}
												}}
											>
												<Plus />
												{activeWorkspaceTab === 'workforce' && t('triggers.add')}
												{activeWorkspaceTab === 'inbox' && t('triggers.upload')}
												{activeWorkspaceTab === 'triggers' && t('triggers.create')}
											</Button>
										</div>

										{/* Hidden file input for upload */}
										<input
											type="file"
											ref={fileInputRef}
											onChange={handleFileUpload}
											multiple
											className="hidden"
										/>

										{/* AddWorker Dialog */}
										<AddWorker
											isOpen={addWorkerDialogOpen}
											onOpenChange={setAddWorkerDialogOpen}
										/>

										{/* TriggerDialog */}
										<TriggerDialog
											selectedTrigger={null}
											onTriggerCreating={handleTriggerCreating}
											onTriggerCreated={handleTriggerCreated}
											isOpen={triggerDialogOpen}
											onOpenChange={setTriggerDialogOpen}
										/>
									</div>
									<div className="flex-1 min-h-0 w-full">
										<AnimatePresence mode="wait">
											<motion.div
												key={activeWorkspaceTab}
												initial={{ opacity: 0, filter: "blur(4px)" }}
												animate={{ opacity: 1, filter: "blur(0px)" }}
												exit={{ opacity: 0, filter: "blur(4px)" }}
												transition={{ duration: 0.2 }}
												className="w-full h-full"
											>
												{renderWorkspaceContent()}
											</motion.div>
										</AnimatePresence>
									</div>
									{activeWorkspaceTab === 'workforce' && (
										<BottomBar onToggleChatBox={toggleChatBox} isChatBoxVisible={isChatBoxVisible} />
									)}
								</div>
							) : (
								// Show default workspace when activeTaskId is null or task doesn't exist
								<div className="w-full h-full flex flex-col bg-surface-secondary border-solid border-border-tertiary rounded-2xl">
									{/* Header with workspace tabs */}
									<div className="w-full px-2 py-2 flex items-center justify-between">
										<div className="w-full flex flex-row items-center justify-start gap-4">
											<MenuToggleGroup
												type="single"
												variant="info"
												size="xs"
												orientation="horizontal"
												value={activeWorkspaceTab}
												onValueChange={(val) => val && setActiveWorkspaceTab(val as 'triggers' | 'workforce' | 'inbox')}
												className="bg-surface-primary rounded-lg"
											>
												<MenuToggleItem
													value="workforce"
													variant="info"
													size="xs"
													icon={<LayoutGrid />}
													className="w-32"
												>
													{t('triggers.workspace')}
												</MenuToggleItem>
												<MenuToggleItem
													value="inbox"
													variant="info"
													size="xs"
													icon={<Inbox />}
													showSubIcon={unviewedTabs.has('inbox')}
													subIcon={<span className="w-2 h-2 bg-red-500 rounded-full" />}
													className="w-32"
												>
													{t('triggers.agent-folder')}
												</MenuToggleItem>
												<MenuToggleItem
													value="triggers"
													variant="info"
													size="xs"
													icon={<ConnectionStatusIcon status={wsConnectionStatus} />}
													showSubIcon={unviewedTabs.has('triggers')}
													subIcon={<span className="w-2 h-2 bg-red-500 rounded-full" />}
													className="w-32"
												>
													{t('triggers.triggers')}
												</MenuToggleItem>
											</MenuToggleGroup>
										</div>
										<div className="flex items-center gap-2">
											{/* Refresh connection button - show when on triggers tab and not connected */}
											{activeWorkspaceTab === 'triggers' && wsConnectionStatus !== 'connected' && (
												<TooltipProvider>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8"
																onClick={triggerReconnect}
															>
																<RefreshCw className={`h-4 w-4 ${wsConnectionStatus === 'connecting' ? 'animate-spin' : ''}`} />
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															<p>Reconnect to trigger listener</p>
														</TooltipContent>
													</Tooltip>
												</TooltipProvider>
											)}
											<Button
												variant="primary"
												size="sm"
												className="rounded-lg"
												onClick={() => {
													if (activeWorkspaceTab === 'workforce') {
														setAddWorkerDialogOpen(true);
													} else if (activeWorkspaceTab === 'inbox') {
														fileInputRef.current?.click();
													} else if (activeWorkspaceTab === 'triggers') {
														setTriggerDialogOpen(true);
													}
												}}
											>
												<Plus />
												{activeWorkspaceTab === 'workforce' && t('triggers.add')}
												{activeWorkspaceTab === 'inbox' && t('triggers.add')}
												{activeWorkspaceTab === 'triggers' && t('triggers.add')}
											</Button>
										</div>

										{/* Hidden file input for upload */}
										<input
											type="file"
											ref={fileInputRef}
											onChange={handleFileUpload}
											multiple
											className="hidden"
										/>

										{/* AddWorker Dialog */}
										<AddWorker
											isOpen={addWorkerDialogOpen}
											onOpenChange={setAddWorkerDialogOpen}
										/>

										{/* TriggerDialog */}
										<TriggerDialog
											selectedTrigger={null}
											onTriggerCreating={handleTriggerCreating}
											onTriggerCreated={handleTriggerCreated}
											isOpen={triggerDialogOpen}
											onOpenChange={setTriggerDialogOpen}
										/>
									</div>
									<div className="flex-1 min-h-0 w-full">
										<AnimatePresence mode="wait">
											<motion.div
												key={activeWorkspaceTab}
												initial={{ opacity: 0, filter: "blur(4px)" }}
												animate={{ opacity: 1, filter: "blur(0px)" }}
												exit={{ opacity: 0, filter: "blur(4px)" }}
												transition={{ duration: 0.2 }}
												className="w-full h-full"
											>
												{renderWorkspaceContent()}
											</motion.div>
										</AnimatePresence>
									</div>
									{activeWorkspaceTab === 'workforce' && (
										<BottomBar onToggleChatBox={toggleChatBox} isChatBoxVisible={isChatBoxVisible} />
									)}
								</div>
							)}
						</ResizablePanel>
						{/* ChatBox Panel - Right side */}
						{isChatBoxVisible && chatPanelPosition === 'right' && (
							<>
								<ResizableHandle withHandle={true} className="custom-resizable-handle" />
								<ResizablePanel defaultSize={30} minSize={20} className="h-full">
									<ChatBox />
								</ResizablePanel>
							</>
						)}
					</ResizablePanelGroup>
				</div>
				<UpdateElectron />
			</div>
		</ReactFlowProvider>
	);
}
