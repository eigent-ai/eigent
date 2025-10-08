import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { fetchPost, proxyFetchPut, fetchPut, fetchDelete, proxyFetchDelete } from "@/api/http";
import BottomBox, { type FileAttachment } from "./BottomBox";
import { TaskCard } from "./TaskCard";
import { MessageCard } from "./MessageCard";
import { TypeCardSkeleton } from "./TypeCardSkeleton";
import { FloatingAction } from "./FloatingAction";
import { FileText, TriangleAlert } from "lucide-react";
import { generateUniqueId } from "@/lib";
import { proxyFetchGet } from "@/api/http";
import { useNavigate, useSearchParams } from "react-router-dom";
import { NoticeCard } from "./NoticeCard";
import { useAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import { TaskStateType } from "../TaskState";
import { toast } from "sonner";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export default function ChatBox(): JSX.Element {
	const [message, setMessage] = useState<string>("");

	//Get Chatstore for the active project's task
	const { chatStore, projectStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	
	const { t } = useTranslation();
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const [privacy, setPrivacy] = useState<any>(false);
	const [hasSearchKey, setHasSearchKey] = useState<any>(false);
	const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	// const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
	const { modelType } = useAuthStore();
	const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
	useEffect(() => {
		// Only show warning message, don't block functionality
		if (
			import.meta.env.VITE_USE_LOCAL_PROXY === "true" &&
			modelType === "cloud"
		) {
			setUseCloudModelInDev(true);
		} else {
			setUseCloudModelInDev(false);
		}
	}, [modelType]);
	useEffect(() => {
		proxyFetchGet("/api/user/privacy")
			.then((res) => {
				let _privacy = 0;
				Object.keys(res).forEach((key) => {
					if (!res[key]) {
						_privacy++;
						return;
					}
				});
				setPrivacy(_privacy === 0 ? true : false);
			})
			.catch((err) => console.error("Failed to fetch settings:", err));

		proxyFetchGet("/api/configs")
			.then((configsRes) => {
				const configs = Array.isArray(configsRes) ? configsRes : [];
				const _hasApiKey = configs.find(
					(item) => item.config_name === "GOOGLE_API_KEY"
				);
				const _hasApiId = configs.find(
					(item) => item.config_name === "SEARCH_ENGINE_ID"
				);
				if (_hasApiKey && _hasApiId) setHasSearchKey(true);
			})
			.catch((err) => console.error("Failed to fetch configs:", err));
	}, []);

	// Refresh privacy status when dialog closes
	// useEffect(() => {
	// 	if (!privacyDialogOpen) {
	// 		proxyFetchGet("/api/user/privacy")
	// 			.then((res) => {
	// 				let _privacy = 0;
	// 				Object.keys(res).forEach((key) => {
	// 					if (!res[key]) {
	// 						_privacy++;
	// 						return;
	// 					}
	// 				});
	// 				setPrivacy(_privacy === 0 ? true : false);
	// 			})
	// 			.catch((err) => console.error("Failed to fetch settings:", err));
	// 	}
	// }, [privacyDialogOpen]);
	const [searchParams] = useSearchParams();
	const share_token = searchParams.get("share_token");

	const navigate = useNavigate();

	const handleSend = async (messageStr?: string, taskId?: string) => {
		const _taskId = taskId || chatStore.activeTaskId;
		if (message.trim() === "" && !messageStr) return;
		const tempMessageContent = messageStr || message;
		chatStore.setHasMessages(_taskId as string, true);
		if (!_taskId) return;

		// Multi-turn support: Check if task is running or planning (splitting)
		const task = chatStore.tasks[_taskId];
		const isTaskBusy = task.status === 'running' || 
						  task.messages.some(m => m.step === 'to_sub_tasks' && !m.isConfirm);
		
		if (isTaskBusy && !task.activeAsk) {
			// Queue the message instead of sending immediately
			const currentAttaches = JSON.parse(JSON.stringify(task.attaches)) || [];
			projectStore.addQueuedMessage(projectStore.activeProjectId as string, tempMessageContent, currentAttaches);
			chatStore.setAttaches(_taskId, []); // Clear attaches after queuing
			setMessage("");
			if (textareaRef.current) textareaRef.current.style.height = "60px";
			toast.success("Message queued. It will be processed when the current task finishes.", {
				closeButton: true,
			});
			return;
		}
		
		chatStore.addMessages(_taskId, {
			id: generateUniqueId(),
			role: "user",
			content: tempMessageContent,
			attaches:
				JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) || [],
		});
		setMessage("");

		setTimeout(() => {
			scrollToBottom();
		}, 200);
		if (textareaRef.current) textareaRef.current.style.height = "60px";
		try {
			if (chatStore.tasks[_taskId].activeAsk) {
				chatStore.setIsPending(_taskId, true);

				await fetchPost(`/chat/${_taskId}/human-reply`, {
					agent: chatStore.tasks[_taskId].activeAsk,
					reply: tempMessageContent,
				});
				if (chatStore.tasks[_taskId].askList.length === 0) {
					chatStore.setActiveAsk(_taskId, "");
				} else {
					let activeAskList = chatStore.tasks[_taskId].askList;
					console.log(
						"activeAskList",
						JSON.parse(JSON.stringify(activeAskList))
					);
					let message = activeAskList.shift();
					chatStore.setActiveAskList(_taskId, [...activeAskList]);
					chatStore.setActiveAsk(_taskId, message?.agent_name || "");
					chatStore.setIsPending(_taskId, false);
					chatStore.addMessages(_taskId, message!);
				}
			} else {
				if (chatStore.tasks[_taskId as string]?.hasWaitComfirm) {
					// If the task has not started yet (pending status), start it normally
					if (chatStore.tasks[_taskId as string].status === "pending") {
						chatStore.setIsPending(_taskId, true);
						chatStore.startTask(_taskId);
						// keep hasWaitComfirm as true so that follow-up improves work as usual
					} else {
						// Task already started and is waiting for user confirmation – use improve API
						fetchPost(`/chat/${_taskId}`, {
							question: tempMessageContent,
						});
						chatStore.setIsPending(_taskId, true);
					}
				} else {
					if (!privacy) {
						const API_FIELDS = [
							"take_screenshot",
							"access_local_software",
							"access_your_address",
							"password_storage",
						];
						const requestData = {
							[API_FIELDS[0]]: true,
							[API_FIELDS[1]]: true,
							[API_FIELDS[2]]: true,
							[API_FIELDS[3]]: true,
						};
						proxyFetchPut("/api/user/privacy", requestData);
						setPrivacy(true);
					}
					chatStore.setIsPending(_taskId, true);
					chatStore.startTask(_taskId);
					chatStore.setHasWaitComfirm(_taskId as string, true);
				}
			}
		} catch (error) {
			console.error("error:", error);
		}
	};

	useEffect(() => {
		if (share_token) {
			handleSendShare(share_token);
		}
	}, [share_token]);

	const handleSendShare = async (token: string) => {
		if (!token) return;
		let _token: string = token.split("__")[0];
		let taskId: string = token.split("__")[1];
		chatStore.create(taskId, "share");
		chatStore.setHasMessages(taskId, true);
		const res = await proxyFetchGet(`/api/chat/share/info/${_token}`);
		if (res?.question) {
			chatStore.addMessages(taskId, {
				id: generateUniqueId(),
				role: "user",
				content: res.question.split("|")[0],
			});
			chatStore.startTask(taskId, "share", _token, 0.1);
			chatStore.setActiveTaskId(taskId);
			chatStore.handleConfirmTask(taskId, "share");
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && e.ctrlKey && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const scrollToBottom = useCallback(() => {
		if (scrollContainerRef.current) {
			setTimeout(() => {
				scrollContainerRef.current!.scrollTo({
					top: scrollContainerRef.current!.scrollHeight + 20,
					behavior: "smooth",
				});
			}, 200);
		}
	}, [scrollContainerRef.current?.scrollHeight]);

	// Handle scrollbar visibility on scroll
	useEffect(() => {
		const scrollContainer = scrollContainerRef.current;
		if (!scrollContainer) return;

		const handleScroll = () => {
			// Add scrolling class
			scrollContainer.classList.add('scrolling');

			// Clear existing timeout
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}

			// Remove scrolling class after 1 second of no scrolling
			scrollTimeoutRef.current = setTimeout(() => {
				scrollContainer.classList.remove('scrolling');
			}, 1000);
		};

		scrollContainer.addEventListener('scroll', handleScroll);

		return () => {
			scrollContainer.removeEventListener('scroll', handleScroll);
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
		};
	}, []);

	const [loading, setLoading] = useState(false);
	const handleConfirmTask = async (taskId?: string) => {
		const _taskId = taskId || chatStore.activeTaskId;
		if (!_taskId) return;
		setLoading(true);
		await chatStore.handleConfirmTask(_taskId);
		setLoading(false);
	};

	// File selection handler
	const handleFileSelect = async () => {
		try {
			const result = await window.electronAPI.selectFile({
				title: t("chat.select-file"),
				filters: [{ name: t("chat.all-files"), extensions: ["*"] }],
			});

			if (result.success && result.files && result.files.length > 0) {
				const taskId = chatStore.activeTaskId as string;
				const files = [
					...chatStore.tasks[taskId].attaches.filter(
						(f) => !result.files.find((r: File) => r.filePath === f.filePath)
					),
					...result.files,
				];
				chatStore.setAttaches(taskId, files);
			}
		} catch (error) {
			console.error("Select File Error:", error);
		}
	};

	// Replay handler
	const [isReplayLoading, setIsReplayLoading] = useState(false);
	const handleReplay = async () => {
		const taskId = chatStore.activeTaskId as string;
		setIsReplayLoading(true);
		const question =
			chatStore.tasks[taskId].messages[0].content;
		await chatStore.replay(taskId, question, 0.1);
		setIsReplayLoading(false);
	};

	// Pause/Resume handler
	const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
	const handlePauseResume = () => {
		const taskId = chatStore.activeTaskId as string;
		const task = chatStore.tasks[taskId];
		const type = task.status === 'running' ? 'pause' : 'resume';
		
		setIsPauseResumeLoading(true);
		if (type === 'pause') {
			let { taskTime, elapsed } = task;
			const now = Date.now();
			elapsed += now - taskTime;
			chatStore.setElapsed(taskId, elapsed);
			chatStore.setTaskTime(taskId, 0);
			chatStore.setStatus(taskId, 'pause');
		} else {
			chatStore.setTaskTime(taskId, Date.now());
			chatStore.setStatus(taskId, 'running');
		}
		
		fetchPut(`/task/${taskId}/take-control`, {
			action: type,
		});
		setIsPauseResumeLoading(false);
	};

	// Skip to next task handler
	const handleSkip = async () => {
		const taskId = chatStore.activeTaskId as string;
		setIsPauseResumeLoading(true);
		
		try {
			// Stop the current task
			await fetchPut(`/task/${taskId}/take-control`, {
				action: 'stop',
			});
			
			// Update task status to finished
			chatStore.setStatus(taskId, 'finished');
			chatStore.setIsPending(taskId, false);
			
			toast.success("Task skipped successfully", {
				closeButton: true,
			});
		} catch (error) {
			console.error("Failed to skip task:", error);
			toast.error("Failed to skip task", {
				closeButton: true,
			});
		} finally {
			setIsPauseResumeLoading(false);
		}
	};

	// Edit query handler
	const handleEditQuery = () => {
		const taskId = chatStore.activeTaskId as string;
		fetchDelete(`/chat/${taskId}`);
		const messageIndex = chatStore.tasks[taskId].messages.findIndex(
			(item) => item.step === "to_sub_tasks"
		);
		const question = chatStore.tasks[taskId].messages[messageIndex - 2].content;
		let id = chatStore.create();
		chatStore.setHasMessages(id, true);
		chatStore.removeTask(taskId);
		proxyFetchDelete(`/api/chat/history/${taskId}`);
		setMessage(question);
	};

	// Task time tracking
	const [taskTime, setTaskTime] = useState(
		chatStore.getFormattedTaskTime(chatStore.activeTaskId as string)
	);
	useEffect(() => {
		const interval = setInterval(() => {
			if (chatStore.activeTaskId) {
				setTaskTime(
					chatStore.getFormattedTaskTime(chatStore.activeTaskId)
				);
			}
		}, 500);
		return () => clearInterval(interval);
	}, [chatStore.activeTaskId]);

	// Determine BottomBox state
	const getBottomBoxState = () => {
		if (!chatStore.activeTaskId) return "input";
		const task = chatStore.tasks[chatStore.activeTaskId];
		const activeProject = projectStore.getProjectById(projectStore.activeProjectId || '');

		// Check for queued messages at project level
		if (activeProject?.queuedMessages && activeProject.queuedMessages.length > 0) {
			return "queuing";
		}

		// Determine if we're in the "splitting in progress" phase (skeleton visible)
		// Equivalent to the skeleton condition used in the JSX below
		const toSubTasksMessage = task.messages.find((m) => m.step === "to_sub_tasks");
		const isSkeletonPhase = ((!toSubTasksMessage && !task.hasWaitComfirm && task.messages.length > 0) || task.isTakeControl);
		if (isSkeletonPhase) {
			return "splitting";
		}

		// After splitting completes and TaskCard is awaiting user confirmation,
		// the Task becomes 'pending' and we show the confirm state.
		if (toSubTasksMessage && !toSubTasksMessage.isConfirm && task.status === 'pending') {
			return "confirm";
		}

		// If subtasks exist but not yet confirmed while task is still running, keep showing splitting
		if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
			return "splitting";
		}

		// Check task status
		if (task.status === 'running' || task.status === 'pause') {
			return "running";
		}

		if (task.status === 'finished' && task.type !== '') {
			return "finished";
		}

		return "input";
	};

	const [hasSubTask, setHasSubTask] = useState(false);

	useEffect(() => {
		const _hasSubTask = chatStore.tasks[
			chatStore.activeTaskId as string
		]?.messages?.find((message) => message.step === "to_sub_tasks")
			? true
			: false;
		setHasSubTask(_hasSubTask);
	}, [chatStore?.tasks[chatStore.activeTaskId as string]?.messages]);

	useEffect(() => {
		const activeAsk =
			chatStore?.tasks[chatStore.activeTaskId as string]?.activeAsk;
		let timer: NodeJS.Timeout;
		if (activeAsk && activeAsk !== "") {
			const _taskId = chatStore.activeTaskId as string;
			timer = setTimeout(() => {
				handleSend("skip", _taskId);
			}, 30000); // 30 seconds
			return () => clearTimeout(timer); // clear previous timer
		}
		// if activeAsk is empty, also clear timer
		return () => {
			clearTimeout(timer);
		};
	}, [
		chatStore?.tasks[chatStore.activeTaskId as string]?.activeAsk,
		message, // depend on message
	]);

	return (
		<div className="w-full h-full flex flex-col items-center justify-center">
			{/* <PrivacyDialog
				open={privacyDialogOpen}
				onOpenChange={setPrivacyDialogOpen}
			/> */}
			{(chatStore.activeTaskId &&
				chatStore.tasks[chatStore.activeTaskId].messages.length > 0) ||
			chatStore.tasks[chatStore.activeTaskId as string]?.hasMessages ? (
				<div className="w-full h-[calc(100vh-54px)] flex flex-col rounded-xl border border-border-disabled  border-solid relative shadow-blur-effect overflow-hidden">
					<div className="absolute inset-0 blur-bg bg-bg-surface-secondary pointer-events-none"></div>
					<div
						ref={scrollContainerRef}
						className="flex-1 relative z-10 flex flex-col overflow-y-auto scrollbar pl-2 gap-2 pt-2"
					>
						{chatStore.activeTaskId &&
							chatStore.tasks[chatStore.activeTaskId].messages.map(
								(item, index) => {
									if (item.content.length > 0) {
										// Use specialized component for agent summaries
										if (item.step === "end") {
											return (
												<div
													key={"end-" + item.id}
													className="flex flex-col gap-4"
												>
													<MessageCard
														typewriter={
															chatStore.tasks[chatStore.activeTaskId as string]
																.type !== "replay" ||
															(chatStore.tasks[chatStore.activeTaskId as string]
																.type === "replay" &&
																chatStore.tasks[
																	chatStore.activeTaskId as string
																].delayTime !== 0)
														}
														id={item.id}
														key={item.id}
														role={item.role}
														content={item.content}
														onTyping={scrollToBottom}
													/>
													<div className="flex gap-2 flex-wrap">
														{item.fileList?.map((file) => {
															return (
																<div
																	key={"file-" + file.name}
																	onClick={() => {
																		// set selected file
																		chatStore.setSelectedFile(
																			chatStore.activeTaskId as string,
																			file
																		);
																		// open DocumentWorkSpace
																		chatStore.setActiveWorkSpace(
																			chatStore.activeTaskId as string,
																			"documentWorkSpace"
																		);
																	}}
																	className="flex items-center gap-2 bg-message-fill-default rounded-sm  px-2 py-1 w-[140px] "
																>
																	<FileText
																		size={24}
																		className="flex-shrink-0"
																	/>
																	<div className="flex flex-col">
																		<div className="max-w-[100px] font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
																			{file.name.split(".")[0]}
																		</div>
																		<div className="font-medium leading-29 text-xs text-text-body">
																			{file.type}
																		</div>
																	</div>
																</div>
															);
														})}
													</div>
												</div>
											);
										} else if (item.content === "skip") {
											return (
												<MessageCard
													id={item.id}
													key={item.id}
													role={item.role}
													content={t("chat.no-reply-received-task-continue")}
													onTyping={scrollToBottom}
												/>
											);
										} else {
											return (
												<MessageCard
													typewriter={
														chatStore.tasks[chatStore.activeTaskId as string]
															.type !== "replay" ||
														(chatStore.tasks[chatStore.activeTaskId as string]
															.type === "replay" &&
															chatStore.tasks[chatStore.activeTaskId as string]
																.delayTime !== 0)
													}
													id={item.id}
													key={item.id}
													role={item.role}
													content={item.content}
													onTyping={scrollToBottom}
													attaches={item.attaches}
												/>
											);
										}
									} else if (item.step === "end" && item.content === "") {
										return (
											<div
												key={"end-" + item.id}
												className="flex flex-col gap-4"
											>
												{/* <MessageCard
													id={item.id}
													content={
														"Task complete! If you have any further questions or need additional information, feel free to ask again."
													}
													className="!px-0 !py-1"
													role={item.role}
													onTyping={scrollToBottom}
												/> */}
												<div className="flex gap-2 flex-wrap">
													{item.fileList?.map((file) => {
														return (
															<div
																key={"file-" + file.name}
																onClick={() => {
																	// set selected file
																	chatStore.setSelectedFile(
																		chatStore.activeTaskId as string,
																		file
																	);
																	chatStore.setActiveWorkSpace(
																		chatStore.activeTaskId as string,
																		"documentWorkSpace"
																	);
																}}
																className="flex items-center gap-2 bg-message-fill-default rounded-sm  px-2 py-1 w-[140px] "
															>
																<FileText size={24} className="flex-shrink-0" />
																<div className="flex flex-col">
																	<div className="max-w-[100px] font-bold text-sm text-body text-text-body overflow-hidden text-ellipsis whitespace-nowrap">
																		{file.name.split(".")[0]}
																	</div>
																	<div className="font-medium leading-29 text-xs text-text-body">
																		{file.type}
																	</div>
																</div>
															</div>
														);
													})}
												</div>
											</div>
										);
									}
									if (
										item.step === "notice_card" &&
										!chatStore.tasks[chatStore.activeTaskId as string]
											.isTakeControl &&
										chatStore.tasks[chatStore.activeTaskId as string].cotList
											.length > 0
									) {
										return <NoticeCard key={"notice-" + item.id} />;
									}
									if (
										item.step === "to_sub_tasks" &&
										!chatStore.tasks[chatStore.activeTaskId as string]
											.isTakeControl
									) {
										if (!chatStore.activeTaskId) return <> </>;
										return (
											<TaskCard
												key={"task-" + item.id}
												taskInfo={
													chatStore.tasks[chatStore.activeTaskId].taskInfo || []
												}
												taskType={item.taskType || 1}
												taskAssigning={
													chatStore.tasks[chatStore.activeTaskId]
														.taskAssigning || []
												}
												taskRunning={
													chatStore.tasks[chatStore.activeTaskId].taskRunning ||
													[]
												}
												progressValue={
													chatStore.tasks[chatStore.activeTaskId].progressValue
												}
												summaryTask={
													chatStore.tasks[chatStore.activeTaskId].summaryTask ||
													""
												}
												onAddTask={() => {
													chatStore.setIsTaskEdit(
														chatStore.activeTaskId as string,
														true
													);
													chatStore.addTaskInfo();
												}}
												onUpdateTask={(taskIndex, content) => {
													chatStore.setIsTaskEdit(
														chatStore.activeTaskId as string,
														true
													);
													chatStore.updateTaskInfo(taskIndex, content);
												}}
												onDeleteTask={(taskIndex) => {
													chatStore.setIsTaskEdit(
														chatStore.activeTaskId as string,
														true
													);
													chatStore.deleteTaskInfo(taskIndex);
												}}
												clickable={true}
											/>
										);
									}
								}
							)}
						{/* Skeleton  */}
						{((!hasSubTask &&
							!chatStore.tasks[chatStore.activeTaskId as string]
								?.hasWaitComfirm &&
							chatStore.tasks[chatStore.activeTaskId as string]?.messages
								.length > 0) ||
							chatStore.tasks[chatStore.activeTaskId as string]
								.isTakeControl) && (
							<TypeCardSkeleton
								isTakeControl={
									chatStore.tasks[chatStore.activeTaskId as string]
										.isTakeControl
								}
							/>
						)}
						
						{/* Floating Action Button for Pause/Resume/Skip */}
						{chatStore.activeTaskId && (
							<FloatingAction
								status={chatStore.tasks[chatStore.activeTaskId]?.status}
								onPause={handlePauseResume}
								onResume={handlePauseResume}
								onSkip={handleSkip}
								loading={isPauseResumeLoading}
							/>
						)}
					</div>
					{chatStore.activeTaskId && (
					<BottomBox
						state={getBottomBoxState()}
							queuedMessages={projectStore.getProjectById(projectStore.activeProjectId || '')?.queuedMessages?.map(m => ({
								id: m.id,
								content: m.content,
								timestamp: m.timestamp
							})) || []}
							onRemoveQueuedMessage={(id) => projectStore.removeQueuedMessage(projectStore.activeProjectId as string, id)}
							subTasks={chatStore.tasks[chatStore.activeTaskId]?.taskInfo?.map(t => ({
								id: t.id || generateUniqueId(),
								content: t.content,
								status: 'pending' as const
							})) || []}
						subtitle={getBottomBoxState() === 'confirm' 
							? chatStore.tasks[chatStore.activeTaskId]?.messages?.[0]?.content 
							: chatStore.tasks[chatStore.activeTaskId]?.summaryTask}
							onStartTask={() => handleConfirmTask()}
							onEdit={handleEditQuery}
							tokens={chatStore.tasks[chatStore.activeTaskId]?.tokens || 0}
							taskTime={taskTime}
							taskStatus={chatStore.tasks[chatStore.activeTaskId]?.status}
							onReplay={handleReplay}
							replayDisabled={chatStore.tasks[chatStore.activeTaskId]?.status !== 'finished'}
							replayLoading={isReplayLoading}
							onPauseResume={handlePauseResume}
							pauseResumeLoading={isPauseResumeLoading}
							loading={loading}
							inputProps={{
								value: message,
								onChange: setMessage,
								onSend: handleSend,
								files: chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(f => ({
									fileName: f.fileName,
									filePath: f.filePath
								})) || [],
								onFilesChange: (files) => chatStore.setAttaches(chatStore.activeTaskId as string, files as any),
								onAddFile: handleFileSelect,
								placeholder: t("chat.ask-placeholder"),
								disabled: !privacy || useCloudModelInDev,
								textareaRef: textareaRef,
								allowDragDrop: true,
								privacy: privacy,
								useCloudModelInDev: useCloudModelInDev
							}}
						/>
					)}
				</div>
			) : (
				<div className="w-full h-[calc(100vh-54px)] flex items-center rounded-xl border border-border-disabled py-2 border-solid  relative overflow-hidden">
					<div className="absolute inset-0 blur-bg bg-bg-surface-secondary pointer-events-none"></div>
					<div className=" w-full flex flex-col relative z-10">
						<div className="flex flex-col items-center gap-1 h-[210px] justify-end">
							<div className="text-xl leading-[30px] text-zinc-800 text-center font-bold">
								{t("chat.welcome-to-eigent")}
							</div>
							<div className="text-lg leading-7 text-zinc-500 text-center mb-5">
								{t("chat.how-can-i-help-you")}
							</div>
						</div>

						{chatStore.activeTaskId && (
							<BottomBox
								state="input"
								inputProps={{
									value: message,
									onChange: setMessage,
									onSend: handleSend,
									files: chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(f => ({
										fileName: f.fileName,
										filePath: f.filePath
									})) || [],
									onFilesChange: (files) => chatStore.setAttaches(chatStore.activeTaskId as string, files as any),
									onAddFile: handleFileSelect,
									placeholder: t("chat.ask-placeholder"),
									disabled: useCloudModelInDev,
									textareaRef: textareaRef,
									allowDragDrop: false,
									privacy: true,
									useCloudModelInDev: useCloudModelInDev
								}}
							/>
						)}
						<div className="h-[210px] flex justify-center items-start gap-2 mt-3 pr-2">
							{!privacy ? (
								<div className="flex items-center gap-2">
									<div
										onClick={(e) => {
											// Check if the click target is an anchor tag
											const target = e.target as HTMLElement;
											if (target.tagName === "A") {
												// Let the anchor tag handle the click naturally
												return;
											}

											// Enable privacy permissions
											const API_FIELDS = [
												"take_screenshot",
												"access_local_software",
												"access_your_address",
												"password_storage",
											];
											const requestData = {
												[API_FIELDS[0]]: true,
												[API_FIELDS[1]]: true,
												[API_FIELDS[2]]: true,
												[API_FIELDS[3]]: true,
											};
											proxyFetchPut("/api/user/privacy", requestData);
											setPrivacy(true);
										}}
										className=" cursor-pointer flex items-center gap-1 px-sm py-xs rounded-md bg-surface-information"
									>
										<TriangleAlert
											size={20}
											className="text-icon-information"
										/>
										<span className=" flex-1 text-text-information text-xs font-medium leading-[20px]">
											{t("chat.by-messaging-eigent")}{" "}
											<a
												href="https://www.eigent.ai/terms-of-use"
												target="_blank"
												className="text-text-information underline"
												onClick={(e) => e.stopPropagation()}
											>
												{t("chat.terms-of-use")}
											</a>{" "}
											{t("chat.and")}{" "}
											<a
												href="https://www.eigent.ai/privacy-policy"
												target="_blank"
												className="text-text-information underline"
												onClick={(e) => e.stopPropagation()}
											>
												{t("chat.privacy-policy")}
											</a>
											.
										</span>
									</div>
								</div>
							) : null}
							{privacy && (
									<div className="mr-2 flex flex-col items-center gap-2">
										{[
											{
												label: t("chat.palm-springs-tennis-trip-planner"),
												message: t(
													"chat.palm-springs-tennis-trip-planner-message"
												),
											},
											{
												label: t(
													"chat.bank-transfer-csv-analysis-and-visualization"
												),
												message: t(
													"chat.bank-transfer-csv-analysis-and-visualization-message"
												),
											},
											{
												label: t(
													"chat.find-duplicate-files-in-downloads-folder"
												),
												message: t(
													"chat.find-duplicate-files-in-downloads-folder-message"
												),
											},
										].map(({ label, message }) => (
											<div
												key={label}
												className="cursor-pointer px-sm py-xs rounded-md bg-input-bg-default opacity-70 hover:opacity-100 text-xs font-medium leading-none text-button-tertiery-text-default transition-all duration-300"
												onClick={() => {
													setMessage(message);
												}}
											>
												<span>{label}</span>
											</div>
										))}
									</div>
								)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
