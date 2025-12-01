import { useEffect, useState, useRef } from "react";
import {
	ArrowDown,
	ArrowUp,
	Bird,
	Bot,
	ChevronLeft,
	CodeXml,
	FileText,
	GalleryThumbnails,
	Globe,
	Hand,
	Image,
	Settings2,
} from "lucide-react";
import { Button } from "../ui/button";
import { fetchPut } from "@/api/http";
import { TaskState } from "../TaskState";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export default function Home() {
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const [isSingleMode, setIsSingleMode] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const agentMap = {
		developer_agent: {
			name: "Developer Agent",
			icon: <CodeXml size={16} className="text-text-primary" />,
			textColor: "text-emerald-700",
			bgColor: "bg-bg-fill-coding-active",
			shapeColor: "bg-bg-fill-coding-default",
			borderColor: "border-bg-fill-coding-active",
			bgColorLight: "bg-emerald-200",
		},
		search_agent: {
			name: "Search Agent",
			icon: <Globe size={16} className="text-text-primary" />,
			textColor: "text-blue-700",
			bgColor: "bg-bg-fill-browser-active",
			shapeColor: "bg-bg-fill-browser-default",
			borderColor: "border-bg-fill-browser-active",
			bgColorLight: "bg-blue-200",
		},
		document_agent: {
			name: "Document Agent",
			icon: <FileText size={16} className="text-text-primary" />,
			textColor: "text-yellow-700",
			bgColor: "bg-bg-fill-writing-active",
			shapeColor: "bg-bg-fill-writing-default",
			borderColor: "border-bg-fill-writing-active",
			bgColorLight: "bg-yellow-200",
		},
		multi_modal_agent: {
			name: "Multi Modal Agent",
			icon: <Image size={16} className="text-text-primary" />,
			textColor: "text-fuchsia-700",
			bgColor: "bg-bg-fill-multimodal-active",
			shapeColor: "bg-bg-fill-multimodal-default",
			borderColor: "border-bg-fill-multimodal-active",
			bgColorLight: "bg-fuchsia-200",
		},
		social_medium_agent: {
			name: "Social Media Agent",
			icon: <Bird size={16} className="text-text-primary" />,
			textColor: "text-purple-700",
			bgColor: "bg-violet-700",
			shapeColor: "bg-violet-300",
			borderColor: "border-violet-700",
			bgColorLight: "bg-purple-50",
		},
	};
	const [activeAgent, setActiveAgent] = useState<Agent | null>(null);
	useEffect(() => {
		const taskAssigning =
			chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning;
		if (taskAssigning) {
			const activeAgent = taskAssigning.find(
				(item) =>
					item.agent_id ===
					chatStore.tasks[chatStore.activeTaskId as string]?.activeWorkSpace
			);
			setActiveAgent(() => {
				if (activeAgent) {
					return activeAgent;
				}
				return null;
			});
		}
	}, [
		chatStore.tasks[chatStore.activeTaskId as string].taskAssigning,
		chatStore.tasks[chatStore.activeTaskId as string].activeWorkSpace,
	]);

	const [isTakeControl, setIsTakeControl] = useState(false);
	const handleTakeControl = (id: string) => {
		console.log("handleTakeControl", id);
		fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
			action: "pause",
		});

		setIsTakeControl(true);
		setTimeout(() => {
			getSize();
			// show corresponding webview
			window.electronAPI.showWebview(id);
		}, 400);
	};

	// listen to webview container size
	useEffect(() => {
		if (!projectStore.activeProjectId) {
			projectStore.createProject("new project");
			console.warn("No active projectId found in WorkSpace, creating a new project");
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

	const [url, setUrl] = useState("");

	useEffect(() => {
		window.ipcRenderer?.on("url-updated", (_event, newUrl) => {
			setUrl(newUrl);
		});

		// optional: clear listener when uninstall
		return () => {
			window.ipcRenderer.removeAllListeners("url-updated");
		};
	}, []);

	return isTakeControl ? (
		<div className="rounded-xl bg-menutabs-bg-default w-full h-full flex flex-col items-center justify-start border border-solid border-border-success">
			<div className="flex justify-start items-start w-full p-sm gap-sm">
				<div className="p-1 rounded-full bg-transparent border border-solid border-border-primary">
					<Button
						onClick={() => {
							fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
								action: "resume",
							});
							setIsTakeControl(false);
							window.electronAPI.hideAllWebview();
						}}
						size="sm"
						variant="success"
						className="rounded-full"
					>
						<ChevronLeft size={16} />
						<span>Give back to Agent</span>
					</Button>
				</div>
				{/* <div className="mx-2 bg-border-primary">{url}</div> */}
			</div>
			<div id="webview-container" className="w-full h-full"></div>
		</div>
	) : (
		<div
			className={`w-full flex-1 h-[calc(100vh-104px)] flex items-center justify-center transition-all duration-300 ease-in-out`}
		>
			<div className="w-full h-full flex flex-col rounded-2xl relative bg-menutabs-bg-default overflow-hidden">
				<div className="pt-3 pb-2 px-2 rounded-t-2xl flex items-center justify-between flex-shrink-0">
					<div className="flex items-center justify-start gap-sm">
						<Button
							size="icon"
							variant="ghost"
							onClick={() => {
								chatStore.setActiveWorkSpace(
									chatStore.activeTaskId as string,
									"workflow"
								);
							}}
						>
							<ChevronLeft size={16} />
						</Button>
						<div
							className={`text-base leading-snug font-bold ${
								agentMap[activeAgent?.type as keyof typeof agentMap]?.textColor
							}`}
						>
							{agentMap[activeAgent?.type as keyof typeof agentMap]?.name}
						</div>
						<TaskState
							all={activeAgent?.tasks?.length || 0}
							reAssignTo={
								activeAgent?.tasks?.filter((task) => task.reAssignTo).length ||
								0
							}
							done={
								activeAgent?.tasks?.filter(
									(task) => task.status === "completed"
								).length || 0
							}
							progress={
								activeAgent?.tasks?.filter(
									(task) =>
										task.status !== "failed" &&
										task.status !== "completed" &&
										task.status !== "skipped" &&
										task.status !== "waiting"
								).length || 0
							}
							failed={
								activeAgent?.tasks?.filter((task) => task.status === "failed")
									.length || 0
							}
							skipped={
								activeAgent?.tasks?.filter(
									(task) =>
										task.status === "skipped" || task.status === "waiting"
								).length || 0
							}
						/>
						{/* <div className="text-[10px] leading-17 font-medium text-text-tertiary">
							{
								activeAgent?.tasks?.filter(
									(task) => task.status && task.status !== "running"
								).length
							}
							/{activeAgent?.tasks?.length}
						</div> */}
					</div>
					{/* <div className="w-6 h-6 flex items-center justify-center">
						<Settings2 size={16} />
					</div> */}
				</div>

				{activeAgent?.activeWebviewIds?.length === 1 ? (
					<div className="flex-1 min-h-0">
						{activeAgent?.activeWebviewIds[0]?.img && (
							<div
								onClick={() =>
									handleTakeControl(
										activeAgent?.activeWebviewIds?.[0]?.id || ""
									)
								}
								className="cursor-pointer relative h-full w-full group pt-sm rounded-b-2xl"
							>
								<img
									src={activeAgent?.activeWebviewIds[0]?.img}
									alt=""
									className="w-full h-full object-contain rounded-b-2xl"
								/>
								<div className=" flex justify-center items-center opacity-0  transition-all group-hover:opacity-100 rounded-b-lg absolute inset-0 w-full h-full bg-black/20 pointer-events-none">
									<Button
										size="sm"
										variant="primary"
										className="cursor-pointer rounded-full"
									>
										<Hand size={24} />
										<span className="text-base leading-9 font-medium">
											Take Control
										</span>
									</Button>
								</div>
							</div>
						)}
					</div>
				) : (
					<div
						ref={scrollContainerRef}
						className={`${
							isSingleMode ? "px-0" : "px-2 pb-2"
						}  flex-1 min-h-0 overflow-y-auto scrollbar flex gap-4 justify-start flex-wrap relative`}
					>
						{activeAgent?.activeWebviewIds
							?.filter((item) => item?.img)
							.map((item, index) => {
								return (
									<div
										key={index}
										onClick={() => handleTakeControl(item.id)}
										className={`cursor-pointer relative card-box rounded-lg  group ${
											isSingleMode
												? "h-[calc(100%)] w-[calc(100%)]"
												: "h-[calc(50%-8px)] w-[calc(50%-8px)]"
										}`}
									>
										{item.img && (
											<img
												src={item.img}
												alt=""
												className="w-full h-full object-contain rounded-2xl"
											/>
										)}
										<div
											onClick={() =>
												handleTakeControl(
													activeAgent?.activeWebviewIds?.[0]?.id || ""
												)
											}
											className="flex justify-center items-center opacity-0  transition-all group-hover:opacity-100 rounded-lg absolute inset-0 w-full h-full bg-black/20 pointer-events-none"
										>
											<Button
												size="sm"
												variant="primary"
												className="cursor-pointer rounded-full"
											>
												<Hand size={24} />
												<span className="text-base leading-9 font-medium">
													Take Control
												</span>
											</Button>
										</div>
									</div>
								);
							})}
					</div>
				)}
				{activeAgent?.activeWebviewIds?.length !== 1 && (
					<div className="flex items-center gap-1 rounded-lg p-1 absolute bottom-2 right-2 w-auto bg-menutabs-bg-default border border-solid border-border-primary z-100">
						<Button
							size="icon"
							variant="ghost"
							onClick={() => {
								if (scrollContainerRef.current) {
									const container = scrollContainerRef.current;
									const card = container.querySelector("div.card-box");
									if (!card) return;
									const cardHeight = card.getBoundingClientRect().height;
									const gap = 16;
									const rowCount = isSingleMode ? 1 : 2;
									const scrollAmount = (cardHeight + gap) * rowCount;
									container.scrollTo({
										top: Math.min(
											container.scrollHeight - container.clientHeight,
											container.scrollTop + scrollAmount
										),
										behavior: "smooth",
									});
								}
							}}
						>
							<ArrowDown size={16} />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							onClick={() => {
								if (scrollContainerRef.current) {
									const container = scrollContainerRef.current;
									const card = container.querySelector("div.card-box");
									if (!card) return;
									const cardHeight = card.getBoundingClientRect().height;
									const gap = 16;
									const rowCount = isSingleMode ? 1 : 2;
									const scrollAmount = (cardHeight + gap) * rowCount;
									container.scrollTo({
										top: Math.max(0, container.scrollTop - scrollAmount),
										behavior: "smooth",
									});
								}
							}}
						>
							<ArrowUp size={16} />
						</Button>
						<Button
							size="icon"
							variant="ghost"
							onClick={() => {
								setIsSingleMode(!isSingleMode);
								if (scrollContainerRef.current) {
									scrollContainerRef.current.scrollTo({
										top: 0,
										behavior: "smooth",
									});
								}
							}}
						>
							<GalleryThumbnails size={16} />
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
