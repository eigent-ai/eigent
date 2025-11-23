import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { fetchPost, proxyFetchPut, fetchPut, fetchDelete, proxyFetchDelete } from "@/api/http";
import BottomBox from "./BottomBox";
import { ProjectChatContainer } from "./ProjectChatContainer";
import { TriangleAlert } from "lucide-react";
import { generateUniqueId } from "@/lib";
import { proxyFetchGet } from "@/api/http";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { replayActiveTask } from "@/lib";

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

		// Multi-turn support: Check if task is running or planning (splitting/confirm)
		const task = chatStore.tasks[_taskId];
		const requiresHumanReply = Boolean(task?.activeAsk);
		const isTaskInProgress = ["running", "pause"].includes(task?.status || "");
		const isTaskBusy = (
			// running or paused counts as busy
			(task.status === 'running' && task.hasMessages) || task.status === 'pause' ||
			// splitting phase: has to_sub_tasks not confirmed OR skeleton computing
			task.messages.some(m => m.step === 'to_sub_tasks' && !m.isConfirm) ||
			((!task.messages.find(m => m.step === 'to_sub_tasks') && !task.hasWaitComfirm && task.messages.length > 0) || task.isTakeControl) ||
			// explicit confirm wait while task is pending but card not confirmed yet
			(!!task.messages.find(m => m.step === 'to_sub_tasks' && !m.isConfirm) && task.status === 'pending')
		);
		const isReplayChatStore = task?.type === "replay";
		if (!requiresHumanReply && isTaskBusy && !isReplayChatStore) {
			toast.error("Current task is in progress. Please wait for it to finish before sending a new request.", {
				closeButton: true,
			});
			return;
		}
		
		if (textareaRef.current) textareaRef.current.style.height = "60px";
		try {
			if (requiresHumanReply) {
				chatStore.addMessages(_taskId, {
					id: generateUniqueId(),
					role: "user",
					content: tempMessageContent,
					attaches:
						JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) || [],
				});
				setMessage("");
		
				// Scroll to bottom after adding user message
				setTimeout(() => {
					scrollToBottom();
				}, 200);

				chatStore.setIsPending(_taskId, true);

				await fetchPost(`/chat/${projectStore.activeProjectId}/human-reply`, {
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
				// Check if we should continue the conversation or start a new task
				const hasMessages = chatStore.tasks[_taskId as string].messages.length > 0;
				const isFinished = chatStore.tasks[_taskId as string].status === "finished";
				const hasWaitComfirm = chatStore.tasks[_taskId as string]?.hasWaitComfirm;

				// Check if this task was manually stopped (finished but without natural completion)
				const wasTaskStopped = isFinished && !chatStore.tasks[_taskId as string].messages.some(
					m => m.step === "end"  // Natural completion has an "end" step message
				);

				// Continue conversation if:
				// 1. Has wait confirm (simple query response) - but not if task was stopped
				// 2. Task is naturally finished (complex task completed) - but not if task was stopped
				// 3. Has any messages but pending (ongoing conversation)
				const shouldContinueConversation = (hasWaitComfirm && !wasTaskStopped) || (isFinished && !wasTaskStopped) || (hasMessages && chatStore.tasks[_taskId as string].status === "pending");

				if (shouldContinueConversation) {
					// Check if this is the very first message and task hasn't started
					const hasSimpleResponse = chatStore.tasks[_taskId as string].messages.some(
						m => m.step === "wait_confirm"
					);
					const hasComplexTask = chatStore.tasks[_taskId as string].messages.some(
						m => m.step === "to_sub_tasks"
					);
					const hasErrorMessage = chatStore.tasks[_taskId as string].messages.some(
						m => m.role === "agent" && m.content.startsWith("❌ **Error**:")
					);

					// Only start a new task if: pending, no messages processed yet
					// OR while or after replaying a project
					if ((chatStore.tasks[_taskId as string].status === "pending" && !hasSimpleResponse && !hasComplexTask && !isFinished)
						|| chatStore.tasks[_taskId].type === "replay" || hasErrorMessage) {
						setMessage("");
						// Pass the message content to startTask instead of adding it to current chatStore
						const attachesToSend = JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) || [];
						try {
							await chatStore.startTask(_taskId, undefined, undefined, undefined, tempMessageContent, attachesToSend);
						} catch (err: any) {
							console.error("Failed to start task:", err);
							toast.error(err?.message || "Failed to start task. Please check your model configuration.");
							return;
						}
						// keep hasWaitComfirm as true so that follow-up improves work as usual
					} else {
						// Continue conversation: simple response, complex task, or finished task
						console.log("[Multi-turn] Continuing conversation with improve API");

						//Generate nextId in case new chatStore is created to sync with the backend beforehand
						const nextTaskId = generateUniqueId()
						chatStore.setNextTaskId(nextTaskId);

						// Use improve endpoint (POST /chat/{id}) - {id} is project_id
						// This reuses the existing SSE connection and step_solve loop
						fetchPost(`/chat/${projectStore.activeProjectId}`, {
							question: tempMessageContent,
							task_id: nextTaskId
						});
						chatStore.setIsPending(_taskId, true);
						// Add the user message to show it in UI
						chatStore.addMessages(_taskId, {
							id: generateUniqueId(),
							role: "user",
							content: tempMessageContent,
							attaches: JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) || [],
						});
						chatStore.setAttaches(_taskId, []);
						setMessage("");
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
					
					setTimeout(() => {
						scrollToBottom();
					}, 200);
					
					// For the very first message, add it to the current chatStore first, then call startTask
					const attachesToSend = JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) || [];
					setMessage("");
					try {
						await chatStore.startTask(_taskId, undefined, undefined, undefined, tempMessageContent, attachesToSend);
						chatStore.setHasWaitComfirm(_taskId as string, true);
					} catch (err: any) {
						console.error("Failed to start task:", err);
						toast.error(err?.message || "Failed to start task. Please check your model configuration.");
						return;
					}
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

	useEffect(() => {
		console.log("ChatStore Data: ", chatStore);
	}, []);

	const handleSendShare = async (token: string) => {
		if (!token) return;
		if (!projectStore.activeProjectId) {
			console.warn("Can't send share due to no active projectId");
			return;
		}
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
			try {
				await chatStore.startTask(taskId, "share", _token, 0.1);
				chatStore.setActiveTaskId(taskId);
				chatStore.handleConfirmTask(projectStore.activeProjectId, taskId, "share");
			} catch (err: any) {
				console.error("Failed to start shared task:", err);
				toast.error(err?.message || "Failed to start task. Please check your model configuration.");
			}
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
		if (!_taskId || !projectStore.activeProjectId) {
			return;
		}
		setLoading(true);
		await chatStore.handleConfirmTask(projectStore.activeProjectId, _taskId);
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
		setIsReplayLoading(true);
		await replayActiveTask(chatStore, projectStore, navigate);
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
		
		fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
			action: type,
		});
		setIsPauseResumeLoading(false);
	};

	// Stop task handler - triggers Action.skip_task which preserves context
	const handleSkip = async () => {
		const taskId = chatStore.activeTaskId as string;
		console.log("=" .repeat(80));
		console.log("🛑 [STOP-BUTTON] handleSkip CALLED from frontend");
		console.log(`[STOP-BUTTON] taskId: ${taskId}, projectId: ${projectStore.activeProjectId}`);
		console.log("=" .repeat(80));
		setIsPauseResumeLoading(true);

		try {
			// Call skip-task endpoint to trigger Action.skip_task
			// This will stop the task gracefully while preserving context for multi-turn
			console.log(`[STOP-BUTTON] Sending POST request to /chat/${projectStore.activeProjectId}/skip-task`);
			await fetchPost(`/chat/${projectStore.activeProjectId}/skip-task`, {
				project_id: projectStore.activeProjectId
			});
			console.log("[STOP-BUTTON] ✅ Backend skip-task request successful");

			// DO NOT call chatStore.stopTask here!
			// Keep SSE connection alive to receive "end" event from backend
			// The "end" event will set status to 'finished' and allow multi-turn conversation
			console.log("[STOP-BUTTON] ⚠️  SSE connection kept alive, waiting for backend 'end' event");

			// Only set isPending to false so UI shows task is stopped
			chatStore.setIsPending(taskId, false);
			console.log("[STOP-BUTTON] ✅ Task marked as not pending, SSE connection remains open");

			toast.success("Task stopped successfully", {
				closeButton: true,
			});
		} catch (error) {
			console.error("[STOP-BUTTON] ❌ Failed to stop task:", error);

			// If backend call failed, close SSE connection as fallback
			console.log("[STOP-BUTTON] Backend call failed, closing SSE connection as fallback");
			try {
				chatStore.stopTask(taskId);
				chatStore.setIsPending(taskId, false);
				console.log("[STOP-BUTTON] ⚠️  SSE connection closed due to backend failure");
				toast.warning("Task stopped locally, but backend notification failed. Backend task may continue running.", {
					closeButton: true,
					duration: 5000,
				});
			} catch (localError) {
				console.error("[STOP-BUTTON] ❌ Failed to stop task locally:", localError);
				toast.error("Failed to stop task completely. Please refresh the page.", {
					closeButton: true,
				});
			}
		} finally {
			console.log("[STOP-BUTTON] handleSkip completed");
			setIsPauseResumeLoading(false);
		}
	};

	// Edit query handler
	const handleEditQuery = async () => {
		const taskId = chatStore.activeTaskId as string;
		const projectId = projectStore.activeProjectId;

		// Early validation
		if (!projectId) {
			console.error("No active project ID found for edit operation");
			return;
		}

		// Get question and attachments before any deletions
		const messageIndex = chatStore.tasks[taskId].messages.findLastIndex(
			(item) => item.step === "to_sub_tasks"
		);
		const questionMessage = chatStore.tasks[taskId].messages[messageIndex - 2];
		const question = questionMessage.content;
		// Get the file attachments from the original user message (not from task.attaches which gets cleared after sending)
		const attachments = questionMessage.attaches || [];

		// Delete task from backend first
		try {
			await fetchDelete(`/chat/${projectId}`);
		} catch (error) {
			console.error("Failed to delete task from backend:", error);
			// Continue with local cleanup even if backend fails
		}

		// Delete chat history
		const history_id = projectStore.getHistoryId(projectId);
		if (history_id) {
			try {
				await proxyFetchDelete(`/api/chat/history/${history_id}`);
			} catch(error) {
				console.error(`Failed to delete chat history (ID: ${history_id}) for project ${projectId}:`, error);
			}
		} else {
			console.warn(`No history ID found for project ${projectId} during edit operation`);
		}

		// Create new task and clean up locally
		let id = chatStore.create();
		chatStore.setHasMessages(id, true);
		// Copy the file attachments to the new task
		if (attachments.length > 0) {
			chatStore.setAttaches(id, attachments);
		}
		chatStore.removeTask(taskId);
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

		// Queued messages no longer change BottomBox state; QueuedBox renders independently

		// Check for any to_sub_tasks message (confirmed or not)
		const anyToSubTasksMessage = task.messages.find((m) => m.step === "to_sub_tasks");
		const toSubTasksMessage = task.messages.find((m) => (m.step === "to_sub_tasks" && !m.isConfirm));
		
		// Determine if we're in the "splitting in progress" phase (skeleton visible)
		// Only show splitting if there's NO to_sub_tasks message yet (not even confirmed)
		const isSkeletonPhase = (
			task.status !== 'finished' &&
			!anyToSubTasksMessage && 
			!task.hasWaitComfirm && 
			task.messages.length > 0) || 
			(task.isTakeControl && !anyToSubTasksMessage);
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

	const handleRemoveTaskQueue = async (task_id: string) => {
		const project_id = projectStore.activeProjectId;
		if (!project_id) {
			console.error("No active project ID found");
			return;
		}
		
		// Store the original message before removal for potential restoration
		const project = projectStore.getProjectById(project_id);
		const originalMessage = project?.queuedMessages?.find(m => m.task_id === task_id);
		
		if (!originalMessage) {
			console.error(`Message with task_id ${task_id} not found`);
			return;
		}
		
		// Create a copy of the original message for restoration
		const messageBackup = {
			task_id: originalMessage.task_id,
			content: originalMessage.content,
			timestamp: originalMessage.timestamp,
			attaches: [...originalMessage.attaches]
		};
		
		try {
			//Optimistic Removal
			projectStore.removeQueuedMessage(project_id, task_id);

			// Always try to call the backend to remove the task
			// The backend will handle the error gracefully if workforce is not initialized
			// Note: Replay creates a new chatstore, so no conflicts
			const task = chatStore.tasks[chatStore.activeTaskId as string];
			// Only skip backend call if task is finished or hasn't started yet (no messages)
			if(task && task.messages.length > 0 && task.status !== 'finished') {
				try {
					await fetchDelete(`/chat/${project_id}/remove-task/${task_id}`, {
						project_id: project_id,
						task_id: task_id
					});
				} catch (apiError) {
					// If backend returns an error, it's okay - the task might not be in the workforce queue yet
					console.log(`Backend remove call failed (expected if workforce not started): ${apiError}`);
				}
			}
		} catch (error) {
			// Revert the optimistic removal by restoring the original message
			projectStore.restoreQueuedMessage(project_id, messageBackup);
			console.error(`Can't remove ${task_id} due to ${error}`)
		}
	}
	const getAllChatStoresMemoized = useMemo(() => {
		const project_id = projectStore.activeProjectId;
		if(!project_id) return [];

		return projectStore.getAllChatStores(project_id);
	}, [projectStore, projectStore.activeProjectId, chatStore])

	// Check if any chat store in the project has messages
	const hasAnyMessages = useMemo(() => {
		// First check current active chat store
		if (chatStore.activeTaskId && chatStore.tasks[chatStore.activeTaskId]) {
			const activeTask = chatStore.tasks[chatStore.activeTaskId];
			if ((activeTask.messages && activeTask.messages.length > 0) || activeTask.hasMessages) {
				return true;
			}
		}

		// Then check all other chat stores in the project
		return getAllChatStoresMemoized.some(({chatStore: store}) => {
			const state = store.getState();
			return state.activeTaskId && 
				   state.tasks[state.activeTaskId] && 
				   (state.tasks[state.activeTaskId].messages.length > 0 || 
					state.tasks[state.activeTaskId].hasMessages);
		});
	}, [chatStore, getAllChatStoresMemoized]);

	const isTaskBusy = useMemo(() => {
		if (!chatStore.activeTaskId || !chatStore.tasks[chatStore.activeTaskId]) return false;
		const task = chatStore.tasks[chatStore.activeTaskId];
		return (
			// running or paused
			task.status === 'running' || 
			task.status === 'pause' ||
			// splitting phase
			task.messages.some(m => m.step === 'to_sub_tasks' && !m.isConfirm) ||
			// skeleton/computing phase
			((!task.messages.find(m => m.step === 'to_sub_tasks') && !task.hasWaitComfirm && task.messages.length > 0) || task.isTakeControl)
		);
	}, [chatStore.activeTaskId, chatStore.tasks]);

	const isInputDisabled = useMemo(() => {
		if (!chatStore.activeTaskId || !chatStore.tasks[chatStore.activeTaskId]) return true;
		
		const task = chatStore.tasks[chatStore.activeTaskId];
		
		// If ask human is active, allow input
		if (task.activeAsk) return false;

		if (isTaskBusy) return true;

		// Standard checks
		if (!privacy) return true;
		if (useCloudModelInDev) return true;
		if (task.isContextExceeded) return true;

		return false;
	}, [
		chatStore.activeTaskId,
		chatStore.tasks,
		privacy,
		useCloudModelInDev,
		isTaskBusy
	]);

	return (
		<div className="w-full h-full flex-none items-center justify-center">
			{hasAnyMessages ? (
				<div className="w-full h-full flex-1 flex flex-col">
					{/* New Project Chat Container */}
					<ProjectChatContainer
						// onPauseResume={handlePauseResume}  // Commented out - temporary not needed
						onSkip={handleSkip}
						isPauseResumeLoading={isPauseResumeLoading}
					/>
					{chatStore.activeTaskId && (
						<BottomBox
						state={getBottomBoxState()}
						queuedMessages={isTaskBusy ? [] : projectStore.getProjectById(projectStore.activeProjectId || '')?.queuedMessages?.map(m => ({
							id: m.task_id,
							content: m.content,
							timestamp: m.timestamp
						})) || []}
						onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
						subtitle={getBottomBoxState() === 'confirm' 
							? (() => {
								// Find the last message where role is "user"
								const messages = chatStore.tasks[chatStore.activeTaskId]?.messages || [];
								const lastUserMessage = messages.slice().reverse().find(msg => msg.role === "user");
								return lastUserMessage?.content || chatStore.tasks[chatStore.activeTaskId]?.summaryTask;
							})()
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
								disabled: isInputDisabled,
								textareaRef: textareaRef,
								allowDragDrop: true,
								privacy: privacy,
								useCloudModelInDev: useCloudModelInDev
							}}
						/>
					)}
				</div>
			) : (
				// Init ChatBox
				<div className="w-full h-[calc(100vh-54px)] flex items-center py-2 relative overflow-hidden">
					<div className="absolute inset-0 pointer-events-none"></div>
					<div className=" w-full flex flex-col relative z-10">
						<div className="flex flex-col items-center gap-1 h-[210px] justify-end">
							<div className="text-body-lg text-text-heading text-center font-bold">
								{t("layout.welcome-to-eigent")}
							</div>
							<div className="text-body-lg leading-7 text-text-label text-center mb-5">
								{t("layout.how-can-i-help-you")}
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
									disabled: isInputDisabled,
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
											{t("layout.by-messaging-eigent")}{" "}
											<a
												href="https://www.eigent.ai/terms-of-use"
												target="_blank"
												className="text-text-information underline"
												onClick={(e) => e.stopPropagation()}
											>
												{t("layout.terms-of-use")}
											</a>{" "}
											{t("layout.and")}{" "}
											<a
												href="https://www.eigent.ai/privacy-policy"
												target="_blank"
												className="text-text-information underline"
												onClick={(e) => e.stopPropagation()}
											>
												{t("layout.privacy-policy")}
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
												label: t("layout.palm-springs-tennis-trip-planner"),
												message: t(
													"layout.palm-springs-tennis-trip-planner-message"
												),
											},
											{
												label: t(
													"layout.bank-transfer-csv-analysis"
												),
												message: t(
													"layout.bank-transfer-csv-analysis-message"
												),
											},
											{
												label: t(
													"layout.find-duplicate-files"
												),
												message: t(
													"layout.find-duplicate-files-message"
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