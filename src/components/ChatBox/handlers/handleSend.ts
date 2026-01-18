import { fetchPost, proxyFetchPut } from "@/api/http";
import { generateUniqueId } from "@/lib";
import { toast } from "sonner";
import type { ChatStore } from "@/store/chatStore";
import type { ProjectStore } from "@/store/projectStore";

interface HandleSendParams {
	messageStr?: string;
	taskId?: string;
	currentMessage: string;
	chatStore: ChatStore;
	projectStore: { activeProjectId: string | null } & Pick<ProjectStore, 'getProjectById'>;
	textareaRef: React.RefObject<HTMLTextAreaElement>;
	scrollToBottom: () => void;
	setMessage: (message: string) => void;
	privacy: boolean;
	setPrivacy: (privacy: boolean) => void;
}

export async function handleSend({
	messageStr,
	taskId,
	currentMessage,
	chatStore,
	projectStore,
	textareaRef,
	scrollToBottom,
	setMessage,
	privacy,
	setPrivacy,
}: HandleSendParams): Promise<void> {
	const _taskId = taskId || chatStore.activeTaskId;
	if (currentMessage.trim() === "" && !messageStr) return;
	const tempMessageContent = messageStr || currentMessage;
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
}
