import { Handle, Position, useReactFlow, NodeResizer } from "@xyflow/react";
import { useEffect, useRef, useState, useCallback } from "react";
import {
	FileText,
	Globe,
	Bird,
	CodeXml,
	Image,
	Bot,
	SquareCode,
	Ellipsis,
	LoaderCircle,
	CircleCheckBig,
	Circle,
	CircleSlash,
	TriangleAlert,
	Trash2,
	SquareChevronLeft,
	CircleSlash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Folder from "../Folder";
import Terminal from "../Terminal";
import { useAuthStore, useWorkerList } from "@/store/authStore";
import ShinyText from "../ui/ShinyText/ShinyText";
import { MarkDown } from "./MarkDown";
import { Tooltip, TooltipTrigger } from "../ui/tooltip";
import { TooltipContent } from "@radix-ui/react-tooltip";
import { TaskState, TaskStateType } from "../TaskState";
import {
	Popover,
	PopoverClose,
	PopoverContent,
	PopoverTrigger,
} from "../ui/popover";
import { AddWorker } from "@/components/AddWorker";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

interface NodeProps {
	id: string;
	data: {
		img: ActiveWebView[];
		agent?: Agent;
		type: AgentNameType;
		isExpanded: boolean;
		onExpandChange: (nodeId: string, isExpanded: boolean) => void;
		isEditMode: boolean;
		workerInfo: {
			name: string;
			description: string;
			tools: any;
			mcp_tools: any;
			selectedTools: any;
		};
	};
}

export function Node({ id, data }: NodeProps) {
	const [isExpanded, setIsExpanded] = useState(data.isExpanded);
	const [selectedTask, setSelectedTask] = useState<any>(null);
	const [selectedState, setSelectedState] = useState<TaskStateType>("all");

	const [filterTasks, setFilterTasks] = useState<any[]>([]);
	useEffect(() => {
		const tasks = data.agent?.tasks || [];

		if (selectedState === "all") {
			setFilterTasks(tasks);
		} else {
			const newFiltered = tasks.filter((task) => {
				switch (selectedState) {
					case "done":
						return task.status === "completed" && !task.reAssignTo;
					case "reassigned":
						return !!task.reAssignTo;
					case "ongoing":
						return (
							task.status !== "failed" &&
							task.status !== "completed" &&
							task.status !== "skipped" &&
							task.status !== "waiting" &&
							task.status !== "" &&
							!task.reAssignTo
						);
					case "pending":
						return (
							(task.status === "skipped" ||
								task.status === "waiting" ||
								task.status === "") &&
							!task.reAssignTo
						);
					case "failed":
						return task.status === "failed";
					default:
						return false;
				}
			});
			setFilterTasks(newFiltered);
		}
	}, [selectedState, data.agent?.tasks]);

	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const { setCenter, getNode, setViewport, setNodes } = useReactFlow();
	const workerList = useWorkerList();
	const { setWorkerList } = useAuthStore();
	const nodeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		setIsExpanded(data.isExpanded);
	}, [data.isExpanded]);

	// manually control node size
	useEffect(() => {
		if (data.isEditMode) {
			const targetWidth = isExpanded ? 684 : 342;
			const targetHeight = 600;

			setNodes((nodes) =>
				nodes.map((node) => {
					if (node.id === id) {
						return {
							...node,
							style: {
								...node.style,
								width: targetWidth,
								height: targetHeight,
							},
						};
					}
					return node;
				})
			);
		}
	}, [isExpanded, data.isEditMode, id, setNodes]);

	const handleShowLog = () => {
		if (!isExpanded) {
			setSelectedTask(
				data.agent?.tasks.find((task) => task.status === "running") ||
					data.agent?.tasks[0]
			);
		}
		setIsExpanded(!isExpanded);
		data.onExpandChange(id, !isExpanded);
	};

	useEffect(() => {
		if (chatStore.tasks[chatStore.activeTaskId as string]?.activeAgent === id) {
			const node = getNode(id);
			if (node) {
				setTimeout(() => {
					setViewport(
						{ x: -node.position.x, y: 0, zoom: 1 },
						{
							duration: 500,
						}
					);
				}, 100);
			}
		}
	}, [
		chatStore.tasks[chatStore.activeTaskId as string]?.activeAgent,
		id,
		setCenter,
		getNode,
	]);

	const wrapperRef = useRef<HTMLDivElement>(null);
	const toolsRef = useRef<HTMLDivElement>(null);
	const [shouldScroll, setShouldScroll] = useState(false);
	const [toolsHeight, setToolsHeight] = useState(0);

	useEffect(() => {
		if (wrapperRef.current) {
			const { scrollHeight, clientHeight } = wrapperRef.current;
			setShouldScroll(scrollHeight > clientHeight);
		}
	}, [data.agent?.tasks, toolsHeight]);

	// dynamically calculate tool label height
	useEffect(() => {
		if (toolsRef.current) {
			const height = toolsRef.current.offsetHeight;
			setToolsHeight(height);
		}
	}, [data.agent?.tools]);

	const logRef = useRef<HTMLDivElement>(null);
	const rePortRef = useRef<HTMLDivElement>(null);

	const wheelHandler = useCallback((e: WheelEvent) => {
		e.stopPropagation();
	}, []);

	useEffect(() => {
		const wrapper = wrapperRef.current;
		const log = logRef.current;

		if (wrapper) {
			wrapper.addEventListener("wheel", wheelHandler, { passive: false });
		}

		if (log) {
			log.addEventListener("wheel", wheelHandler, { passive: false });
		}

		return () => {
			if (wrapper) {
				wrapper.removeEventListener("wheel", wheelHandler);
			}
			if (log) {
				log.removeEventListener("wheel", wheelHandler);
			}
		};
	}, [
		wheelHandler,
		isExpanded,
		selectedTask,
		selectedTask?.report?.rePort?.content,
	]);

	const agentMap = {
		developer_agent: {
			name: "Developer Agent",
			icon: <CodeXml size={16} className="text-text-primary" />,
			textColor: "text-text-developer",
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

	const agentToolkits = {
		developer_agent: [
			"# Terminal & Shell ",
			"# Web Deployment ",
			"# Screen Capture ",
		],
		search_agent: ["# Web Browser ", "# Search Engines "],
		multi_modal_agent: [
			"# Image Analysis ",
			"# Video Processing ",
			"# Audio Processing ",
			"# Image Generation ",
		],
		document_agent: [
			"# File Management ",
			"# Data Processing ",
			"# Document Creation ",
		],
	};

	const getTaskId = (taskId: string) => {
		const list = taskId.split(".");
		let idStr = "";
		list.shift();
		list.map((i: string, index: number) => {
			idStr += Number(i) + (index === list.length - 1 ? "" : ".");
		});
		return idStr;
	};
	return (
		<>
			<NodeResizer
				minWidth={isExpanded ? 684 : 342}
				minHeight={300}
				isVisible={data.isEditMode}
				keepAspectRatio={false}
				color="transparent"
				lineStyle={{ stroke: "transparent" }}
			/>
			<Handle
				className="opacity-0 !h-0 !w-0 !min-h-0 !min-w-0"
				type="target"
				position={Position.Top}
				id="top"
			/>
			<div
				ref={nodeRef}
				className={`${
					data.isEditMode
						? `w-full ${isExpanded ? "min-w-[560px]" : "min-w-[342px]"}`
						: isExpanded
						? "w-[684px]"
						: "w-[342px]"
				} ${
					data.isEditMode ? "h-full" : "max-h-[calc(100vh-200px)]"
				}  border-worker-border-default flex border border-solid rounded-xl overflow-hidden bg-worker-surface-primary ${
					chatStore.tasks[chatStore.activeTaskId as string].activeAgent === id
						? `${agentMap[data.type]?.borderColor} z-50`
						: "border-worker-border-default z-10"
				} transition-all duration-300 ease-in-out ${
					data.agent?.tasks.length === 0 && "opacity-30"
				}`}
			>
				<div
					className={`py-2 px-3 pr-0 flex flex-col ${
						data.isEditMode ? "flex-1 min-w-[342px]" : "w-[342px] "
					}`}
				>
					<div className=" flex items-center justify-between gap-sm pr-3">
						<div className="flex items-center justify-between gap-md">
							<div
								className={`text-base leading-relaxed font-bold ${
									agentMap[data.type]?.textColor
								}`}
							>
								{agentMap[data.type]?.name || data.agent?.name}
							</div>
						</div>
						<div className="flex items-center gap-xs">
							<Button onClick={handleShowLog} variant="ghost" size="icon">
								{isExpanded ? <SquareChevronLeft /> : <SquareCode />}
							</Button>
							{!Object.keys(agentMap).find((key) => key === data.type) &&
								chatStore.tasks[chatStore.activeTaskId as string].messages
									.length === 0 && (
									<Popover>
										<PopoverTrigger asChild>
											<Button
												onClick={(e) => e.stopPropagation()}
												variant="ghost"
												size="icon"
											>
												<Ellipsis />
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-[98px]  p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
											<div className="space-y-1">
												<PopoverClose asChild>
													<AddWorker
														edit={true}
														workerInfo={data.agent as Agent}
													/>
												</PopoverClose>
												<PopoverClose asChild>
													<Button
														variant="ghost"
														size="sm"
														className="w-full justify-start gap-2"
														onClick={(e) => {
															e.stopPropagation();
															const newWorkerList = workerList.filter(
																(worker) => worker.type !== data.workerInfo.name
															);
															setWorkerList(newWorkerList);
														}}
													>
														<Trash2
															size={16}
															className="text-icon-primary group-hover:text-icon-cuation"
														/>
														Delete
													</Button>
												</PopoverClose>
											</div>
										</PopoverContent>
									</Popover>
								)}
						</div>
					</div>
					<div
						ref={toolsRef}
						className="flex-shrink-0 text-text-label text-xs leading-tight min-h-4 font-normal mb-sm pr-3 text-"
					>
						{/* {JSON.stringify(data.agent)} */}
						{agentToolkits[
							data.agent?.type as keyof typeof agentToolkits
						]?.join(" ") ||
							data.agent?.tools
								?.map((tool) => (tool ? "# " + tool.replace(/_/g, " ") : ""))
								.filter(Boolean)
								.join(" ") ||
							"No Toolkits"}
					</div>
					<div
						className="max-h-[180px]"
						onClick={() => {
							chatStore.setActiveWorkSpace(
								chatStore.activeTaskId as string,
								data.agent?.agent_id as string
							);

							window.electronAPI.hideAllWebview();
						}}
					>
						{/* {data.img.length} */}
						{data.img && data.img.filter((img) => img?.img).length > 0 && (
							<div className="max-w-[260px] h-[180px] overflow-hidden relative flex items-center justify-start gap-1 flex-wrap">
								{data.img
									.filter((img) => img?.img)
									.slice(0, 4)
									.map(
										(img, index) =>
											img.img && (
												<img
													key={index}
													className={`${
														data.img.length === 1
															? "flex-1"
															: data.img.length === 2
															? "max-w-[calc(50%-8px)] h-full"
															: "max-w-[calc(50%-8px)] h-[calc(50%-8px)]"
													}  min-w-[calc(50%-8px)] rounded-sm object-cover`}
													src={img.img}
													alt={data.type}
												/>
											)
									)}
							</div>
						)}
						{data.type === "document_agent" && (
							<div className="overflow-hidden w-full h-[180px] rounded-sm relative">
								<div className="absolute left-0 top-0  scale-[0.3] w-[500px] h-[500px] origin-top-left">
									<Folder data={data.agent as Agent} />
								</div>
							</div>
						)}

						{data.type === "developer_agent" &&
							data?.agent?.tasks &&
							data?.agent?.tasks?.filter(
								(task) => task.terminal && task.terminal.length > 0
							)?.length > 0 && (
								<div className="w-full h-[180px] overflow-hidden relative flex items-center justify-start gap-1 flex-wrap">
									{data.agent?.tasks
										.filter((task) => task.terminal && task.terminal.length > 0)
										.slice(0, 4)
										.map((task) => {
											return (
												<div
													key={task.id}
													className={`${
														data.agent?.tasks.filter(
															(task) =>
																task.terminal && task.terminal.length > 0
														).length === 1
															? "min-w-full h-full"
															: "min-w-[calc(50%-8px)] h-[calc(50%-8px)]"
													}  flex-1 rounded-sm object-cover relative overflow-hidden`}
												>
													<div className="absolute left-0 top-0 scale-x-[0.4]  scale-y-[0.3] w-[800px] h-[500px] origin-top-left">
														<Terminal content={task.terminal} />
													</div>
												</div>
											);
										})}
								</div>
							)}
					</div>
					{data.agent?.tasks && data.agent?.tasks.length > 0 && (
						<div className="flex flex-col items-start justify-between gap-1 pt-sm border-[0px] border-t border-solid border-task-border-default pr-3">
							{/* <div className="font-bold leading-tight text-xs">Subtasks</div> */}
							<div className="flex-1 flex justify-end">
								<TaskState
									all={data.agent.tasks?.length || 0}
									done={
										data.agent?.tasks?.filter(
											(task) => task.status === "completed" && !task.reAssignTo
										).length || 0
									}
									reAssignTo={
										data.agent.tasks?.filter((task) => task.reAssignTo)
											?.length || 0
									}
									progress={
										data.agent?.tasks?.filter(
											(task) =>
												task.status !== "failed" &&
												task.status !== "completed" &&
												task.status !== "skipped" &&
												task.status !== "waiting" &&
												task.status !== "" &&
												!task.reAssignTo
										).length || 0
									}
									skipped={
										data.agent?.tasks?.filter(
											(task) =>
												(task.status === "skipped" ||
													task.status === "waiting" ||
													task.status === "") &&
												!task.reAssignTo
										).length || 0
									}
									failed={
										data.agent?.tasks?.filter(
											(task) => task.status === "failed"
										).length || 0
									}
									selectedState={selectedState}
									onStateChange={setSelectedState}
									clickable={true}
								/>
							</div>
						</div>
					)}
					<div
						ref={wrapperRef}
						onWheel={(e) => {
							e.stopPropagation();
						}}
						className={`mt-sm flex flex-col gap-2 animate-in fade-in-0 slide-in-from-bottom-4 duration-500 ease-out overflow-y-auto scrollbar pr-3 ${
							shouldScroll && "!overflow-y-scroll scrollbar "
						}`}
						style={{
							maxHeight:
								data.img && data.img.length > 0
									? `calc(100vh - 200px - 180px - 60px - ${toolsHeight}px)`
									: `calc(100vh - 200px - 60px - ${toolsHeight}px)`,
						}}
					>
						{data.agent?.tasks &&
							filterTasks.map((task, index) => {
								return (
									<div
										onClick={() => {
											setSelectedTask(task);
											setIsExpanded(true);
											data.onExpandChange(id, true);
											if (task.agent) {
												chatStore.setActiveWorkSpace(
													chatStore.activeTaskId as string,
													"workflow"
												);
												chatStore.setActiveAgent(
													chatStore.activeTaskId as string,
													task.agent?.agent_id
												);
												window.electronAPI.hideAllWebview();
											}
										}}
										key={`taskList-${task.id}-${task.failure_count}`}
										className={`rounded-lg flex gap-2 py-sm px-sm transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2 ${
											task.reAssignTo
												? "bg-task-fill-warning"
												: task.status === "completed"
												? "bg-green-50"
												: task.status === "failed"
												? "bg-task-fill-error"
												: task.status === "running"
												? "bg-zinc-50"
												: task.status === "blocked"
												? "bg-task-fill-warning"
												: "bg-zinc-50"
										} border border-solid border-transparent cursor-pointer ${
											task.status === "completed"
												? "hover:border-bg-fill-success-primary"
												: task.status === "failed"
												? "hover:border-task-border-focus-error"
												: task.status === "running"
												? "hover:border-border-primary"
												: task.status === "blocked"
												? "hover:border-task-border-focus-warning"
												: "border-transparent"
										} ${
											selectedTask?.id === task.id
												? task.status === "completed"
													? "!border-bg-fill-success-primary"
													: task.status === "failed"
													? "!border-text-cuation-primary"
													: task.status === "running"
													? "!border-border-primary"
													: task.status === "blocked"
													? "!border-text-warning-primary"
													: "border-transparent"
												: "border-transparent"
										}`}
									>
										<div className="">
											{task.reAssignTo ? (
												//  reassign to other agent
												<CircleSlash2 size={16} className="text-icon-warning" />
											) : (
												// normal task
												<>
													{task.status === "running" && (
														<LoaderCircle
															size={16}
															className={`text-icon-information ${
																chatStore.tasks[
																	chatStore.activeTaskId as string
																].status === "running" && "animate-spin"
															}`}
														/>
													)}
													{task.status === "skipped" && (
														<LoaderCircle
															size={16}
															className={`text-icon-secondary `}
														/>
													)}
													{task.status === "completed" && (
														<CircleCheckBig
															size={16}
															className="text-icon-success"
														/>
													)}
													{task.status === "failed" && (
														<CircleSlash
															size={16}
															className="text-icon-cuation"
														/>
													)}
													{task.status === "blocked" && (
														<TriangleAlert
															size={16}
															className="text-icon-warning"
														/>
													)}
													{(task.status === "" ||
														task.status === "waiting") && (
														<Circle size={16} className="text-slate-400" />
													)}
												</>
											)}
										</div>
										<div className="flex-1 flex flex-col items-start justify-center">
											<div
												className={`w-full flex-grow-0 ${
													task.status === "failed"
														? "text-text-cuation-default"
														: task.status === "blocked"
														? "text-text-body"
														: "text-text-primary"
												} text-xs font-medium leading-13 select-text pointer-events-auto break-all text-wrap whitespace-pre-line`}
											>
												<div className="flex items-center gap-sm">
													<div className="text-text-body text-xs font-bold leading-13">
														No. {getTaskId(task.id)}
													</div>
													{task.reAssignTo ? (
														<div className="text-text-warning text-xs font-bold leading-none rounded-lg px-1 py-0.5 bg-tag-fill-document">
															Reassigned to {task.reAssignTo}
														</div>
													) : (
														(task.failure_count ?? 0) > 0 && (
															<div
																className={`${
																	task.status === "failed"
																		? "bg-red-100 text-text-cuation"
																		: task.status === "completed"
																		? "bg-tag-fill-developer text-text-success-default"
																		: "bg-tag-surface-hover text-text-label"
																}  text-xs font-bold leading-none rounded-lg px-1 py-0.5`}
															>
																Attempt {task.failure_count}
															</div>
														)
													)}
												</div>
												<div>{task.content}</div>
											</div>
											{task?.status === "running" && (
												<div className="flex items-center gap-2 mt-xs animate-in fade-in-0 slide-in-from-bottom-2 duration-400">
													{/* active toolkit */}
													{task.toolkits &&
														task.toolkits.length > 0 &&
														task.toolkits
															.filter(
																(tool: any) => tool.toolkitName !== "notice"
															)
															.at(-1)?.toolkitStatus === "running" && (
															<div className="flex-1 min-w-0 flex justify-start items-center gap-sm animate-in fade-in-0 slide-in-from-right-2 duration-300">
																{agentMap[data.type]?.icon ?? (
																	<Bot className="w-3 h-3" />
																)}
																<div
																	className={`${
																		chatStore.tasks[
																			chatStore.activeTaskId as string
																		].activeWorkSpace
																			? "!w-[100px]"
																			: "!w-[500px]"
																	} pt-1 flex-shrink-0 flex-grow-0 min-w-0 text-text-primary text-xs leading-17 overflow-hidden text-ellipsis whitespace-nowrap`}
																>
																	<ShinyText
																		text={task.toolkits?.[0].toolkitName}
																		className="select-text pointer-events-auto w-full text-text-primary text-xs leading-17 font-bold overflow-hidden text-ellipsis whitespace-nowrap"
																	/>
																</div>
															</div>
														)}
												</div>
											)}
										</div>
									</div>
								);
							})}
					</div>
				</div>
				{isExpanded && (
					<div
						key={selectedTask?.id || "empty"}
						className={`${
							data.isEditMode ? "flex-1" : "w-[342px]"
						}  flex flex-col gap-sm border-l  bg-worker-surface-secondary rounded-r-xl px-sm pr-0 py-3 pt-sm animate-in fade-in-0 slide-in-from-right-2 duration-300 `}
					>
						<div
							ref={logRef}
							key={selectedTask?.id + "-log" || "empty"}
							onWheel={(e) => {
								e.stopPropagation();
							}}
							className=" flex flex-col gap-sm  my-2 scrollbar max-h-[calc(100vh-200px)] scrollbar-gutter-stable overflow-y-auto pr-sm"
						>
							{selectedTask &&
								selectedTask.toolkits &&
								selectedTask.toolkits.length > 0 &&
								selectedTask.toolkits.map((toolkit: any, index: number) => (
									<div key={`toolkit-${toolkit.toolkitId}`}>
										{toolkit.toolkitName === "notice" ? (
											<div
												key={`notice-${index}`}
												className="!w-[calc(100%-10px)] flex flex-col gap-sm pl-1 py-2 "
											>
												<MarkDown
													content={toolkit?.message}
													enableTypewriter={false}
													pTextSize="text-[10px]"
													olPadding="pl-0"
												/>
											</div>
										) : (
											<Tooltip>
												<TooltipTrigger asChild>
													<div
														key={`toolkit-${index}`}
														onClick={(e) => {
															e.stopPropagation();
															if (toolkit.toolkitMethods === "write to file") {
																chatStore.tasks[
																	chatStore.activeTaskId as string
																].activeWorkSpace = "documentWorkSpace";
															} else if (
																toolkit.toolkitMethods === "visit page"
															) {
																const parts = toolkit.message.split("\n");
																const url = parts[0]; // the first line is the URL
																window.location.href = url;
															} else if (toolkit.toolkitMethods === "scrape") {
																window.location.href = toolkit.message;
															}
														}}
														className="py-0.5 px-xs bg-log-default rounded-sm flex gap-xs items-start hover:opacity-50 transition-all duration-300"
													>
														{/* {toolkit.toolkitStatus} */}
														<div>
															{toolkit.toolkitStatus === "running" ? (
																<LoaderCircle
																	size={16}
																	className={`${
																		chatStore.tasks[
																			chatStore.activeTaskId as string
																		].status === "running" && "animate-spin"
																	}`}
																/>
															) : (
																agentMap[data.type]?.icon
															)}
														</div>
														<div className="flex-1 flex flex-col items-start overflow-hidden select-text pointer-events-auto">
															<span className="text-xs text-text-primary font-bold flex items-center gap-sm text-nowrap ">
																{toolkit.toolkitName}
															</span>
															<div className="flex-1 flex items-start gap-sm max-w-full">
																<div className=" flex-1 text-xs text-text-primary font-medium flex items-center gap-sm">
																	<div className="text-nowrap font-bold">
																		{toolkit.toolkitMethods}
																	</div>

																	<div
																		className={` text-text-primary text-xs ${
																			data.isEditMode
																				? "overflow-hidden max-h-[15px]"
																				: "overflow-hidden text-ellipsis whitespace-nowrap"
																		}`}
																	>
																		{toolkit.message}
																	</div>
																</div>
															</div>
														</div>
													</div>
												</TooltipTrigger>
												{toolkit.message && (
													<TooltipContent
														align="start"
														className="border border-solid border-task-border-default w-[200px] max-h-[200px] overflow-y-auto scrollbar bg-white-100% p-2 text-wrap break-words z-[9999] !fixed rounded-sm text-xs select-text pointer-events-auto"
														side="left"
														sideOffset={200}
													>
														<MarkDown
															content={toolkit.message}
															enableTypewriter={false}
															pTextSize="text-[10px]"
															olPadding="pl-0"
														/>
													</TooltipContent>
												)}
											</Tooltip>
										)}
									</div>
								))}
							{selectedTask?.report && (
								<div
									ref={rePortRef}
									onWheel={(e) => {
										e.stopPropagation();
									}}
									className="w-full flex flex-col gap-sm my-2 "
								>
									<div className="text-text-primary text-sm font-bold">
										Completion Report
									</div>
									<MarkDown
										content={selectedTask?.report}
										enableTypewriter={false}
										pTextSize="text-[10px]"
										olPadding="pl-0"
									/>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
			<Handle
				className="opacity-0 !h-0 !w-0 !min-h-0 !min-w-0"
				type="source"
				position={Position.Bottom}
				id="bottom"
			/>
		</>
	);
}
