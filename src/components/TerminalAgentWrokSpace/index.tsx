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
import Terminal from "@/components/Terminal";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export default function TerminalAgentWrokSpace() {
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const { t } = useTranslation();
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
	};

	return isTakeControl ? (
		<div className="rounded-xl bg-menutabs-bg-default w-full h-full flex flex-col items-center justify-start border border-solid border-border-success">
			<div className="flex justify-start items-start w-full p-sm">
				<div className="p-1 rounded-full bg-transparent border border-solid border-border-primary">
					<Button
						size="sm"
						variant="success"
						onClick={() => {
							fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
								action: "resume",
							});
							setIsTakeControl(false);
							window.electronAPI.hideAllWebview();
						}}
						className="rounded-full"
					>
						<ChevronLeft size={16} className="text-text-inverse-primary" />
						<span className="text-sm text-text-inverse-primary font-bold leading-13">
							{t("chat.give-back-to-agent")}
						</span>
					</Button>
				</div>
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
							className={`h-[26px] px-2 py-0.5 flex items-center gap-xs rounded-lg  ${
								agentMap[activeAgent?.type as keyof typeof agentMap]
									?.bgColorLight
							}`}
						>
							<Bot className="w-4 h-4 text-icon-primary" />
							<div
								className={`text-[10px] leading-17 font-bold ${
									agentMap[activeAgent?.type as keyof typeof agentMap]
										?.textColor
								}`}
							>
								{agentMap[activeAgent?.type as keyof typeof agentMap]?.name}
							</div>
						</div>
						<div className="text-[10px] leading-17 font-medium text-text-tertiary">
							{
								activeAgent?.tasks?.filter(
									(task) => task.status && task.status !== "running"
								).length
							}
							/{activeAgent?.tasks?.length}
						</div>
					</div>
					<Button size="icon" variant="ghost">
						<Settings2 size={16} />
					</Button>
				</div>

				{activeAgent?.tasks.filter(
					(task) => task?.terminal && task?.terminal.length > 0
				)?.length === 1 ? (
					<div className="flex-1 min-h-0">
						{activeAgent?.tasks.filter(
							(task) => task?.terminal && task?.terminal.length > 0
						)[0] && (
							<div
								// onClick={() =>
								// 	handleTakeControl(
								// 		activeAgent?.activeWebviewIds?.[0]?.id || ""
								// 	)
								// }
								className="cursor-pointer relative h-full w-full group pt-sm rounded-b-2xl"
							>
								<Terminal
									instanceId={activeAgent?.activeWebviewIds?.[0]?.id}
									content={
										activeAgent?.tasks.filter(
											(task) => task?.terminal && task?.terminal.length > 0
										)[0].terminal
									}
								/>
								{/* <div className=" flex justify-center items-center opacity-0  transition-all group-hover:opacity-100 rounded-b-lg absolute inset-0 w-full h-full bg-black/20 pointer-events-none">
									<Button className="cursor-pointer px-md py-sm h-auto flex gap-sm rounded-full bg-bg-fill-primary">
										<Hand size={24} className="text-icon-inverse-primary" />
										<span className="text-base leading-9 font-medium text-text-inverse-primary">
											Take Control
										</span>
									</Button>
								</div> */}
							</div>
						)}
					</div>
				) : (
					activeAgent?.tasks.filter(
						(task) => task?.terminal && task?.terminal.length > 0
					) && (
						<div
							ref={scrollContainerRef}
							className={`${
								isSingleMode ? "px-0" : "px-2 pb-2"
							}  flex-1 min-h-0 overflow-y-auto scrollbar flex gap-4 justify-start flex-wrap relative`}
						>
							{activeAgent?.tasks
								.filter((task) => task?.terminal && task?.terminal.length > 0)
								.map((task) => {
									return (
										<div
											key={task.id}
											className={`cursor-pointer relative card-box rounded-lg  group ${
												isSingleMode
													? "h-[calc(100%)] w-[calc(100%)]"
													: "h-[calc(50%-8px)] w-[calc(50%-8px)]"
											}`}
										>
											<Terminal instanceId={task.id} content={task.terminal} />
											{/* <div
												onClick={() => handleTakeControl(task.id)}
												className="flex justify-center items-center opacity-0  transition-all group-hover:opacity-100 rounded-lg absolute inset-0 w-full h-full bg-black/20 pointer-events-none"
											>
												<Button className="cursor-pointer px-md py-sm h-auto flex gap-sm rounded-full bg-bg-fill-primary">
													<Hand
														size={24}
														className="text-icon-inverse-primary"
													/>
													<span className="text-base leading-9 font-medium text-text-inverse-primary">
														Take Control
													</span>
												</Button>
											</div> */}
										</div>
									);
								})}
						</div>
					)
				)}
				{activeAgent?.tasks.filter(
					(task) => task?.terminal && task?.terminal.length > 0
				).length !== 1 && (
					<div className="flex items-center gap-1 rounded-lg p-1 absolute bottom-2 right-2 w-auto bg-menutabs-bg-default border border-solid border-border-primary z-[200]">
						{isSingleMode && (
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
						)}
						{isSingleMode && (
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
						)}
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
