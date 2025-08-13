import ChatBox from "@/components/ChatBox";
import Workflow from "@/components/WorkFlow";
import Folder from "@/components/Folder";
import Terminal from "@/components/Terminal";
import { useChatStore } from "@/store/chatStore";
import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import BottomBar from "@/components/BottomBar";
import SearchAgentWrokSpace from "@/components/SearchAgentWrokSpace";
import TerminalAgentWrokSpace from "@/components/TerminalAgentWrokSpace";
import { useSidebarStore } from "@/store/sidebarStore";
import UpdateElectron from "@/components/update";
import { proxyFetchPost } from "@/api/http";

export default function Home() {
	const { toggle } = useSidebarStore();
	const chatStore = useChatStore();
	const [activeWebviewId, setActiveWebviewId] = useState<string | null>(null);

	window.ipcRenderer.on("webview-show", (_event, id: string) => {
		setActiveWebviewId(id);
	});
	useEffect(() => {
		let taskAssigning = [
			...(chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning ||
				[]),
		];
		console.log('[Screenshot] useEffect triggered, taskAssigning:', taskAssigning);
		let webviews: { id: string; agent_id: string; index: number }[] = [];
		taskAssigning.map((item) => {
			if (item.type === "search_agent") {
				console.log('[Screenshot] Found search_agent:', item.agent_id, 'activeWebviewIds:', item.activeWebviewIds);
				item.activeWebviewIds?.map((webview, index) => {
					webviews.push({ ...webview, agent_id: item.agent_id, index });
				});
			}
		});

		if (taskAssigning.length === 0 || webviews.length === 0) {
			console.log('[Screenshot] No taskAssigning or webviews, skipping. taskAssigning:', taskAssigning.length, 'webviews:', webviews.length);
			return;
		}
		console.log('[Screenshot] webviews structure:', webviews);

		// capture webview
		const captureWebview = async () => {
			console.log('[Screenshot] Starting capture, task status:', chatStore.tasks[chatStore.activeTaskId as string]?.status);
			if (
				chatStore.tasks[chatStore.activeTaskId as string].status === "finished"
			) {
				console.log('[Screenshot] Task is finished, skipping capture');
				return;
			}
			console.log('[Screenshot] Capturing webviews:', webviews.length, 'webviews');
			webviews.map((webview) => {
				console.log('[Screenshot] Capturing webview:', webview.id, 'agent:', webview.agent_id);
				window.ipcRenderer
					.invoke("capture-webview", webview.id)
					.then((base64: string) => {
						console.log('[Screenshot] Capture result for webview', webview.id, 'length:', base64?.length || 0);
						if (chatStore.tasks[chatStore.activeTaskId as string].type) {
							console.log('[Screenshot] Task has type, skipping');
							return;
						}
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
							console.log('[Screenshot] Valid screenshot, updating agent:', webview.agent_id, 'index:', webview.index);
							taskAssigning[searchAgentIndex].activeWebviewIds![
								webview.index
							].img = base64;
							chatStore.setTaskAssigning(
								chatStore.activeTaskId as string,
								taskAssigning
							);
							console.log('[Screenshot] After setTaskAssigning, taskAssigning:', taskAssigning[searchAgentIndex]);
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
							console.log('[Screenshot] Successfully stored screenshot for URL:', url);
						} else {
							console.log('[Screenshot] Invalid screenshot or agent not found. searchAgentIndex:', searchAgentIndex, 'base64 empty:', base64 === "data:image/jpeg;base64,");
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
			console.log('[Screenshot] Starting initial capture');
			captureWebview();
			intervalTimer = setInterval(() => {
				console.log('[Screenshot] Interval capture triggered');
				captureWebview();
			}, 2000);
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
			chatStore.create();
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
			console.log("setSize", rect);
		}
	};

	return (
		<div className="h-full">
			<ReactFlowProvider>
				<div className="h-full flex flex-col">
					<div className="flex-1 flex items-center justify-center gap-2 relative">
						{/* left transparent area */}
						<div
							style={{
								position: "absolute",
								left: 0,
								top: 0,
								width: "5px",
								height: "100%",
								background: "transparent",
								zIndex: 20,
								cursor: "pointer",
							}}
							onMouseEnter={() => {
								toggle();
							}}
						/>
						<div
							className={`${
								chatStore.tasks[chatStore.activeTaskId as string]
									?.activeWorkSpace
									? "min-w-[316px] w-[316px]"
									: "min-w-[469px] w-[469px]"
							} h-full flex flex-col items-center justify-center transition-all duration-300`}
						>
							<ChatBox />
						</div>
						{chatStore.tasks[chatStore.activeTaskId as string]
							?.activeWorkSpace && (
							<div className="w-full h-full flex-1 flex flex-col animate-in fade-in-0 slide-in-from-right-2 duration-300">
								{chatStore.tasks[
									chatStore.activeTaskId as string
								]?.taskAssigning.find(
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
										<div className="w-full h-full flex flex-col rounded-2xl border border-transparent border-solid  p-2 relative">
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
								]?.taskAssigning.find(
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
								]?.taskAssigning.find(
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
													]?.taskAssigning.find(
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
								<BottomBar />
							</div>
						)}
					</div>
				</div>
			</ReactFlowProvider>
			<UpdateElectron />
		</div>
	);
}
