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
import { proxyFetchGet, proxyFetchDelete } from "@/api/http";
import { Tag } from "../ui/tag";
import { share } from "@/lib/share";
import { replayProject } from "@/lib";
import { useTranslation } from "react-i18next";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import {getAuthStore} from "@/store/authStore";
import { fetchGroupedHistoryTasks } from "@/service/historyApi";
import { HistoryTask, ProjectGroup } from "@/types/history";

export default function HistorySidebar() {
	const { t } = useTranslation();
	const { isOpen, close } = useSidebarStore();
	const navigate = useNavigate();
	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	const [searchValue, setSearchValue] = useState("");
	const [historyOpen, setHistoryOpen] = useState(true);
	const [historyTasks, setHistoryTasks] = useState<ProjectGroup[]>([]);
	const [deleteModalOpen, setDeleteModalOpen] = useState(false);
	const [anchorStyle, setAnchorStyle] = useState<{ left: number; top: number } | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const [currentProjectId, setCurrentProjectId] = useState("");

	const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.value) {
			setHistoryOpen(true);
		}
		setSearchValue(e.target.value);
	};

	const createChat = () => {
		close();
		//Create a new project
		//Handles refocusing id & non duplicate logic internally
		projectStore.createProject("new project");
		navigate("/");
	};

	useEffect(() => {
		fetchGroupedHistoryTasks(setHistoryTasks);
	}, [chatStore.updateCount]);

	const handleReplay = async (projectId: string, question: string, historyId: string) => {
		close();
		// Get task IDs from the API response data in descending order (newest first)
		const project = historyTasks.find(p => p.project_id === projectId);
		const taskIdsList = project?.tasks.map((task: HistoryTask) => task.task_id) || [projectId];
		await replayProject(projectStore, navigate, projectId, question, historyId, taskIdsList);
	};

	const handleDelete = (id: string) => {
		console.log("Delete task:", id);
		setCurrentProjectId(id);
		setDeleteModalOpen(true);
	};

	// Deletes whole Project
	const confirmDelete = async () => {
		await deleteWholeProject(currentProjectId);
		setHistoryTasks((list) => list.filter((item) => item.project_id !== currentProjectId));
		setCurrentProjectId("");
		setDeleteModalOpen(false);
	};

	const deleteHistoryTask = async (project: ProjectGroup, historyId: string) => {
		try {
			const res = await proxyFetchDelete(`/api/chat/history/${historyId}`);
			console.log(res);
			// also delete local files for this task if available (via Electron IPC)
			const  {email} = getAuthStore()
			const history = project.tasks.find((item: HistoryTask) => String(item.id) === historyId);
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

	// Deletes whole project by using the tasks from historyTasks state
	const deleteWholeProject = async (projectId: string) => {
		try {
			// Find the project in our existing data
			const targetProject = historyTasks.find(project => project.project_id === projectId);
			
			if (targetProject && targetProject.tasks) {
				console.log(`Found project ${projectId} with ${targetProject.tasks.length} tasks to delete`);
				
				// Delete each task one by one
				for (const history of targetProject.tasks) {
					console.log(`Deleting task: ${history.task_id} (history ID: ${history.id})`);
					try {
						const deleteRes = await proxyFetchDelete(`/api/chat/history/${history.id}`);
						console.log(`Successfully deleted task ${history.task_id}:`, deleteRes);
						
						// Also delete local files for this task if available (via Electron IPC)
						const {email} = getAuthStore();
						if (history.task_id && (window as any).ipcRenderer) {
							try {
								await (window as any).ipcRenderer.invoke('delete-task-files', email, history.task_id, history.project_id ?? undefined);
								console.log(`Successfully cleaned up local files for task ${history.task_id}`);
							} catch (error) {
								console.warn(`Local file cleanup failed for task ${history.task_id}:`, error);
							}
						}
					} catch (error) {
						console.error(`Failed to delete task ${history.task_id}:`, error);
					}
				}
				
				projectStore.removeProject(projectId);
				console.log(`Completed deletion of project ${projectId}`);
			} else {
				console.warn(`Project ${projectId} not found or has no tasks`);
			}
		} catch (error) {
			console.error("Failed to delete whole project:", error);
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
							<div className="px-sm py-4 flex flex-col gap-2">
								<AnimatePresence>
									{historyOpen && (
										<motion.div
											initial={{ height: 0, opacity: 0 }}
											animate={{ height: "auto", opacity: 1 }}
											exit={{ height: 0, opacity: 0 }}
											className=" flex-1"
										>
											<div className=" flex flex-col justify-start items-center gap-4 ">
											{historyTasks
												.filter((project) =>
													project.last_prompt?.toLowerCase().includes(searchValue.toLowerCase()) ||
													project.project_name?.toLowerCase().includes(searchValue.toLowerCase())
												)
												.map((project) => {
													return (
														<div
															onClick={() => {
																handleSetActive(project.project_id, project.last_prompt, project.project_id);
															}}
															key={project.project_id}
															className={`${
																chatStore.activeTaskId === project.project_id
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
																{project.last_prompt || project.project_name || t("layout.new-project")}
															</div>
														}
													>
														<span>
															{project.last_prompt || project.project_name || t("layout.new-project")}
														</span>
													</TooltipSimple>
												</div>
															<Tag
																variant="primary"
																className="text-xs leading-17 font-medium text-nowrap"
															>
																{t("layout.token")} {project.total_tokens || 0}
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
																					handleShare(project.project_id);
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
																					handleDelete(project.project_id);
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
