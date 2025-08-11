import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TaskType } from "./TaskType";
import { TaskItem } from "./TaskItem";
import ShinyText from "@/components/ui/ShinyText/ShinyText";

import { useChatStore } from "@/store/chatStore";

import {
	Bird,
	CodeXml,
	FileText,
	Globe,
	Plus,
	Image,
	CircleCheckBig,
	LoaderCircle,
	Bot,
	ChevronDown,
	Circle,
	TriangleAlert,
	CircleSlash,
} from "lucide-react";
import { useMemo, useState, useRef, useEffect } from "react";
import { TaskState } from "../TaskState";

interface TaskCardProps {
	taskInfo: any[];
	taskAssigning: Agent[];
	taskRunning: TaskInfo[];
	taskType: 1 | 2 | 3;
	progressValue: number;
	summaryTask: string;
	onAddTask: () => void;
	onUpdateTask: (taskIndex: number, content: string) => void;
	onDeleteTask: (taskIndex: number) => void;
}

export function TaskCard({
	taskInfo,
	taskType,
	taskRunning,
	progressValue,
	summaryTask,
	onAddTask,
	onUpdateTask,
	onDeleteTask,
}: TaskCardProps) {
	const [isExpanded, setIsExpanded] = useState(true);
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number | "auto">("auto");

	const chatStore = useChatStore();

	const isAllTaskFinished = useMemo(() => {
		return (
			chatStore.tasks[chatStore.activeTaskId as string].status === "finished"
		);
	}, [chatStore.tasks[chatStore.activeTaskId as string].status]);

	useEffect(() => {
		if (
			chatStore.tasks[chatStore.activeTaskId as string].activeWorkSpace ===
			"workflow"
		) {
			setIsExpanded(false);
		} else {
			setIsExpanded(true);
		}
	}, [chatStore.tasks[chatStore.activeTaskId as string].activeWorkSpace]);

	// Improved height calculation logic
	useEffect(() => {
		if (!contentRef.current) return;

		const updateHeight = () => {
			if (contentRef.current) {
				const scrollHeight = contentRef.current.scrollHeight;
				setContentHeight(scrollHeight);
			}
		};

		// Update height immediately
		updateHeight();

		// Use ResizeObserver to monitor content changes
		const resizeObserver = new ResizeObserver(() => {
			updateHeight();
		});

		resizeObserver.observe(contentRef.current);

		// Update height when taskRunning changes
		const timeoutId = setTimeout(updateHeight, 100);

		return () => {
			resizeObserver.disconnect();
			clearTimeout(timeoutId);
		};
	}, [taskRunning, isExpanded]);

	// Handle height updates specifically for expand/collapse state changes
	useEffect(() => {
		if (!contentRef.current || !isExpanded) return;

		const updateHeightOnExpand = () => {
			if (contentRef.current && isExpanded) {
				// Small delay to ensure DOM is fully rendered
				requestAnimationFrame(() => {
					if (contentRef.current) {
						setContentHeight(contentRef.current.scrollHeight);
					}
				});
			}
		};

		// Update height immediately when expanded
		updateHeightOnExpand();

		// Additional delay when expanded to ensure all animations complete
		if (isExpanded) {
			const timeoutId = setTimeout(updateHeightOnExpand, 300);
			return () => clearTimeout(timeoutId);
		}
	}, [isExpanded]);

	return (
		<div>
			<div className="w-full h-auto flex flex-col gap-2 py-sm transition-all duration-300">
				<div className="w-full h-auto bg-task-surface backdrop-blur-[5px] rounded-xl py-sm relative overflow-hidden">
					<div className="absolute top-0 left-0 w-full bg-transparent">
						<Progress value={progressValue} className="h-[2px] w-full" />
					</div>
					<div className="text-sm font-bold leading-13 mb-2.5 px-sm">
						{summaryTask
							? summaryTask.split("|")[0].replace(/"/g, "")
							: "New Task"}
					</div>

					<div className={`flex items-center justify-between gap-2 px-sm`}>
						<div className="flex items-center gap-2 ">
							{taskType === 1 && (
								<TaskState
									done={0}
									progress={
										taskInfo.filter((task) => task.content !== "").length || 0
									}
									skipped={0}
								/>
							)}
							{taskType !== 1 && (
								<TaskState
									done={
										taskRunning?.filter(
											(task) =>
												task.status === "completed" || task.status === "failed"
										).length || 0
									}
									progress={
										taskRunning?.filter(
											(task) =>
												task.status !== "completed" &&
												task.status !== "failed" &&
												task.status !== "skipped" &&
												task.content !== ""
										).length || 0
									}
									skipped={
										taskRunning?.filter((task) => task.status === "skipped")
											.length || 0
									}
								/>
							)}
						</div>

						<div className="transition-all duration-300 ease-in-out">
							{taskType === 1 && (
								<Button variant="ghost" size="icon" onClick={onAddTask}>
									<Plus size={16} />
								</Button>
							)}
							{taskType === 2 && (
								<div className="flex items-center gap-2 animate-in fade-in-0 slide-in-from-right-2 duration-300">
									{(isExpanded || isAllTaskFinished) && (
										<div className="text-text-tertiary text-xs font-medium leading-17">
											{taskRunning?.filter(
												(task) =>
													task.status === "completed" ||
													task.status === "failed"
											).length || 0}
											/{taskRunning?.length || 0}
										</div>
									)}
									<Button
										variant="ghost"
										size="icon"
										onClick={() => setIsExpanded(!isExpanded)}
									>
										<ChevronDown
											size={16}
											className={`transition-transform duration-300 ${
												isExpanded ? "rotate-180" : ""
											}`}
										/>
									</Button>
								</div>
							)}
						</div>
					</div>
					<div className="relative">
						{taskType === 1 && (
							<div className="mt-sm flex flex-col px-sm animate-in fade-in-0 slide-in-from-bottom-4 duration-500 ease-out">
								{taskInfo.map((task, taskIndex) => (
									<div
										key={`task-${taskIndex}`}
										className="animate-in fade-in-0 slide-in-from-left-2 duration-300"
									>
										<TaskItem
											taskInfo={task}
											taskIndex={taskIndex}
											onUpdate={(content) => onUpdateTask(taskIndex, content)}
											onDelete={() => onDeleteTask(taskIndex)}
										/>
									</div>
								))}
							</div>
						)}
						{taskType === 2 && (
							<div
								ref={contentRef}
								className="overflow-hidden transition-all duration-300 ease-in-out"
								style={{
									height: isExpanded ? contentHeight : 0,
									opacity: isExpanded ? 1 : 0,
								}}
							>
								<div className="mt-sm flex flex-col px-2 gap-2">
									{taskRunning.map((task: TaskInfo) => {
										return (
											<div
												onClick={() => {
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
												key={`taskList-${task.id}`}
												className={`rounded-lg flex gap-2 py-sm px-sm transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2 ${
													task.status === "completed"
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
												}
												`}
											>
												<div className="pt-0.5">
													{task.status === "running" && (
														<LoaderCircle
															size={16}
															className={`text-icon-success ${
																chatStore.tasks[
																	chatStore.activeTaskId as string
																].status === "running" && "animate-spin"
															} `}
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
													{task.status === "" && (
														<Circle size={16} className="text-icon-secondary" />
													)}
												</div>
												<div className="flex-1 flex flex-col items-start justify-center">
													<div
														className={` w-full ${
															task.status === "failed"
																? "text-text-cuation-default"
																: task.status === "blocked"
																? "text-text-body"
																: "text-text-primary"
														} text-sm font-medium leading-13   `}
													>
														{task.content}
													</div>
												</div>
											</div>
										);
									})}
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
