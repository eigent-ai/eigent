import { useSidebarStore } from "@/store/sidebarStore";
import { motion, AnimatePresence } from "framer-motion";
import {
	ArrowLeft,
	Bird,
	CodeXml,
	FileText,
	GalleryVerticalEnd,
	Globe,
	Plus,
	Image,
	ChevronDown,
	Ellipsis,
	Share,
	SquarePlay,
	Trash2,
	Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import SearchInput from "./SearchInput";
import { useEffect, useRef, useState } from "react";
import { useGlobalStore } from "@/store/globalStore";
import folderIcon from "@/assets/Folder-1.svg";
import { Progress } from "@/components/ui/progress";
import { TooltipSimple } from "../ui/tooltip";
import { generateUniqueId } from "@/lib";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
	PopoverClose,
} from "../ui/popover";
import AlertDialog from "../ui/alertDialog";
import { proxyFetchGet, proxyFetchDelete, proxyFetchPost } from "@/api/http";
import { Tag } from "../ui/tag";
import { share } from "@/lib/share";
import { replayProject } from "@/lib";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import {getAuthStore} from "@/store/authStore";

export default function HistorySidebar() {
	const { t } = useTranslation();
	const { isOpen, close } = useSidebarStore();
	const navigate = useNavigate();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const getTokens = chatStore.getTokens;
	const { history_type, toggleHistoryType } = useGlobalStore();
	const [searchValue, setSearchValue] = useState("");
	const [historyOpen, setHistoryOpen] = useState(true);
	const [historyTasks, setHistoryTasks] = useState<any[]>([]);
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
	const [anchorStyle, setAnchorStyle] = useState<{ left: number; top: number } | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const [curHistoryId, setCurHistoryId] = useState("");

	const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.value) {
			setHistoryOpen(true);
		}
		setSearchValue(e.target.value);
	};

	const toggleOpenHistory = async () => {
		if (!historyOpen) {
			await fetchHistoryTasks();
		}
		setHistoryOpen(!historyOpen);
	};

	const createChat = () => {
		close();
		//Create a new project
		//Handles refocusing id & non duplicate logic internally
		projectStore.createProject("new project");
		navigate("/");
	};

	const agentMap = {
		developer_agent: {
			name: t("layout.developer-agent"),
			textColor: "text-text-developer",
			bgColor: "bg-bg-fill-coding-active",
			shapeColor: "bg-bg-fill-coding-default",
			borderColor: "border-bg-fill-coding-active",
			bgColorLight: "bg-emerald-200",
		},
		search_agent: {
			name: t("layout.search-agent"),

			textColor: "text-blue-700",
			bgColor: "bg-bg-fill-browser-active",
			shapeColor: "bg-bg-fill-browser-default",
			borderColor: "border-bg-fill-browser-active",
			bgColorLight: "bg-blue-200",
		},
		document_agent: {
			name: t("layout.document-agent"),

			textColor: "text-yellow-700",
			bgColor: "bg-bg-fill-writing-active",
			shapeColor: "bg-bg-fill-writing-default",
			borderColor: "border-bg-fill-writing-active",
			bgColorLight: "bg-yellow-200",
		},
		multi_modal_agent: {
			name: t("layout.multi-modal-agent"),

			textColor: "text-fuchsia-700",
			bgColor: "bg-bg-fill-multimodal-active",
			shapeColor: "bg-bg-fill-multimodal-default",
			borderColor: "border-bg-fill-multimodal-active",
			bgColorLight: "bg-fuchsia-200",
		},
		social_medium_agent: {
			name: t("layout.social-media-agent"),

			textColor: "text-purple-700",
			bgColor: "bg-violet-700",
			shapeColor: "bg-violet-300",
			borderColor: "border-violet-700",
			bgColorLight: "bg-purple-50",
		},
	};

	const handleClickAgent = (taskId: string, agent_id: string) => {
		chatStore.setActiveTaskId(taskId);
		chatStore.setActiveWorkSpace(taskId, "workflow");
		chatStore.setActiveAgent(taskId, agent_id);
		navigate(`/`);
	};

	const fetchHistoryTasks = async () => {
		try {
			const res = await proxyFetchGet(`/api/chat/histories`);
			setHistoryTasks(res.items);
		} catch (error) {
			console.error("Failed to fetch history tasks:", error);
		}
	};

	useEffect(() => {
		fetchHistoryTasks();
	}, [chatStore.updateCount]);

	const handleReplay = async (projectId: string, question: string, historyId: string) => {
		close();
		await replayProject(projectStore, navigate, projectId, question, historyId);
	};

	const handleDelete = (id: string) => {
		console.log("Delete task:", id);
		setCurHistoryId(id);
		setDeleteModalOpen(true);
	};

	const confirmDelete = async () => {
		await deleteHistoryTask();
		setHistoryTasks((list) => list.filter((item) => item.id !== curHistoryId));
		setCurHistoryId("");
		setDeleteModalOpen(false);
	};

	const deleteHistoryTask = async () => {
		try {
			const res = await proxyFetchDelete(`/api/chat/history/${curHistoryId}`);
			console.log(res);
			// also delete local files for this task if available (via Electron IPC)
			const  {email} = getAuthStore()
			const history = historyTasks.find((item) => item.id === curHistoryId);
			if (history?.task_id && (window as any).ipcRenderer) {
				try {
					//TODO(file): rename endpoint to use project_id
					//TODO(history): make sure to sync to projectId when updating endpoint
					await (window as any).ipcRenderer.invoke('delete-task-files', email, history.task_id, history.project_id ?? undefined);
				} catch (error) {
					console.warn("Local file cleanup failed:", error);
				}
			}
		} catch (error) {
			console.error("Failed to delete history task:", error);
		}
	};

	const handleShare = async (taskId: string) => {
		close();
		share(taskId);
	};

	const handleSetActive = (projectId: string, question: string, historyId: string) => {
		const project = projectStore.getProjectById(projectId);
		//If project exists
		if (project) {
			// if there is record, show result
			projectStore.setHistoryId(projectId, historyId);
			projectStore.setActiveProject(projectId)
			navigate(`/`);
			close();
		} else {
			// if there is no record, execute replay
			handleReplay(projectId, question, historyId);
		}
	};

	useEffect(() => {
		const updateAnchor = () => {
			const btn = document.getElementById("active-task-title-btn");
			if (btn) {
				const rect = btn.getBoundingClientRect();
				setAnchorStyle({ left: rect.left, top: rect.bottom + 6 });
			}
		};

		if (isOpen) {
			updateAnchor();
			window.addEventListener("resize", updateAnchor);
		}

		return () => {
			window.removeEventListener("resize", updateAnchor);
		};
	}, [isOpen]);

	return (
		<AnimatePresence>
			{isOpen && (
				<>
					{/* alert dialog */}
					<AlertDialog
						isOpen={deleteModalOpen}
						onClose={() => setDeleteModalOpen(false)}
						onConfirm={confirmDelete}
						title={t("layout.delete-task")}
						message={t("layout.are-you-sure-you-want-to-delete")}
						confirmText={t("layout.delete")}
						cancelText={t("layout.cancel")}
					/>
					{/* background cover */}
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className="fixed inset-0 bg-transparent z-40 "
						onClick={close}
					/>
					{/* dropdown-style history panel under title bar */}
					<motion.div
						initial={{ y: -8, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						exit={{ y: -8, opacity: 0 }}
						transition={{ type: "spring", damping: 22, stiffness: 220 }}
						onMouseLeave={close}
						ref={panelRef}
						className="backdrop-blur-xl flex flex-col fixed w-[360px] max-h-[70vh] bg-bg-surface-tertiary rounded-xl p-sm z-50 shadow-perfect overflow-hidden"
						style={{
							left: anchorStyle ? anchorStyle.left : 0,
							top: anchorStyle ? anchorStyle.top : 40,
						}}
					>
						{/*<div className="flex items-center justify-between px-sm">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									close();
									navigate("/history");
								}}
								className="flex items-center gap-1 cursor-pointer"
							>
								<ArrowLeft size={16} />
								<span className="text-text-primary text-sm font-bold leading-13">
									{t("dashboard.task-hub")}
								</span>
							</Button>
							<Button
								onClick={() => toggleHistoryType()}
								variant="ghost"
								size="icon"
							>
								<GalleryVerticalEnd className="h-4 w-4" />
							</Button>
						</div>*/}
						<div className="py-2 pl-2 flex justify-between items-center">
							{/* Search */}
							<SearchInput 
							  value={searchValue} 
								onChange={handleSearch} 
				       />
							<Button variant="ghost" size="md" onClick={createChat}>
								<Plus className="w-8 h-8 text-icon-tertiary group-hover:text-icon-primary transition-all duration-300" />
							</Button>
						</div>
						<div className="mt-2 flex-1 min-h-0 overflow-y-auto scrollbar-hide">
							<div className="px-sm flex flex-col  gap-2">
									{/* Table view hidden
									{history_type === "table" ? (
										// Table
										<div className="flex justify-start items-center flex-wrap gap-2">
										{Object.keys(chatStore.tasks)
											.reverse()
											.map((taskId) => {
												const task = chatStore.tasks[taskId];
												return task.status != "finished" && !task.type ? (
													<div
														key={taskId}
														onClick={() => {
															chatStore.setActiveTaskId(taskId);
															navigate(`/`);
															close();
														}}
														className={`${
															chatStore.activeTaskId === taskId
																? "!bg-white-100%"
																: ""
														} max-w-full relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-3xl backdrop-blur-xl w-[316px] h-[180px]`}
													>
														<div className="px-6 flex justify-between items-center gap-md w-[284px] h-[180px]">
															<div className="w-[122px] py-md h-full flex flex-col gap-1">
																<div className="flex-1 flex justify-start items-end">
																	<img
																		className="w-[60px] h-[60px]"
																		src={folderIcon}
																		alt="folder-icon"
																	/>
																</div>
																<div className="text-left text-[14px] text-text-primary font-bold leading-9 overflow-hidden text-ellipsis break-words line-clamp-3">
																	{task?.messages[0]?.content || t("layout.new-project")}
																</div>
																<div className="w-full">
																	<Progress
																		value={task.progressValue}
																		className="h-[2px] w-full"
																	/>
																</div>
															</div>
															<div className="w-[122px] pt-md h-full flex flex-col gap-sm">
																<div className="flex justify-between items-center ">
																	<div className="text-xs leading-17 font-medium text-text-secondary">
																		{t("layout.tasks")}
																	</div>
																	<div className="text-xs leading-17 font-medium text-text-tertiary">
																		{task.taskRunning?.filter(
																			(taskItem) =>
																				taskItem.status === "completed" ||
																				taskItem.status === "failed"
																		).length || 0}
																		/{task.taskRunning?.length || 0}
																	</div>
																</div>
																<div className="w-[133px] h-full overflow-y-auto scrollbar-hide  flex flex-col gap-sm">
																	{task.taskAssigning.map(
																		(taskAssigning) =>
																			taskAssigning.status === "running" && (
																				<div
																					key={taskAssigning.agent_id}
																					onClick={() =>
																						handleClickAgent(
																							taskId,
																							taskAssigning.agent_id as AgentNameType
																						)
																					}
																					className={`transition-all duration-300 flex justify-start items-center gap-1 px-sm py-xs bg-menutabs-bg-default hover:bg-white-100% rounded-lg border border-solid border-white-100% shadow-history-item ${
																						agentMap[
																							taskAssigning.type as keyof typeof agentMap
																						]?.borderColor
																					}`}
																				>
																					<Bot
																						className={`w-3 h-3 ${
																							agentMap[
																								taskAssigning.type as keyof typeof agentMap
																							]?.textColor
																						}`}
																					/>
																					<div
																						className={`${
																							agentMap[
																								taskAssigning.type as keyof typeof agentMap
																							]?.textColor
																						} text-xs leading-17 font-medium`}
																					>
																						{taskAssigning.name}
																					</div>
																				</div>
																			)
																	)}
																</div>
															</div>
														</div>
													</div>
												) : (
													""
												);
											})}
									</div>
								) : (
									// List
								*/}
									<div className=" flex flex-col justify-start items-center gap-2 ">
										{Object.keys(chatStore.tasks)
											.reverse()
											.map((taskId) => {
												const task = chatStore.tasks[taskId];
												return task.status != "finished" && !task.type ? (
													<div
														key={taskId}
														onClick={() => {
															chatStore.setActiveTaskId(taskId);
															navigate(`/`);
															close();
														}}
														className={`${
															chatStore.activeTaskId === taskId
																? "!bg-white-100%"
																: ""
														} max-w-full flex w-full items-center border-radius-2xl bg-white-30% box-sizing-border-box p-3 relative h-14 gap-md transition-all duration-300 hover:bg-white-100% rounded-2xl cursor-pointer`}
													>
														<img
															className="w-8 h-8"
															src={folderIcon}
															alt="folder-icon"
														/>
												<div className="flex-1 overflow-hidden text-text-body text-ellipsis text-body-sm font-bold whitespace-nowrap">
													<TooltipSimple
														content={
															<p>
																{task?.messages[0]?.content || t("layout.new-project")}
															</p>
														}
														className="w-[300px] bg-surface-tertiary p-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
													>
														<span>
															{task?.messages[0]?.content || t("dashboard.new-project")}
														</span>
													</TooltipSimple>
														</div>
													</div>
												) : (
													""
												);
											})}
										</div>
									{/* )} */}
							</div>
							<div className="px-sm py-4 flex flex-col gap-2">
								<AnimatePresence>
									{historyOpen && (
										<motion.div
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											className=" flex-1"
										>
										{/* Table view hidden
										{history_type === "table" ? (
											// Table
											<div className="flex justify-start items-center flex-wrap gap-2 ">
													{historyTasks
														.filter((task) =>
															task?.question
																?.toLowerCase()
																.includes(searchValue.toLowerCase())
														)
														.map((task) => {
															return (
																<div
																	onClick={() =>
																		handleSetActive(task.task_id, task.question, task.id)
																	}
																	key={task.task_id}
																	className={`${
																		chatStore.activeTaskId === task?.task_id
																			? "!bg-white-100%"
																			: ""
																	} max-w-full relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-3xl w-[316px] h-[180px] p-6 shadow-history-item`}
																>
																	<div className="absolute h-[calc(100%+2px)] w-14 border border-solid border-[rgba(154,154,162,0.3)] border-t-transparent border-b-transparent rounded-3xl pointer-events-none top-[-1px] left-[-1px] border-r-transparent"></div>
																	<div className="absolute h-[calc(100%+2px)] w-14 border border-solid border-[rgba(154,154,162,0.3)] border-t-transparent border-b-transparent rounded-3xl pointer-events-none top-[-1px] right-[-1px] border-l-transparent"></div>
																	<div className="flex justify-between items-end gap-1">
																		<img
																			className="w-[60px] h-[60px] mt-2"
																			src={folderIcon}
																			alt="folder-icon"
																		/>
																		<Tag variant="primary">
																			{t("layout.token")} {task.tokens || 0}
																		</Tag>
																	</div>

																	<div className="text-[14px] text-text-primary font-bold leading-9 overflow-hidden text-ellipsis whitespace-nowrap">
																		{task?.question.split("|")[0] ||
																			t("dashboard.new-project")}
																	</div>
																	<div className="text-xs text-black leading-17  overflow-hidden text-ellipsis break-words line-clamp-2">
																		{task?.question.split("|")[1] ||
																			t("dashboard.new-project")}
																	</div>
																</div>
															);
														})}
											</div>
										) : (
										    // List
										*/}
											<div className=" flex flex-col justify-start items-center gap-4 ">
											{historyTasks
												.filter((task) =>
													task.question?.toLowerCase().includes(searchValue.toLowerCase())
												)
												.map((task) => {
													return (
														<div
															onClick={() => {
																handleSetActive(task.task_id, task.question, task.id);
															}}
															key={task.task_id}
															className={`${
																chatStore.activeTaskId === task.task_id
																	? "!bg-white-100%"
																	: ""
															} max-w-full relative cursor-pointer transition-all duration-300 bg-white-30% hover:bg-white-100% rounded-2xl flex justify-between items-center gap-md w-full p-3 h-14 shadow-history-item border border-solid border-border-disabled`}
														>
															<img className="w-8 h-8" src={folderIcon} alt="folder-icon" />
						
												<div className="w-full text-body-sm text-text-body font-bold overflow-hidden text-ellipsis whitespace-nowrap">
													<TooltipSimple
														align="start"
														className="w-[300px] bg-surface-tertiary p-2 text-wrap break-words text-label-xs select-text pointer-events-auto shadow-perfect"
														content={
															<div>
																{" "}
																{task?.question.split("|")[0] || t("layout.new-project")}
															</div>
														}
													>
														<span>
															{" "}
															{task?.question.split("|")[0] || t("layout.new-project")}
														</span>
													</TooltipSimple>
												</div>
															<Tag
																variant="primary"
																className="text-xs leading-17 font-medium text-nowrap"
															>
																{t("layout.token")} {task.tokens || 0}
															</Tag>
						
															<Popover>
																<PopoverTrigger asChild>
																	<Button
																		size="icon"
																		onClick={(e) => e.stopPropagation()}
																		variant="ghost"
																	>
																		<Ellipsis size={16} className="text-text-primary" />
																	</Button>
																</PopoverTrigger>
																<PopoverContent className=" w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
																	<div className="space-y-1">
																		<PopoverClose asChild>
																			<Button
																				variant="ghost"
																				size="sm"
																				className="w-full"
																				onClick={(e) => {
																					e.stopPropagation();
																					handleShare(task.task_id);
																				}}
																			>
																				<Share size={16} />
																				{t("layout.share")}
																			</Button>
																		</PopoverClose>
						
																		<PopoverClose asChild>
																			<Button
																				variant="ghost"
																				size="sm"
																				className="w-full"
																				onClick={(e) => {
																					e.stopPropagation();
																					handleDelete(task.id);
																				}}
																			>
																				<Trash2
																					size={16}
																					className="text-icon-primary group-hover:text-icon-cuation"
																				/>
																				{t("layout.delete")}
																			</Button>
																		</PopoverClose>
																	</div>
																</PopoverContent>
															</Popover>
														</div>
													);
											})}
												</div>
											{/* )} */}
										</motion.div>
									)}
								</AnimatePresence>
							</div>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}
