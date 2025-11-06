import ChatBox from "@/components/ChatBox";
import Workflow from "@/components/WorkFlow";
import Folder from "@/components/Folder";
import Terminal from "@/components/Terminal";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ReactFlowProvider } from "@xyflow/react";
import BottomBar from "@/components/BottomBar";
import SearchAgentWrokSpace from "@/components/SearchAgentWrokSpace";
import TerminalAgentWrokSpace from "@/components/TerminalAgentWrokSpace";
import { useSidebarStore } from "@/store/sidebarStore";
import UpdateElectron from "@/components/update";
import { proxyFetchPost } from "@/api/http";
import { replayActiveTask } from "@/lib";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import SideBar from "@/components/SideBar";

export default function Home() {
	const { toggle } = useSidebarStore();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const [activeWebviewId, setActiveWebviewId] = useState<string | null>(null);
	const [isChatVisible, setIsChatVisible] = useState(true);
	const [isReplayLoading, setIsReplayLoading] = useState(false);
	const navigate = useNavigate();
	const activeTask = chatStore.tasks[chatStore.activeTaskId as string];

	const handleReplay = async () => {
		if (!chatStore.activeTaskId) return;
		setIsReplayLoading(true);
		await replayActiveTask(chatStore, projectStore, navigate);
		setIsReplayLoading(false);
	};

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

	useEffect(() => {
		let taskAssigning = [
			...(chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning ||
				[]),
		];
		let webviews: { id: string; agent_id: string; index: number }[] = [];
		taskAssigning.map((item) => {
			if (item.type === "search_agent") {
				item.activeWebviewIds?.map((webview, index) => {
					webviews.push({ ...webview, agent_id: item.agent_id, index });
				});
			}
		});

		if (taskAssigning.length === 0) {
			return;
		}
		
		if (webviews.length === 0) {
			const searchAgent = taskAssigning.find(agent => agent.type === 'search_agent');
			if (searchAgent && searchAgent.activeWebviewIds && searchAgent.activeWebviewIds.length > 0) {
				searchAgent.activeWebviewIds.forEach((webview, index) => {
					webviews.push({ ...webview, agent_id: searchAgent.agent_id, index });
				});
			}
		}
		
		if (webviews.length === 0) {
			return;
		}

		// capture webview
		const captureWebview = async () => {
			if (
				chatStore.tasks[chatStore.activeTaskId as string].status === "finished"
			) {
				return;
			}
			webviews.map((webview) => {
				window.ipcRenderer
					.invoke("capture-webview", webview.id)
					.then((base64: string) => {
						if (chatStore.tasks[chatStore.activeTaskId as string].type) return;
						let taskAssigning = [
							...chatStore.tasks[chatStore.activeTaskId as string]
								.taskAssigning,
						];
						const searchAgentIndex = taskAssigning.findIndex(
							(agent) => agent.agent_id === webview.agent_id
						);

						if (
							searchAgentIndex !== -1 &&
							base64 !== "data:image/jpeg;base64,"
						) {
							taskAssigning[searchAgentIndex].activeWebviewIds![
								webview.index
							].img = base64;
							chatStore.setTaskAssigning(
								chatStore.activeTaskId as string,
								taskAssigning
							);
							const { processTaskId, url } =
								taskAssigning[searchAgentIndex].activeWebviewIds![
									webview.index
								];
							chatStore.setSnapshotsTemp(chatStore.activeTaskId as string, {
								api_task_id: chatStore.activeTaskId,
								camel_task_id: processTaskId,
								browser_url: url,
								image_base64: base64,
							});
						
						}
						// let list: any = [];
						// taskAssigning.forEach((item: any) => {
						// 	item.activeWebviewIds.forEach((item2: any) => {
						// 		if (item2.img && item2.url && item2.processTaskId) {
						// 			list.push({
						// 				api_task_id: chatStore.activeTaskId,
						// 				camel_task_id: item2.processTaskId,
						// 				browser_url: item2.url,
						// 				image_base64: item2.img,
						// 			});
						// 		}
						// 	});
						// });
						// chatStore.setSnapshots(chatStore.activeTaskId as string, list);
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
			projectStore.createProject("new project");
		}

		const handleFocusChatbox = () => {
			setIsChatVisible(true);
			requestAnimationFrame(() => {
				window.dispatchEvent(new CustomEvent("focus-chatbox-input"));
			});
		};

		window.addEventListener("focus-chatbox", handleFocusChatbox);

		const webviewContainer = document.getElementById("webview-container");
		if (webviewContainer) {
			const resizeObserver = new ResizeObserver(() => {
				getSize();
			});
			resizeObserver.observe(webviewContainer);

			return () => {
				resizeObserver.disconnect();
				window.removeEventListener("focus-chatbox", handleFocusChatbox);
			};
		}

		return () => {
			window.removeEventListener("focus-chatbox", handleFocusChatbox);
		};
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
			console.log("setSize", rect);
		}
	};

		return (
			<div className="w-full h-full min-h-0 flex flex-col overflow-hidden pt-10 px-2">
				<ReactFlowProvider>
					<div className="flex-col w-full h-full min-w-0 min-h-0 flex items-center justify-center gap-2 relative overflow-hidden border-solid border-border-tertiary rounded-2xl bg-surface-secondary bg-blur">
				<ResizablePanelGroup direction="horizontal" dir="ltr">
							{isChatVisible && (
								<>
									<ResizablePanel defaultSize={30} minSize={20}>
										<ChatBox />
									</ResizablePanel>
									<ResizableHandle
										withHandle={true}
										className="custom-resizable-handle"
									/>
								</>
							)}
							<ResizablePanel>
						{chatStore.tasks[chatStore.activeTaskId as string]
							?.activeWorkSpace && (
							<div className="w-full h-full flex-1 flex flex-col animate-in fade-in-0 slide-in-from-right-2 duration-300">
								{chatStore.tasks[
									chatStore.activeTaskId as string
								]?.taskAssigning?.find(
									(agent) =>
										agent.agent_id ===
										chatStore.tasks[chatStore.activeTaskId as string]
											.activeWorkSpace
								)?.type === "search_agent" && (
									<div className="w-full h-[calc(100vh-104px)] flex-1 flex animate-in fade-in-0 slide-in-from-right-2 duration-300">
										<SearchAgentWrokSpace />
									</div>
								)}
								{chatStore.tasks[chatStore.activeTaskId as string]
									?.activeWorkSpace === "workflow" && (
									<div className="w-full h-full flex-1 flex items-center justify-center animate-in fade-in-0 slide-in-from-right-2 duration-300">
										<div className="w-full h-full flex flex-col rounded-2xl border border-transparent border-solid relative">
											{/*filter blur */}
											<div className="absolute inset-0 pointer-events-none bg-transparent rounded-xl"></div>
											<div className="w-full h-full relative z-10">
												<Workflow
													taskAssigning={
														chatStore.tasks[chatStore.activeTaskId as string]
															?.taskAssigning || []
													}
												/>
											</div>
										</div>
									</div>
								)}
								{chatStore.tasks[
									chatStore.activeTaskId as string
								]?.taskAssigning?.find(
									(agent) =>
										agent.agent_id ===
										chatStore.tasks[chatStore.activeTaskId as string]
											.activeWorkSpace
								)?.type === "developer_agent" && (
									<div className="w-full h-[calc(100vh-104px)] flex-1 flex animate-in fade-in-0 slide-in-from-right-2 duration-300">
										<TerminalAgentWrokSpace></TerminalAgentWrokSpace>
										{/* <Terminal content={[]} /> */}
									</div>
								)}
								{chatStore.tasks[chatStore.activeTaskId as string]
									.activeWorkSpace === "documentWorkSpace" && (
									<div className="w-full h-[calc(100vh-104px)] flex-1 flex items-center justify-center animate-in fade-in-0 slide-in-from-right-2 duration-300">
										<div className="w-full h-[calc(100vh-104px)] flex flex-col rounded-2xl border border-zinc-300 border-solid relative">
											{/*filter blur */}
											<div className="absolute inset-0 blur-bg pointer-events-none bg-white-50 rounded-xl"></div>
											<div className="w-full h-full relative z-10">
												<Folder />
											</div>
										</div>
									</div>
								)}
								{chatStore.tasks[
									chatStore.activeTaskId as string
								]?.taskAssigning?.find(
									(agent) =>
										agent.agent_id ===
										chatStore.tasks[chatStore.activeTaskId as string]
											.activeWorkSpace
								)?.type === "document_agent" && (
									<div className="w-full h-[calc(100vh-104px)] flex-1 flex items-center justify-center animate-in fade-in-0 slide-in-from-right-2 duration-300">
										<div className="w-full h-[calc(100vh-104px)] flex flex-col rounded-2xl border border-zinc-300 border-solid relative">
											{/*filter blur */}
											<div className="absolute inset-0 blur-bg pointer-events-none bg-white-50 rounded-xl"></div>
											<div className="w-full h-full relative z-10">
												<Folder
													data={chatStore.tasks[
														chatStore.activeTaskId as string
													]?.taskAssigning?.find(
														(agent) =>
															agent.agent_id ===
															chatStore.tasks[chatStore.activeTaskId as string]
																.activeWorkSpace
													)}
												/>
											</div>
										</div>
									</div>
								)}
							</div>
						)}
							</ResizablePanel>
							{/* Fixed sidebar on the right
							<div className="h-full z-30">
								<SideBar />
							</div>*/}
							</ResizablePanelGroup>
					</div>
					<BottomBar
						onToggleChat={() => setIsChatVisible((prev) => !prev)}
						isChatVisible={isChatVisible}
						tokens={activeTask?.tokens || 0}
						taskStatus={activeTask?.status}
						onReplay={handleReplay}
						replayDisabled={!activeTask}
						replayLoading={isReplayLoading}
					/>
			</ReactFlowProvider>
			<UpdateElectron />
		</div>
	);
}
