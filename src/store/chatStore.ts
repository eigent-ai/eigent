import { fetchPost, fetchPut, getBaseURL, proxyFetchPost, proxyFetchPut, proxyFetchGet, uploadFile, fetchDelete, waitForBackendReady } from '@/api/http';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { createStore } from 'zustand';
import { generateUniqueId, uploadLog } from "@/lib";
import { FileText } from 'lucide-react';
import { getAuthStore, useWorkerList } from './authStore';
import { useProjectStore } from './projectStore';
import { showCreditsToast } from '@/components/Toast/creditsToast';
import { showStorageToast } from '@/components/Toast/storageToast';
import { toast } from 'sonner';


interface Task {
	messages: Message[];
	type: string;
	summaryTask: string;
	taskInfo: TaskInfo[];
	attaches: File[];
	taskRunning: TaskInfo[];
	taskAssigning: Agent[];
	fileList: FileInfo[];
	webViewUrls: { url: string, processTaskId: string }[]
	activeAsk: string
	askList: Message[]
	progressValue: number
	isPending: boolean
	activeWorkSpace: string | null;
	hasMessages: boolean;
	activeAgent: string;
	status: 'running' | 'finished' | 'pending' | 'pause';
	taskTime: number;
	elapsed: number;
	tokens: number;
	hasWaitComfirm: boolean;
	cotList: string[];
	hasAddWorker: boolean
	nuwFileNum: number
	delayTime: number
	selectedFile: FileInfo | null;
	snapshots: any[];
	snapshotsTemp: any[];
	isTakeControl: boolean;
	isTaskEdit: boolean;
	isContextExceeded?: boolean;
	// Streaming decompose text - stored separately to avoid frequent re-renders
	streamingDecomposeText: string;
}

export interface ChatStore {
	updateCount: number;
	taskId: string | null;
	nextTaskId: string | null;
	task: Task | null;
	create: (id?: string, type?: any) => string;
	removeTask: () => void;
	stopTask: () => void;
	setStatus: (status: 'running' | 'finished' | 'pending' | 'pause') => void;
	replay: (question: string, time: number) => Promise<void>;
	startTask: (type?: string, shareToken?: string, delayTime?: number, messageContent?: string, messageAttaches?: File[]) => Promise<void>;
	handleConfirmTask: (project_id: string, type?: string) => void;
	addMessages: (messages: Message) => void;
	setMessages: (messages: Message[]) => void;
	updateMessage: (messageId: string, message: Message) => void;
	removeMessage: (messageId: string) => void;
	setAttaches: (attaches: File[]) => void;
	setSummaryTask: (summaryTask: string) => void;
	setHasWaitComfirm: (hasWaitComfirm: boolean) => void;
	setTaskAssigning: (taskAssigning: Agent[]) => void;
	setTaskInfo: (taskInfo: TaskInfo[]) => void;
	setTaskRunning: (taskRunning: TaskInfo[]) => void;
	setActiveAsk: (agentName: string) => void;
	setActiveAskList: (message: Message[]) => void;
	addWebViewUrl: (webViewUrl: string, processTaskId: string) => void;
	setWebViewUrls: (webViewUrls: { url: string, processTaskId: string }[]) => void;
	setProgressValue: (progressValue: number) => void;
	computedProgressValue: () => void;
	setIsPending: (isPending: boolean) => void;
	addTerminal: (processTaskId: string, terminal: string) => void;
	addFileList: (processTaskId: string, fileInfo: FileInfo) => void;
	setFileList: (processTaskId: string, fileList: FileInfo[]) => void;
	setActiveWorkSpace: (activeWorkSpace: string) => void;
	setActiveAgent: (agentName: string) => void;
	setHasMessages: (hasMessages: boolean) => void;
	getLastUserMessage: () => Message | null;
	addTaskInfo: () => void;
	updateTaskInfo: (index: number, content: string) => void;
	deleteTaskInfo: (index: number) => void;
	setTaskTime: (taskTime: number) => void;
	setElapsed: (taskTime: number) => void;
	getFormattedTaskTime: () => string;
	addTokens: (tokens: number) => void;
	getTokens: () => void;
	setUpdateCount: () => void;
	setCotList: (cotList: string[]) => void;
	setHasAddWorker: (hasAddWorker: boolean) => void;
	setNuwFileNum: (nuwFileNum: number) => void;
	setDelayTime: (delayTime: number) => void;
	setType: (type: string) => void;
	setSelectedFile: (selectedFile: FileInfo | null) => void;
	setSnapshots: (snapshots: any[]) => void,
	setIsTakeControl: (isTakeControl: boolean) => void,
	setSnapshotsTemp: (snapshot: any) => void,
	setIsTaskEdit: (isTaskEdit: boolean) => void,
	clearTask: () => void,
	setIsContextExceeded: (isContextExceeded: boolean) => void;
	setNextTaskId: (taskId: string | null) => void;
	setStreamingDecomposeText: (text: string) => void;
	clearStreamingDecomposeText: () => void;
}

export type VanillaChatStore = {
	getState: () => ChatStore;
	subscribe: (listener: (state: ChatStore) => void) => () => void;
};




// Track auto-confirm timers per task to avoid reusing stale timers across rounds
const autoConfirmTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// Track active SSE connections for proper cleanup
const activeSSEControllers: Record<string, AbortController> = {};

const normalizeToolkitMessage = (value: unknown) => {
	if (typeof value === "string") return value;
	if (value == null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const resolveProcessTaskIdForToolkitEvent = (
	currentTask: Task | null,
	agentName: string | undefined,
	processTaskId: unknown
) => {
	const direct = typeof processTaskId === "string" ? processTaskId : "";
	if (direct) return direct;

	const running = currentTask?.taskRunning ?? [];
	// Prefer a task owned by the same agent
	const match = running.findLast(
		(t: any) =>
			typeof t?.id === "string" &&
			t.id &&
			(agentName ? t.agent?.type === agentName : true)
	);
	if (match?.id) return match.id as string;
	// Fallback to the latest running task id
	const last = running.at(-1);
	if (typeof last?.id === "string" && last.id) return last.id;
	return "";
};
// Throttle streaming decompose text updates to prevent excessive re-renders
const streamingDecomposeTextBuffer: Record<string, string> = {};
const streamingDecomposeTextTimers: Record<string, ReturnType<typeof setTimeout>> = {};
// TTFT (Time to First Token) tracking for task decomposition
const ttftTracking: Record<string, { confirmedAt: number; firstTokenLogged: boolean }> = {};

const chatStore = (initial?: Partial<ChatStore>) => createStore<ChatStore>()(
	(set, get) => ({
		taskId: null,
		nextTaskId: null,
		task: initial?.task ?? null,
		updateCount: 0,
		create(id?: string, type?: any) {
			const newTaskId = id ? id : generateUniqueId();
			console.log("Create Task", newTaskId)
			set(() => ({
				taskId: newTaskId,
				task: {
					type: type,
					messages: [],
					summaryTask: "",
					taskInfo: [],
					attaches: [],
					taskRunning: [],
					taskAssigning: [],
					fileList: [],
					webViewUrls: [],
					activeAsk: '',
					askList: [],
					progressValue: 0,
					isPending: false,
					activeWorkSpace: 'workflow',
					hasMessages: false,
					activeAgent: '',
					status: 'pending',
					taskTime: 0,
					tokens: 0,
					elapsed: 0,
					hasWaitComfirm: false,
					cotList: [],
					hasAddWorker: false,
					nuwFileNum: 0,
					delayTime: 0,
					selectedFile: null,
					snapshots: [],
					snapshotsTemp: [],
					isTakeControl: false,
					isTaskEdit: false,
					streamingDecomposeText: '',
				},
			}))
			return newTaskId
		},
		computedProgressValue() {
			const { task, setProgressValue } = get()
			if (!task) return;
			const taskRunning = [...task.taskRunning]
			const finshedTask = taskRunning?.filter(
				(t) => t.status === "completed" || t.status === "failed"
			).length;
			const taskProgress = (
				((finshedTask || 0) / (taskRunning?.length || 0)) *
				100
			).toFixed(2);
			setProgressValue(Number(taskProgress));
		},
		removeTask() {
			const { taskId } = get();
			// Clean up any pending auto-confirm timers when removing a task
			try {
				if (taskId && autoConfirmTimers[taskId]) {
					clearTimeout(autoConfirmTimers[taskId]);
					delete autoConfirmTimers[taskId];
				}
			} catch (error) {
				console.warn('Error clearing auto-confirm timer in removeTask:', error);
			}

			// Clean up SSE connection if it exists
			try {
				if (taskId && activeSSEControllers[taskId]) {
					activeSSEControllers[taskId].abort();
					delete activeSSEControllers[taskId];
				}
			} catch (error) {
				console.warn('Error aborting SSE connection in removeTask:', error);
			}

			set(() => ({
				taskId: null,
				task: null,
				updateCount: 0,
				nextTaskId: null,
			}))
		},
		updateMessage(messageId: string, message: Message) {
			set((state) => {
				const task = state.task;
				if (!task) return state;
				const messages = task.messages.map((m) => {
					if (m.id === messageId) {
						return message;
					}
					return m;
				});
				return {
					task: {
						...task,
						messages,
					},
				};
			});
		},
		stopTask() {
			const { taskId } = get();
			// Abort the SSE connection for this task
			try {
				if (taskId && activeSSEControllers[taskId]) {
					console.log(`Stopping SSE connection for task ${taskId}`);
					activeSSEControllers[taskId].abort();
					delete activeSSEControllers[taskId];
				}
			} catch (error) {
				console.warn('Error aborting SSE connection in stopTask:', error);
				// Even if abort fails, still clean up the reference
				try {
					if (taskId) delete activeSSEControllers[taskId];
				} catch (cleanupError) {
					console.warn('Error cleaning up SSE controller reference:', cleanupError);
				}
			}

			// Clean up any pending auto-confirm timers
			try {
				if (taskId && autoConfirmTimers[taskId]) {
					clearTimeout(autoConfirmTimers[taskId]);
					delete autoConfirmTimers[taskId];
				}
			} catch (error) {
				console.warn('Error clearing auto-confirm timer in stopTask:', error);
			}

			// Update task status to finished - ensure this happens even if cleanup fails
			try {
				set((state) => {
					// Check if task exists before updating
					if (!state.task) {
						console.warn(`Task not found when trying to stop it`);
						return state;
					}

					return {
						task: {
							...state.task,
							status: 'finished'
						},
					};
				});
			} catch (error) {
				console.error('Error updating task status to finished in stopTask:', error);
			}
		},
		startTask: async (type?: string, shareToken?: string, delayTime?: number, messageContent?: string, messageAttaches?: File[]) => {
			// ✅ Wait for backend to be ready before starting task (except for replay/share)
			if (!type || type === 'normal') {
				console.log('[startTask] Checking if backend is ready...');
				const isBackendReady = await waitForBackendReady(15000, 500); // Wait up to 15 seconds

				if (!isBackendReady) {
					console.error('[startTask] Backend is not ready, cannot start task');
					const { addMessages } = get();
					addMessages({
						id: generateUniqueId(),
						role: 'agent',
						content: '❌ Backend service is not ready. Please wait a moment and try again, or restart the application if the problem persists.',
					});
					return;
				}
				console.log('[startTask] Backend is ready, proceeding with task...');
			}

			const { token, language, modelType, cloud_model_type, email } = getAuthStore()
			const workerList = useWorkerList();
			const { taskId, getLastUserMessage, setDelayTime, setType } = get();
			const baseURL = await getBaseURL();
			let systemLanguage = language
			if (language === 'system') {
				systemLanguage = await window.ipcRenderer.invoke('get-system-language');
			}
			if (type === 'replay') {
				setDelayTime(delayTime as number)
				setType(type)
			}

			//ProjectStore must exist as chatStore is already
			const projectStore = useProjectStore.getState();
			const project_id = projectStore.activeProjectId;
			//Create a new chatStore on Start
			let newTaskId = taskId;
			let targetChatStore = { getState: () => get() }; // Default to current store
			/**
			 * Replay creates its own chatStore for each task with replayProject
			 */
			if (project_id && type !== "replay") {
				console.log("Creating a new Chat Instance for current project on end")
				const newChatResult = projectStore.appendInitChatStore(project_id);

				if (newChatResult) {
					newTaskId = newChatResult.taskId;
					targetChatStore = newChatResult.chatStore;
					targetChatStore.getState().setIsPending(true);

					//From handleSend if message is given
					// Add the message to the new chatStore if provided
					if (messageContent) {
						targetChatStore.getState().addMessages({
							id: generateUniqueId(),
							role: "user",
							content: messageContent,
							attaches: messageAttaches || [],
						});
						targetChatStore.getState().setHasMessages(true);
					}
				}
			}

			// Ensure we have a valid taskId before proceeding
			if (!newTaskId) {
				console.error('[startTask] No task ID available to start task');
				throw Error('No task ID available, cannot proceed');
			}

			const base_Url = import.meta.env.DEV ? import.meta.env.VITE_PROXY_URL : import.meta.env.VITE_BASE_URL
			const api = type == 'share' ?
				`${base_Url}/api/chat/share/playback/${shareToken}?delay_time=${delayTime}`
				: type == 'replay' ?
					`${base_Url}/api/chat/steps/playback/${newTaskId}?delay_time=${delayTime}`
					: `${baseURL}/chat`

			const { task } = get()
			let historyId: string | null = projectStore.getHistoryId(project_id);
			let snapshots: any = [];
			let skipFirstConfirm = true;

			// replay or share request
			if (type) {
				const res = await proxyFetchGet(`/api/chat/snapshots`, {
					api_task_id: taskId
				});
				if (res) {
					snapshots = [...new Map(res.map((item: any) => [item.camel_task_id, item])).values()];
				}
			}


			// get current model
			let apiModel = {
				api_key: '',
				model_type: '',
				model_platform: '',
				api_url: '',
				extra_params: {}
			}
			if (modelType === 'custom' || modelType === 'local') {
				const res = await proxyFetchGet('/api/providers', {
					prefer: true
				});
				const providerList = res.items || []
				console.log('providerList', providerList)
				const provider = providerList[0]

				if (!provider) {
					throw new Error('No model provider configured. Please go to Settings > Models and configure at least one model provider as default.');
				}

				apiModel = {
					api_key: provider.api_key,
					model_type: provider.model_type,
					model_platform: provider.provider_name,
					api_url: provider.endpoint_url || provider.api_url,
					extra_params: provider.encrypted_config
				}
			} else if (modelType === 'cloud') {
				// get current model
				const res = await proxyFetchGet('/api/user/key');
				if (res.warning_code && res.warning_code === '21') {
					showStorageToast()
				}
				apiModel = {
					api_key: res.value,
					model_type: cloud_model_type,
					model_platform: cloud_model_type.includes('gpt') ? 'openai' :
						cloud_model_type.includes('claude') ? 'anthropic' :
							cloud_model_type.includes('gemini') ? 'gemini' : 'openai-compatible-model',
					api_url: res.api_url,
					extra_params: {}
				}
			}





			let mcpLocal = {}
			if (window.ipcRenderer) {
				mcpLocal = await window.ipcRenderer.invoke("mcp-list");
			}
			console.log('mcpLocal', mcpLocal)

			// Get search engine configuration for custom mode
			let searchConfig: Record<string, string> = {}
			if (modelType === 'custom') {
				try {
					const configsRes = await proxyFetchGet('/api/configs');
					const configs = Array.isArray(configsRes) ? configsRes : [];

					// Extract Google Search API keys
					const googleApiKey = configs.find((c: any) =>
						c.config_group?.toLowerCase() === 'search' &&
						c.config_name === 'GOOGLE_API_KEY'
					)?.config_value;

					const searchEngineId = configs.find((c: any) =>
						c.config_group?.toLowerCase() === 'search' &&
						c.config_name === 'SEARCH_ENGINE_ID'
					)?.config_value;

					if (googleApiKey && searchEngineId) {
						searchConfig = {
							GOOGLE_API_KEY: googleApiKey,
							SEARCH_ENGINE_ID: searchEngineId
						};
						console.log('Loaded custom search configuration');
					}
				} catch (error) {
					console.error('Failed to load search configuration:', error);
				}
			}

			const addWorkers = workerList.map((worker) => {
				return {
					name: worker.workerInfo?.name,
					description: worker.workerInfo?.description,
					tools: worker.workerInfo?.tools,
					mcp_tools: worker.workerInfo?.mcp_tools,
				}
			});

			// get env path
			let envPath = ''
			try {
				envPath = await window.ipcRenderer.invoke('get-env-path', email);
			} catch (error) {
				console.log('get-env-path error', error)
			}

			// create history
			if (!type) {
				const authStore = getAuthStore();

				const obj = {
					"project_id": project_id,
					"task_id": newTaskId,
					"user_id": authStore.user_id,
					"question": messageContent || (targetChatStore.getState().task?.messages[0]?.content ?? ''),
					"language": systemLanguage,
					"model_platform": apiModel.model_platform,
					"model_type": apiModel.model_type,
					"api_url": modelType === 'cloud' ? "cloud" : apiModel.api_url,
					"max_retries": 3,
					"file_save_path": "string",
					"installed_mcp": "string",
					"status": 1,
					"tokens": 0
				}
				await proxyFetchPost(`/api/chat/history`, obj).then(res => {
					historyId = res.id;

					/**Save history id for replay reuse purposes.
					 * TODO(history): Remove historyId handling to support per projectId 
					 * instead in history api
					 */
					if (project_id && historyId) projectStore.setHistoryId(project_id, historyId);
				})
			}
			const browser_port = await window.ipcRenderer.invoke('get-browser-port');

			// Lock the chatStore reference at the start of SSE session to prevent focus changes
			// during active message processing
			let lockedChatStore = targetChatStore;
			let lockedTaskId = newTaskId;

			// Create AbortController for this task's SSE connection
			// First check if there's already an active SSE connection for this task
			if (activeSSEControllers[newTaskId]) {
				console.warn(`Task ${newTaskId} already has an active SSE connection, aborting old one`);
				try {
					activeSSEControllers[newTaskId].abort();
				} catch (error) {
					console.warn('Error aborting existing SSE connection:', error);
				}
				delete activeSSEControllers[newTaskId];
			}

			const abortController = new AbortController();
			activeSSEControllers[newTaskId] = abortController;

			// Getter functions that use the locked references instead of dynamic ones
			const getCurrentChatStore = () => {
				return lockedChatStore.getState();
			};

			// Get the locked task ID - this won't change during the SSE session
			const getCurrentTaskId = () => {
				return lockedTaskId;
			};

			// Function to update locked references (only for special cases like replay)
			const updateLockedReferences = (newChatStore: VanillaChatStore, newTaskId: string) => {
				lockedChatStore = newChatStore;
				lockedTaskId = newTaskId;
			};

			fetchEventSource(api, {
				method: !type ? "POST" : "GET",
				openWhenHidden: true,
				signal: abortController.signal, // Add abort signal for proper cleanup
				headers: { "Content-Type": "application/json", "Authorization": type == 'replay' ? `Bearer ${token}` : undefined as unknown as string },
				body: !type ? JSON.stringify({
					project_id: project_id,
					task_id: newTaskId,
					question: messageContent || targetChatStore.getState().getLastUserMessage()?.content,
					model_platform: apiModel.model_platform,
					email,
					model_type: apiModel.model_type,
					api_key: apiModel.api_key,
					api_url: apiModel.api_url,
					extra_params: apiModel.extra_params,
					installed_mcp: { mcpServers: {} },
					language: systemLanguage,
					allow_local_system: true,
					attaches: (messageAttaches || targetChatStore.getState().task?.attaches || []).map((f: File) => f.filePath),
					summary_prompt: ``,
					new_agents: [...addWorkers],
					browser_port: browser_port,
					env_path: envPath,
					search_config: searchConfig
				}) : undefined,

				async onmessage(event: any) {
					let agentMessages: AgentMessage;

					try {
						agentMessages = JSON.parse(event.data);
					} catch (error) {
						console.error('Failed to parse SSE message:', error);
						console.error('Raw event.data:', event.data);

						// Create error task to notify user
						const currentStore = getCurrentChatStore();
						currentStore.create();
						currentStore.setHasWaitComfirm(true);
						currentStore.addMessages({
							id: generateUniqueId(),
							role: "agent",
							content: `**System Error**: Failed to parse server message. The connection may be unstable.\n\nPlease try again or contact support if this persists.`,
						});
						return;
					}

					// Check if this task has been stopped before processing any message
					// But allow messages that switch to new tasks (like confirmed events)
					const lockedTaskId = getCurrentTaskId();
					const currentTask = getCurrentChatStore().task;

					// Only ignore messages if task is finished and not a valid post-completion event
					// Valid events after task completion:
					// - Task switching: confirmed, new_task_state, end
					// - Multi-turn simple answer: wait_confirm
					const isTaskSwitchingEvent = agentMessages.step === "confirmed" ||
						agentMessages.step === "new_task_state" ||
						agentMessages.step === "end";

					const isMultiTurnSimpleAnswer = agentMessages.step === "wait_confirm";

					if (!currentTask) {
						console.log(`Task ${lockedTaskId} not found, ignoring SSE message for step: ${agentMessages.step}`);
						return;
					}

					if (currentTask.status === 'finished' && !isTaskSwitchingEvent && !isMultiTurnSimpleAnswer) {
						// Ignore messages for finished tasks except:
						// 1. Task switching events (create new chatStore)
						// 2. Simple answer events (direct response without new chatStore)
						console.log(`Ignoring SSE message for finished task ${lockedTaskId}, step: ${agentMessages.step}`);
						return;
					}

					console.log("agentMessages", agentMessages);
					const agentNameMap = {
						developer_agent: "Developer Agent",
						browser_agent: "Browser Agent",
						document_agent: "Document Agent",
						multi_modal_agent: "Multi Modal Agent",
						social_medium_agent: "Social Media Agent",
					};


					/**
					 * Persistent workforce instance, new chat
					 * If confirmed -> subtasks -> confirmed (use a new chatStore)
					 * handle cases for @event new_task_state and @function startTask
					 */
					let currentTaskId = getCurrentTaskId();
					const previousChatStore = getCurrentChatStore()
					if (agentMessages.step === "confirmed") {
						const { question } = agentMessages.data;
						const shouldCreateNewChat = project_id && (question || messageContent);

						//All except first confirmed event to reuse the existing chatStore
						if (shouldCreateNewChat && !skipFirstConfirm) {
							/**
							 * For Tasks where appended to existing project by
							 * reusing same projectId. Need to create new chatStore
							 * as it has been skipped earlier in startTask.
							*/
							const nextTaskId = previousChatStore.nextTaskId || undefined;
							const newChatResult = projectStore.appendInitChatStore(project_id || projectStore.activeProjectId!, nextTaskId);

							if (newChatResult) {
								const { taskId: newTaskId, chatStore: newChatStore } = newChatResult;

								// Update references for both scenarios
								updateLockedReferences(newChatStore, newTaskId);
								newChatStore.getState().setIsPending(false);

								if (type === "replay") {
									newChatStore.getState().setDelayTime(delayTime as number);
									newChatStore.getState().setType("replay");
								}

								const lastMessage = previousChatStore.task?.messages.at(-1);
								if (lastMessage?.role === "user" && lastMessage?.id) {
									previousChatStore.removeMessage(lastMessage.id);
								}

								//Trick: by the time the question is retrieved from event,
								//the last message from previous chatStore is at display
								newChatStore.getState().addMessages({
									id: generateUniqueId(),
									role: "user",
									content: question || messageContent as string,
									//TODO: The attaches that reach here (when Improve API is called) doesn't reach the backend
									attaches: [...(previousChatStore.task?.attaches || []), ...(messageAttaches || [])],
								});
								console.log("[NEW CHATSTORE] Created for ", project_id);

								//Create a new history point
								if (!type) {
									const authStore = getAuthStore();

									const obj = {
										"project_id": project_id,
										"task_id": newTaskId,
										"user_id": authStore.user_id,
										"question": question || messageContent || (targetChatStore.getState().task?.messages[0]?.content ?? ''),
										"language": systemLanguage,
										"model_platform": apiModel.model_platform,
										"model_type": apiModel.model_type,
										"api_url": modelType === 'cloud' ? "cloud" : apiModel.api_url,
										"max_retries": 3,
										"file_save_path": "string",
										"installed_mcp": "string",
										"status": 1,
										"tokens": 0
									}
									await proxyFetchPost(`/api/chat/history`, obj).then(res => {
										historyId = res.id;

										/**Save history id for replay reuse purposes.
										 * TODO(history): Remove historyId handling to support per projectId 
										 * instead in history api
										 */
										if (project_id && historyId) projectStore.setHistoryId(project_id, historyId);
									})
								}
							}
						} else {
							//NOTE: Triggered only with first "confirmed" in the project
							//Handle Original cases - with old chatStore
							previousChatStore.setStatus('pending');
							previousChatStore.setHasWaitComfirm(false);
						}

						//Enable it for the rest of current SSE session
						skipFirstConfirm = false;

						// Record confirmed time for TTFT tracking
						const ttftTaskId = getCurrentTaskId();
						ttftTracking[ttftTaskId] = { confirmedAt: performance.now(), firstTokenLogged: false };
						console.log(`[TTFT] Task ${ttftTaskId} confirmed at ${new Date().toISOString()}, starting TTFT measurement`);
						return
					}

					const {
						setNuwFileNum,
						setCotList,
						getTokens,
						setUpdateCount,
						addTokens,
						setStatus,
						addWebViewUrl,
						setIsPending,
						addMessages,
						setHasWaitComfirm,
						setSummaryTask,
						setTaskAssigning,
						setTaskInfo,
						setTaskRunning,
						addTerminal,
						addFileList,
						setActiveAsk,
						setActiveAskList,
						task,
						create,
						setTaskTime,
						setElapsed,
						setIsContextExceeded,
						setStreamingDecomposeText,
						clearStreamingDecomposeText,
						setIsTaskEdit } = getCurrentChatStore()

					currentTaskId = getCurrentTaskId();
					// if (task?.status === 'finished') return
					if (agentMessages.step === "decompose_text") {
						const { content } = agentMessages.data;
						const text = content;
						const currentId = getCurrentTaskId();

						// Log TTFT (Time to First Token) on first decompose_text event
						if (ttftTracking[currentId] && !ttftTracking[currentId].firstTokenLogged) {
							ttftTracking[currentId].firstTokenLogged = true;
							const ttft = performance.now() - ttftTracking[currentId].confirmedAt;
							console.log(`%c[TTFT] 🚀 Time to First Token: ${ttft.toFixed(2)}ms - First streaming token received for task ${currentId}`, 'color: #4CAF50; font-weight: bold');
						}

						// Get current buffer or task state
						const currentContent = streamingDecomposeTextBuffer[currentId] ||
							getCurrentChatStore().task?.streamingDecomposeText || "";
						const newContent = text || "";
						let updatedContent = newContent;

						if (newContent.startsWith(currentContent)) {
							// Accumulated format: new content contains old content -> Replace
							updatedContent = newContent;
						} else {
							// Delta format: new content is a chunk -> Append
							updatedContent = currentContent + newContent;
						}

						// Store in buffer immediately
						streamingDecomposeTextBuffer[currentId] = updatedContent;

						// Throttle store updates to every 50ms for smoother streaming display
						if (!streamingDecomposeTextTimers[currentId]) {
							streamingDecomposeTextTimers[currentId] = setTimeout(() => {
								const bufferedText = streamingDecomposeTextBuffer[currentId];
								if (bufferedText !== undefined) {
									setStreamingDecomposeText(bufferedText);
								}
								delete streamingDecomposeTextTimers[currentId];
							}, 16);
						}
						return;
					}

					if (agentMessages.step === "to_sub_tasks") {
						// Clear streaming decompose text when task splitting is done
						clearStreamingDecomposeText();
						// Clean up TTFT tracking
						delete ttftTracking[currentTaskId];
						// Check if this is a multi-turn scenario after task completion
						const isMultiTurnAfterCompletion = task?.status === 'finished';

						// Reset status for multi-turn complex tasks to allow splitting panel to show
						if (isMultiTurnAfterCompletion) {
							setStatus('pending');
						}

						// Each splitting round starts in a clean editing state
						setIsTaskEdit(false);

						const messages = [...(task?.messages || [])]
						const toSubTaskIndex = messages.findLastIndex((message: Message) => message.step === 'to_sub_tasks')
						// For multi-turn scenarios, always create a new to_sub_tasks message
						// even if one already exists from a previous task
						if (toSubTaskIndex === -1 || isMultiTurnAfterCompletion) {
							// Clear any pending auto-confirm timer from previous rounds
							try {
								if (autoConfirmTimers[currentTaskId]) {
									clearTimeout(autoConfirmTimers[currentTaskId]);
									delete autoConfirmTimers[currentTaskId];
								}
							} catch (error) {
								console.warn('Error clearing auto-confirm timer:', error);
							}

							// 30 seconds auto confirm
							try {
								autoConfirmTimers[currentTaskId] = setTimeout(() => {
									try {
										const currentStore = getCurrentChatStore();
										const currentId = getCurrentTaskId();
										const { task, handleConfirmTask, setIsTaskEdit } = currentStore;
										const message = task?.messages.findLast((item: Message) => item.step === "to_sub_tasks");
										const isConfirm = message?.isConfirm || false;
										const isTakeControl = task?.isTakeControl;

										if (project_id && !isConfirm && !isTakeControl && !task?.isTaskEdit) {
											handleConfirmTask(project_id, type);
										}
										setIsTaskEdit(false);
										delete autoConfirmTimers[currentId];
									} catch (error) {
										console.error('Error in auto-confirm timeout handler:', error);
										// Clean up the timer reference even if there's an error
										delete autoConfirmTimers[currentTaskId];
									}
								}, 30000);
							} catch (error) {
								console.error('Error setting auto-confirm timer:', error);
							}

							const newNoticeMessage: Message = {
								id: generateUniqueId(),
								role: "agent",
								content: "",
								step: 'notice_card',
							};
							addMessages(newNoticeMessage)
							const shouldAutoConfirm = !!type && !isMultiTurnAfterCompletion;

							const newMessage: Message = {
								id: generateUniqueId(),
								role: "agent",
								content: "",
								step: agentMessages.step,
								taskType: type ? 2 : 1,
								showType: "list",
								// Don't auto-confirm for multi-turn complex tasks - show workforce splitting panel
								isConfirm: shouldAutoConfirm,
								task_id: currentTaskId
							};
							addMessages(newMessage)
							const newTaskInfo = {
								id: "",
								content: "",
							};
							type !== 'replay' && agentMessages.data.sub_tasks?.push(newTaskInfo)
						}
						agentMessages.data.sub_tasks = agentMessages.data.sub_tasks?.map(item => {
							item.status = ''
							return item
						})

						if (!type && historyId) {
							const obj = {
								"project_name": agentMessages.data!.summary_task?.split('|')[0] || '',
								"summary": agentMessages.data!.summary_task?.split('|')[1] || '',
								"status": 1,
								"tokens": getTokens()
							}
							proxyFetchPut(`/api/chat/history/${historyId}`, obj)
						}
						setSummaryTask(agentMessages.data.summary_task as string)
						setTaskInfo(agentMessages.data.sub_tasks as TaskInfo[])
						setTaskRunning(agentMessages.data.sub_tasks as TaskInfo[])
						return;
					}
					// Create agent
					if (agentMessages.step === "create_agent") {
						const { agent_name, agent_id } = agentMessages.data;
						if (!agent_name || !agent_id) return;

						// Add agent to taskAssigning
						if (!['mcp_agent', 'new_worker_agent', 'task_agent', 'task_summary_agent', "coordinator_agent", "question_confirm_agent"].includes(agent_name)) {
							// if (agentNameMap[agent_name as keyof typeof agentNameMap]) {
							const hasAgent = task?.taskAssigning.find((agent: Agent) => agent.agent_id === agent_id)

							if (!hasAgent) {
								let activeWebviewIds: any = [];
								if (agent_name == 'browser_agent') {
									snapshots.forEach((item: any) => {
										const imgurl = !item.image_path.includes('/public') ? item.image_path : (import.meta.env.DEV ? import.meta.env.VITE_PROXY_URL : import.meta.env.VITE_BASE_URL) + item.image_path
										activeWebviewIds.push({
											id: item.id,
											img: imgurl,
											processTaskId: item.camel_task_id,
											url: item.browser_url
										})
									})
								}
								setTaskAssigning([...(task?.taskAssigning || []), {
									agent_id,
									name: agentNameMap[agent_name as keyof typeof agentNameMap] || agent_name,
									type: agent_name as AgentNameType,
									tasks: [],
									log: [],
									img: [],
									tools: agentMessages.data.tools,
									activeWebviewIds: activeWebviewIds,
								}])
							}
						}
						return;
					}
					if (agentMessages.step === "wait_confirm") {
						const { content, question } = agentMessages.data;
						setHasWaitComfirm(true)
						setIsPending(false)

						const currentChatStore = getCurrentChatStore();
						//Make sure to add user Message on replay and avoid duplication of first msg
						if (question && !(currentChatStore.task?.messages.length === 1)) {
							//Replace the optimistic update if existent.
							const lastMessage = currentChatStore.task?.messages.at(-1);
							if (lastMessage?.role === "user" && lastMessage.id && lastMessage.content === question) {
								currentChatStore.removeMessage(lastMessage.id)
							}
							addMessages({
								id: generateUniqueId(),
								role: "user",
								content: question as string,
								step: "wait_confirm",
								isConfirm: false,
							})
						}
						addMessages({
							id: generateUniqueId(),
							role: "agent",
							content: content as string,
							step: "wait_confirm",
							isConfirm: false,
						})
						return;
					}
					// Task State
					if (agentMessages.step === "task_state") {
						const { state, task_id, result, failure_count } = agentMessages.data;
						if (!state && !task_id) return

						let taskRunning = [...(task?.taskRunning || [])]
						let taskAssigning = [...(task?.taskAssigning || [])]
						const targetTaskIndex = taskRunning.findIndex((t) => t.id === task_id)
						const targetTaskAssigningIndex = taskAssigning.findIndex((agent) => agent.tasks.find((t: TaskInfo) => t.id === task_id && !t.reAssignTo))
						if (targetTaskAssigningIndex !== -1) {
							const taskIndex = taskAssigning[targetTaskAssigningIndex].tasks.findIndex((t: TaskInfo) => t.id === task_id)
							const targetTask = taskAssigning[targetTaskAssigningIndex].tasks[taskIndex];
							targetTask.status = state === "DONE" ? "completed" : "failed";
							targetTask.failure_count = typeof failure_count === 'number' ? failure_count : 0;

							// destroy webview
							(task?.taskAssigning || []).forEach((item: Agent) => {
								if (item.type === "browser_agent" && item.activeWebviewIds?.length && item.activeWebviewIds?.length > 0) {
									let removeList: number[] = []
									item.activeWebviewIds.map((webview, index) => {
										if (webview.processTaskId === task_id) {
											window.electronAPI.webviewDestroy(webview.id);
											removeList.push(index)
										}
									});
									removeList.forEach((webviewIndex) => {
										item.activeWebviewIds?.splice(webviewIndex, 1);
									});
								}
							})


							if (result && result !== '') {
								let targetResult = result.replace(taskAssigning[targetTaskAssigningIndex].agent_id, taskAssigning[targetTaskAssigningIndex].name)
								taskAssigning[targetTaskAssigningIndex].tasks[taskIndex].report = targetResult
								if (state === "FAILED" && failure_count && failure_count >= 3) {
									addMessages({
										id: generateUniqueId(),
										role: "agent",
										content: targetResult,
										step: "failed",
									})
								}
							}

						}
						if (targetTaskIndex !== -1) {
							console.log("targetTaskIndex", targetTaskIndex, state)
							taskRunning[targetTaskIndex].status = state === "DONE" ? "completed" : "failed";
						}
						setTaskRunning(taskRunning)
						setTaskAssigning(taskAssigning)
						return;
					}
					/**  New Task State from queue
					 * @deprecated
					 * Side effect handled on top of the message handler
					 */
					if (agentMessages.step === "new_task_state") {
						const { task_id, content, state, result, failure_count } = agentMessages.data;
						//new chatStore logic is handled along side "confirmed" event
						console.log(`Recieved new task: ${task_id} with content: ${content}`);
						return;
					}

					// Activate agent
					if (agentMessages.step === "activate_agent" || agentMessages.step === "deactivate_agent") {
						let taskAssigning = [...(task?.taskAssigning || [])]
						let taskRunning = [...(task?.taskRunning || [])]
						if (agentMessages.data.tokens) {
							addTokens(agentMessages.data.tokens)
						}
						const { state, agent_id, process_task_id } = agentMessages.data;
						if (!state && !agent_id && !process_task_id) return
						const agentIndex = taskAssigning.findIndex((agent) => agent.agent_id === agent_id)

						if (agentIndex === -1) return;

						// // add log
						// const message = filterMessage(agentMessages.data.message || '', agentMessages.data.method_name)
						// if (message) {
						// 	taskAssigning[agentIndex].log.push(agentMessages);
						// }

						const message = filterMessage(agentMessages)
						if (agentMessages.step === "activate_agent") {
							taskAssigning[agentIndex].status = "running";
							if (message) {
								taskAssigning[agentIndex].log.push({
									...agentMessages,
									status: "running",
								});
							}
							const taskIndex = taskRunning.findIndex((t) => t.id === process_task_id);
							if (taskIndex !== -1 && taskRunning![taskIndex].status) {
								taskRunning![taskIndex].agent!.status = "running";
								taskRunning![taskIndex]!.status = "running";

								const foundTask = taskAssigning[agentIndex].tasks.find((t: TaskInfo) => t.id === process_task_id);
								if (foundTask) {
									foundTask.status = "running";
								}
							}
							setTaskRunning([...taskRunning]);
							setTaskAssigning([...taskAssigning]);
						}
						if (agentMessages.step === "deactivate_agent") {
							if (message) {
								const index = taskAssigning[agentIndex].log.findLastIndex((log) => log.data.method_name === agentMessages.data.method_name && log.data.toolkit_name === agentMessages.data.toolkit_name)
								if (index != -1) {
									taskAssigning[agentIndex].log[index].status = "completed";
									setTaskAssigning([...taskAssigning]);
								}

							}
							// const taskIndex = taskRunning.findIndex((t) => t.id === process_task_id);
							// if (taskIndex !== -1) {
							// 	taskRunning![taskIndex].agent!.status = "completed";
							// 	taskRunning![taskIndex]!.status = "completed";
							// }


							if (!type && historyId) {
								const obj = {
									"project_name": task?.summaryTask.split('|')[0],
									"summary": task?.summaryTask.split('|')[1],
									"status": 1,
									"tokens": getTokens()
								}
								proxyFetchPut(`/api/chat/history/${historyId}`, obj)
							}


							setTaskRunning([...taskRunning]);
							setTaskAssigning([...taskAssigning]);



						}
						return;
					}
					// Assign task
					if (agentMessages.step === "assign_task") {
						if (!agentMessages.data?.assignee_id || !agentMessages.data?.task_id) return;

						const { assignee_id, task_id, content = "", state: taskState, failure_count } = agentMessages.data as any;
						let taskAssigning = [...(task?.taskAssigning || [])]
						let taskRunning = [...(task?.taskRunning || [])]
						let taskInfo: TaskInfo[] = [...(task?.taskInfo || [])]

						// Find the index of the agent corresponding to assignee_id
						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.agent_id === assignee_id);
						// Find task corresponding to task_id
						const foundTaskInfo = taskInfo!.find((t: TaskInfo) => t.id === task_id);

						const taskRunningIndex = taskRunning!.findIndex((t: TaskInfo) => t.id === task_id);

						// Skip tasks with empty content only if the task doesn't exist in taskInfo
						// If task exists in taskInfo, we should still process status updates
						if ((!content || content.trim() === "") && !foundTaskInfo) {
							console.warn(`Skipping task ${task_id} with empty content and not found in taskInfo`);
							return;
						}

						if (assigneeAgentIndex === -1) return;
						const taskAgent = taskAssigning![assigneeAgentIndex];

						// Find the agent to reassign the task to
						const target = taskAssigning
							.map((agent, agentIndex) => {
								if (agent.agent_id === assignee_id) return null

								const taskIndex = agent.tasks.findIndex(
									(task: TaskInfo) => task.id === task_id && !task.reAssignTo
								)

								return taskIndex !== -1 ? { agentIndex, taskIndex } : null
							})
							.find(Boolean)

						if (target) {
							const { agentIndex, taskIndex } = target
							const agentName = taskAssigning.find((agent: Agent) => agent.agent_id === assignee_id)?.name
							if (agentName !== taskAssigning[agentIndex].name) {
								taskAssigning[agentIndex].tasks[taskIndex].reAssignTo = agentName
							}
						}

						// Clear logs from the assignee agent that are related to this task
						// This prevents logs from previous attempts appearing in the reassigned task
						// This needs to happen whether it's a reassignment to a different agent or a retry with the same agent
						if (taskState !== "waiting" && failure_count && failure_count > 0) {
							taskAssigning[assigneeAgentIndex].log = taskAssigning[assigneeAgentIndex].log.filter(
								(log) => log.data.process_task_id !== task_id
							)
						}


						// Handle task assignment to taskAssigning based on state
						if (taskState === "waiting") {
							if (!taskAssigning[assigneeAgentIndex].tasks.find(item => item.id === task_id)) {
								taskAssigning[assigneeAgentIndex].tasks.push(foundTaskInfo ?? { id: task_id, content, status: "waiting" });
							}
							setTaskAssigning([...taskAssigning]);

						}
						// The following logic is for when the task actually starts executing (running)
						else if (taskAssigning && taskAssigning[assigneeAgentIndex]) {
							// Check if task already exists in the agent's task list
							const existingTaskIndex = taskAssigning[assigneeAgentIndex].tasks.findIndex(item => item.id === task_id);

							if (existingTaskIndex !== -1) {
								// Task already exists, update its status
								taskAssigning[assigneeAgentIndex].tasks[existingTaskIndex].status = "running";
								if (failure_count !== 0) {
									taskAssigning[assigneeAgentIndex].tasks[existingTaskIndex].failure_count = failure_count;
								}
							} else {
								// Task doesn't exist, add it
								let taskTemp = null
								if (foundTaskInfo) {
									taskTemp = JSON.parse(JSON.stringify(foundTaskInfo))
									taskTemp.failure_count = 0
									taskTemp.status = "running"
									taskTemp.toolkits = []
									taskTemp.report = ""
								}
								taskAssigning[assigneeAgentIndex].tasks.push(taskTemp ?? { id: task_id, content, status: "running", });
							}
						}

						// Only update or add to taskRunning, never duplicate
						if (taskRunningIndex === -1) {
							// Task not in taskRunning, add it
							if (foundTaskInfo) {
								foundTaskInfo.status = taskState === "waiting" ? "waiting" : "running";
							}
							taskRunning!.push(
								foundTaskInfo ?? {
									id: task_id,
									content,
									status: taskState === "waiting" ? "waiting" : "running",
									agent: JSON.parse(JSON.stringify(taskAgent)),
								}
							);
						} else {
							// Task already in taskRunning, update it
							taskRunning![taskRunningIndex] = {
								...taskRunning![taskRunningIndex],
								status: taskState === "waiting" ? "waiting" : "running",
								agent: JSON.parse(JSON.stringify(taskAgent)),
							};
						}
						setTaskRunning([...taskRunning]);
						setTaskAssigning([...taskAssigning]);

						return;
					}
					// Activate Toolkit
					if (agentMessages.step === "activate_toolkit") {
						// add log
						let taskAssigning = [...(task?.taskAssigning || [])]
						const resolvedProcessTaskId = resolveProcessTaskIdForToolkitEvent(
							task,
							agentMessages.data.agent_name,
							agentMessages.data.process_task_id
						);
						let assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((t: TaskInfo) => t.id === resolvedProcessTaskId));

						// Fallback: if task ID not found, try finding by agent type
						if (assigneeAgentIndex === -1 && agentMessages.data.agent_name) {
							assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.type === agentMessages.data.agent_name);
						}

						if (assigneeAgentIndex !== -1) {
							const message = filterMessage(agentMessages)
							if (message) {
								taskAssigning[assigneeAgentIndex].log.push(agentMessages);
								setTaskAssigning([...taskAssigning]);
							}
						}

						if (agentMessages.data.toolkit_name === 'Browser Toolkit' && agentMessages.data.method_name === 'browser visit page') {
							addWebViewUrl(normalizeToolkitMessage(agentMessages.data.message).replace(/url=/g, '').replace(/'/g, '') as string, resolvedProcessTaskId)
						}
						if (agentMessages.data.toolkit_name === 'Browser Toolkit' && agentMessages.data.method_name === 'visit page') {
							console.log('match success')
							addWebViewUrl(normalizeToolkitMessage(agentMessages.data.message) as string, resolvedProcessTaskId)
						}
						if (agentMessages.data.toolkit_name === 'ElectronToolkit' && agentMessages.data.method_name === 'browse_url') {
							addWebViewUrl(normalizeToolkitMessage(agentMessages.data.message) as string, resolvedProcessTaskId)
						}
						if (agentMessages.data.method_name === 'browser_navigate' && agentMessages.data.message?.startsWith('{"url"')) {
							try {
								const urlData = JSON.parse(normalizeToolkitMessage(agentMessages.data.message));
								if (urlData?.url) {
									addWebViewUrl(urlData.url as string, resolvedProcessTaskId)
								}
							} catch (error) {
								console.error('Failed to parse browser_navigate URL:', error);
								console.error('Raw message:', agentMessages.data.message);
							}
						}
						let taskRunning = [...(task?.taskRunning || [])]

						const taskIndex = taskRunning.findIndex((t) => t.id === resolvedProcessTaskId);

						if (taskIndex !== -1) {
							const { toolkit_name, method_name } = agentMessages.data;
							if (toolkit_name && method_name) {
								const message = filterMessage(agentMessages)
								if (message) {
									const toolkit = {
										toolkitId: generateUniqueId(),
										toolkitName: toolkit_name,
										toolkitMethods: method_name,
										message: normalizeToolkitMessage(message.data.message),
										toolkitStatus: "running" as AgentStatus,
									}

									// Update taskAssigning if we found the agent
									if (assigneeAgentIndex !== -1) {
										const foundTask = taskAssigning[assigneeAgentIndex].tasks.find((t: TaskInfo) => t.id === resolvedProcessTaskId);
										if (foundTask) {
											foundTask.toolkits ??= []
											foundTask.toolkits.push({ ...toolkit });
											foundTask.status = "running";
											setTaskAssigning([...taskAssigning]);
										}
									}

									// Always update taskRunning (even if assigneeAgentIndex is -1)
									taskRunning![taskIndex].status = "running";
									taskRunning![taskIndex].toolkits ??= [];
									taskRunning![taskIndex].toolkits.push({ ...toolkit });
								}
							}
						}
						setTaskRunning(taskRunning);
						return;
					}
					// Deactivate Toolkit
					if (agentMessages.step === "deactivate_toolkit") {

						// add log
						let taskAssigning = [...(task?.taskAssigning || [])]
						const resolvedProcessTaskId = resolveProcessTaskIdForToolkitEvent(
							task,
							agentMessages.data.agent_name,
							agentMessages.data.process_task_id
						);

						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((task: TaskInfo) => task.id === resolvedProcessTaskId));
						if (assigneeAgentIndex !== -1) {
							const message = filterMessage(agentMessages)
							if (message) {
								const task = taskAssigning[assigneeAgentIndex].tasks.find((task: TaskInfo) => task.id === resolvedProcessTaskId);
								if (task) {
									let index = task.toolkits?.findIndex((toolkit: any) => {
										return toolkit.toolkitName === agentMessages.data.toolkit_name && toolkit.toolkitMethods === agentMessages.data.method_name && toolkit.toolkitStatus === 'running'
									})

									if (task.toolkits && index !== -1 && index !== undefined) {
										task.toolkits[index].message = `${normalizeToolkitMessage(task.toolkits[index].message)}\n${normalizeToolkitMessage(message.data.message)}`.trim()
										task.toolkits[index].toolkitStatus = "completed"
									}
									// task.toolkits?.unshift({
									// 	toolkitName: agentMessages.data.toolkit_name as string,
									// 	toolkitMethods: agentMessages.data.method_name as string,
									// 	message: message.data.message as string,
									// 	toolkitStatus: "completed",
									// });
									// task.toolkits?.unshift({
									// 	toolkitName: agentMessages.data.toolkit_name as string,
									// 	toolkitMethods: agentMessages.data.method_name as string,
									// 	message: message.data.message as string,
									// 	toolkitStatus: "completed",
									// });

								}
								taskAssigning[assigneeAgentIndex].log.push(agentMessages);

								setTaskAssigning([...taskAssigning]);
							}
						}

						let taskRunning = [...(task?.taskRunning || [])]
						const { toolkit_name, method_name, message } =
							agentMessages.data;
						const taskIndex = taskRunning.findIndex((t) =>
							t.agent?.type === agentMessages.data.agent_name &&
							t.toolkits?.at(-1)?.toolkitName === toolkit_name
						);

						if (taskIndex !== -1) {
							if (toolkit_name && method_name && message) {
								const targetMessage = filterMessage(agentMessages)

								if (targetMessage) {
									taskRunning![taskIndex].toolkits?.unshift({
										toolkitName: toolkit_name,
										toolkitMethods: method_name,
										message: normalizeToolkitMessage(targetMessage.data.message),
										toolkitStatus: "completed",
									});
								}

							}
						}
						setTaskAssigning([...taskAssigning]);
						setTaskRunning(taskRunning);
						return;
					}
					// Terminal
					if (agentMessages.step === "terminal") {
						addTerminal(agentMessages.data.process_task_id as string, agentMessages.data.output as string)
						return
					}
					// Write File
					if (agentMessages.step === "write_file") {
						console.log('write_to_file', agentMessages.data)
						setNuwFileNum((task?.nuwFileNum || 0) + 1)
						const { file_path } = agentMessages.data;
						const fileName = file_path?.replace(/\\/g, "/").split("/").pop() || "";
						const fileType = fileName.split(".").pop() || "";
						const fileInfo: FileInfo = {
							name: fileName,
							type: fileType,
							path: file_path || "",
							icon: FileText,
						};
						addFileList(agentMessages.data.process_task_id as string, fileInfo);
						return;
					}

					if (agentMessages.step === "budget_not_enough") {
						console.log('error', agentMessages.data)
						showCreditsToast()
						setStatus('pause');
						uploadLog(currentTaskId, type)
						return
					}


					if (agentMessages.step === "context_too_long") {
						console.error('Context too long:', agentMessages.data)
						const currentLength = agentMessages.data.current_length || 0;
						const maxLength = agentMessages.data.max_length || 100000;

						// Show toast notification
						toast.dismiss();
						toast.error(
							`⚠️ Context Limit Exceeded\n\nThe conversation history is too long (${currentLength.toLocaleString()} / ${maxLength.toLocaleString()} characters).\n\nPlease create a new project to continue your work.`,
							{
								duration: Infinity,
								closeButton: true,
							}
						);

						// Set flag to block input and set status to pause
						setIsContextExceeded(true);
						setStatus("pause");
						uploadLog(currentTaskId, type);
						return
					}

					if (agentMessages.step === "error") {
						try {
							console.error('Model error:', agentMessages.data);

							// Validate that agentMessages.data exists before processing
							if (agentMessages.data === undefined || agentMessages.data === null) {
								throw new Error('Invalid error message format: missing data');
							}

							// Safely extract error message with fallback chain
							const errorMessage = agentMessages.data?.message ||
								(typeof agentMessages.data === 'string' ? agentMessages.data : null) ||
								'An error occurred while processing your request';

							// Mark all incomplete tasks as failed
							let taskRunning = [...(task?.taskRunning || [])];
							let taskAssigning = [...(task?.taskAssigning || [])];

							// Update taskRunning - mark non-completed tasks as failed
							taskRunning = taskRunning.map((task) => {
								if (task.status !== "completed" && task.status !== "failed") {
									task.status = "failed";
								}
								return task;
							});

							// Update taskAssigning - mark non-completed tasks as failed
							taskAssigning = taskAssigning.map((agent) => {
								agent.tasks = agent.tasks.map((t: TaskInfo) => {
									if (t.status !== "completed" && t.status !== "failed") {
										t.status = "failed";
									}
									return t;
								});
								return agent;
							});

							// Apply the updates
							setTaskRunning(taskRunning);
							setTaskAssigning(taskAssigning);

							// Complete the current task with error status
							setStatus('finished');
							setIsPending(false);

							// Add error message to the current task
							addMessages({
								id: generateUniqueId(),
								role: "agent",
								content: `❌ **Error**: ${errorMessage}`,
							});
							uploadLog(currentTaskId, type)

							// Stop the workforce
							try {
								await fetchDelete(`/chat/${project_id}`);
							} catch (error) {
								console.log("Task may not exist on backend:", error);
							}
						} catch (error) {
							console.error('Failed to handle model error:', error);
							console.error('Original agentMessages:', agentMessages);

							// Fallback: try to create error task with minimal operations
							try {
								const { create, setHasWaitComfirm, addMessages } = get();
								create();
								setHasWaitComfirm(true);
								addMessages({
									id: generateUniqueId(),
									role: "agent",
									content: `**Critical Error**: An unexpected error occurred while handling a model error. Please refresh the application or contact support.`,
								});
							} catch (fallbackError) {
								console.error('Failed to create fallback error task:', fallbackError);
								// Last resort: just log the error without creating UI elements
								console.error('Original error that could not be displayed:', agentMessages);
							}
						}
						return;
					}

					// Handle add_task events for project store
					if (agentMessages.step === "add_task") {
						try {
							const taskData = agentMessages.data;
							if (taskData && taskData.project_id && taskData.content) {
								console.log(`Task added to project queue: ${taskData.project_id}`);
							}
						} catch (error) {
							const taskIdToRemove = agentMessages.data.task_id as string;
							const projectStore = useProjectStore.getState();
							//Remove the task from the queue on error
							if (project_id) {
								const project = projectStore.getProjectById(project_id);
								if (project && project.queuedMessages) {
									const messageToRemove = project.queuedMessages.find(msg =>
										msg.task_id === taskIdToRemove || msg.content.includes(taskIdToRemove)
									);
									if (messageToRemove) {
										projectStore.removeQueuedMessage(project_id, messageToRemove.task_id);
										console.log(`Task removed from project queue: ${taskIdToRemove}`);
									}
								}
							}
							console.error('Error adding task to project store:', error);
						}
						return;
					}

					// Handle remove_task events for project store
					if (agentMessages.step === "remove_task") {
						try {
							const taskIdToRemove = agentMessages.data.task_id as string;
							if (taskIdToRemove) {
								const projectStore = useProjectStore.getState();
								// Try to remove from current project otherwise
								const project_id = agentMessages.data.project_id ?? projectStore.activeProjectId;
								if (project_id) {
									// Find and remove the message with matching task ID
									const project = projectStore.getProjectById(project_id);
									if (project && project.queuedMessages) {
										const messageToRemove = project.queuedMessages.find(msg =>
											msg.task_id === taskIdToRemove || msg.content.includes(taskIdToRemove)
										);
										if (messageToRemove) {
											projectStore.removeQueuedMessage(project_id, messageToRemove.task_id);
											console.log(`Task removed from project queue: ${taskIdToRemove}`);
										}
									}
								}
							}
						} catch (error) {
							console.error('Error removing task from project store:', error);
						}
						return;
					}

					if (agentMessages.step === "end") {
						// compute task time
						const currentTaskData = task;
						console.log('currentTaskData?.snapshotsTemp', currentTaskData?.snapshotsTemp)
						Promise.all((currentTaskData?.snapshotsTemp || []).map((snapshot: any) =>
							proxyFetchPost(`/api/chat/snapshots`, { ...snapshot })
						));

						// Async file upload
						let res = await window.ipcRenderer.invoke(
							"get-file-list",
							email,
							currentTaskId,
							(project_id || projectStore.activeProjectId) as string
						);
						if (!type && import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && res.length > 0) {
							// Upload files sequentially to avoid overwhelming the server
							const uploadResults = await Promise.allSettled(
								res.filter((file: any) => !file.isFolder).map(async (file: any) => {
									try {
										// Read file content using Electron API
										const result = await window.ipcRenderer.invoke('read-file', file.path);
										if (result.success && result.data) {
											// Create FormData for file upload
											const formData = new FormData();
											const blob = new Blob([result.data], { type: 'application/octet-stream' });
											formData.append('file', blob, file.name);
											//TODO(file): rename endpoint to use project_id
											formData.append('task_id', (project_id || projectStore.activeProjectId) as string);

											// Upload file
											await uploadFile('/api/chat/files/upload', formData);
											console.log('File uploaded successfully:', file.name);
											return { success: true, fileName: file.name };
										} else {
											console.error('Failed to read file:', result.error);
											return { success: false, fileName: file.name, error: result.error };
										}
									} catch (error) {
										console.error('File upload failed:', error);
										return { success: false, fileName: file.name, error };
									}
								})
							);

							// Count successful uploads
							const successCount = uploadResults.filter(
								result => result.status === 'fulfilled' && result.value.success
							).length;

							// Log failures
							const failures = uploadResults.filter(
								result => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.success)
							);
							if (failures.length > 0) {
								console.error('Failed to upload files:', failures);
							}

							// add remote file count for successful uploads only
							if (successCount > 0) {
								proxyFetchPost(`/api/user/stat`, {
									"action": "file_generate_count",
									"value": successCount
								})
							}
						}





						if (!type && historyId) {
							const obj = {
								"project_name": currentTaskData?.summaryTask.split('|')[0],
								"summary": currentTaskData?.summaryTask.split('|')[1],
								"status": 2,
								"tokens": getTokens()
							}
							proxyFetchPut(`/api/chat/history/${historyId}`, obj)
						}
						uploadLog(currentTaskId, type)


						let taskRunning = [...(currentTaskData?.taskRunning || [])];
						let taskAssigning = [...(currentTaskData?.taskAssigning || [])];
						taskAssigning = taskAssigning.map((agent) => {
							agent.tasks = agent.tasks.map((t: TaskInfo) => {
								if (t.status !== "completed" && t.status !== "failed" && !type) {
									t.status = "skipped"
								}
								return t
							})
							return agent
						})

						taskRunning = taskRunning.map((t) => {
							console.log('t.status', t.status)
							if (t.status !== "completed" && t.status !== "failed" && !type) {
								t.status = "skipped"
							}
							return t
						})
						setTaskAssigning([...taskAssigning]);
						setTaskRunning([...taskRunning]);

						if (!currentTaskId || !currentTaskData) return;

						let taskTime = currentTaskData.taskTime;
						let elapsed = currentTaskData.elapsed;
						// if task is running, compute current time
						if (taskTime !== 0) {
							const currentTime = Date.now()
							elapsed += currentTime - taskTime
						}

						setTaskTime(0);
						setElapsed(elapsed);
						const fileList = (currentTaskData?.taskAssigning || []).map((agent: Agent) => {
							return agent.tasks.map((t: TaskInfo) => {
								return t.fileList || []
							}).flat()
						}).flat()
						let endMessage = agentMessages.data as string
						let summary = endMessage.match(/<summary>(.*?)<\/summary>/)?.[1]
						let newMessage: Message | null = null
						const agent_summary_end = currentTaskData?.messages.findLast((message: Message) => message.step === 'agent_summary_end')
						console.log('summary', summary)
						if (summary) {
							endMessage = summary
						}
						else if (agent_summary_end) {
							console.log('agent_summary_end', agent_summary_end)
							endMessage = agent_summary_end.summary || ""
						}

						console.log('endMessage', endMessage)
						newMessage = {
							id: generateUniqueId(),
							role: "agent",
							content: endMessage || "",
							step: agentMessages.step,
							isConfirm: false,
							fileList: fileList,
						};


						addMessages(newMessage);

						setIsPending(false);
						setStatus('finished');
						// completed tasks move to history
						setUpdateCount();

						console.log(currentTaskData, 'end');


						return;
					}
					if (agentMessages.step === "notice") {
						if (agentMessages.data.process_task_id !== '') {
							let taskAssigning = [...(task?.taskAssigning || [])]

							const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((t: TaskInfo) => t.id === agentMessages.data.process_task_id));
							const foundTask = taskAssigning[assigneeAgentIndex]?.tasks.find((t: TaskInfo) => t.id === agentMessages.data.process_task_id);
							const toolkit = {
								toolkitId: generateUniqueId(),
								toolkitName: 'notice',
								toolkitMethods: '',
								message: agentMessages.data.notice as string,
								toolkitStatus: "running" as AgentStatus,
							}
							if (assigneeAgentIndex !== -1 && foundTask) {
								foundTask.toolkits ??= []
								foundTask.toolkits.push({ ...toolkit });
							}
							setTaskAssigning([...taskAssigning]);
						} else {
							const messages = [...(task?.messages || [])]
							const noticeCardIndex = messages.findLastIndex((message) => message.step === 'notice_card')
							if (noticeCardIndex === -1) {
								const newMessage: Message = {
									id: generateUniqueId(),
									role: "agent",
									content: "",
									step: 'notice_card',
								};
								addMessages(newMessage)
							}
							setCotList([...(task?.cotList || []), agentMessages.data.notice as string])
						}
						return

					}
					if (["sync"].includes(agentMessages.step)) return
					if (agentMessages.step === "ask") {
						if (task?.activeAsk != '') {
							const newMessage: Message = {
								id: generateUniqueId(),
								role: "agent",
								agent_name: agentMessages.data.agent || '',
								content:
									agentMessages.data?.content ||
									agentMessages.data?.notice ||
									agentMessages.data?.answer ||
									agentMessages.data?.question ||
									agentMessages.data as string ||
									"",
								step: agentMessages.step,
								isConfirm: false,
							};
							let activeAskList = task?.askList || []
							setActiveAskList([...activeAskList, newMessage]);
							return
						}
						setActiveAsk(agentMessages.data.agent || '')
						setIsPending(false)
					}
					const newMessage: Message = {
						id: generateUniqueId(),
						role: "agent",
						content:
							agentMessages.data?.content ||
							agentMessages.data?.notice ||
							agentMessages.data?.answer ||
							agentMessages.data?.question ||
							agentMessages.data as string ||
							"",
						step: agentMessages.step,
						isConfirm: false,
					};
					addMessages(newMessage);
				},
				async onopen(respond) {
					console.log("open", respond);
					const { setAttaches } = get()
					setAttaches([])
					return;
				},

				onerror(err) {
					console.error("[fetchEventSource] Error:", err);

					// Allow automatic retry for connection errors
					// TypeError usually means network/connection issues
					if (err instanceof TypeError ||
						err?.message?.includes('Failed to fetch') ||
						err?.message?.includes('ECONNREFUSED') ||
						err?.message?.includes('NetworkError')) {
						console.warn('[fetchEventSource] Connection error detected, will retry automatically...');
						// Don't throw - let fetchEventSource auto-retry
						return;
					}

					// For other errors, log and throw to stop retrying
					console.error('[fetchEventSource] Fatal error, stopping connection:', err);

					// Clean up AbortController on error with robust error handling
					try {
						if (activeSSEControllers[newTaskId]) {
							delete activeSSEControllers[newTaskId];
							console.log(`Cleaned up SSE controller for task ${newTaskId} after error`);
						}
					} catch (cleanupError) {
						console.warn('Error cleaning up AbortController on SSE error:', cleanupError);
					}
					throw err;
				},

				// Server closes connection
				onclose() {
					console.log("SSE connection closed");
					// Clean up AbortController when connection closes with robust error handling
					try {
						if (activeSSEControllers[newTaskId]) {
							delete activeSSEControllers[newTaskId];
							console.log(`Cleaned up SSE controller for task ${newTaskId} after connection close`);
						}
					} catch (cleanupError) {
						console.warn('Error cleaning up AbortController on SSE close:', cleanupError);
					}
				},
			});

		},

		replay: async (question: string, time: number) => {
			const { create, setHasMessages, addMessages, startTask, handleConfirmTask } = get();
			//get project id
			const project_id = useProjectStore.getState().activeProjectId
			if (!project_id) {
				console.error("Can't replay task because no project id provided")
				return;
			}

			create(undefined, "replay");
			setHasMessages(true);
			addMessages({
				id: generateUniqueId(),
				role: "user",
				content: question.split("|")[0],
			});

			await startTask("replay", undefined, time);
			handleConfirmTask(project_id, "replay");
		},
		setUpdateCount() {
			set((state) => ({
				updateCount: state.updateCount + 1
			}))
		},
		addMessages(message) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						messages: [
							...state.task.messages,
							message,
						],
					},
				};
			})
		},
		setAttaches(attaches) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						attaches: [...attaches],
					},
				};
			})
		},
		setMessages(messages) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						messages: [
							...messages,
						],
					},
				};
			})
		},
		removeMessage(messageId) {
			set((state) => {
				if (!state.task) {
					return state;
				}
				return {
					task: {
						...state.task,
						messages: state.task.messages.filter(
							(message) => message.id !== messageId
						),
					},
				};
			})
		},
		setCotList(cotList) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						cotList: [...cotList],
					},
				};
			})
		},

		setSummaryTask(summaryTask) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						summaryTask,
					},
				};
			})
		},
		setIsTakeControl(isTakeControl) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						isTakeControl,
					},
				};
			})
		},
		setHasWaitComfirm(hasWaitComfirm) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						hasWaitComfirm,
					},
				};
			})
		},
		setTaskInfo(taskInfo) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						taskInfo: [...taskInfo],
					},
				};
			})
		},
		setTaskRunning(taskRunning) {
			const { computedProgressValue } = get()
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						taskRunning: [...taskRunning],
					},
				};
			})
			computedProgressValue()
		},
		addWebViewUrl(webViewUrl: string, processTaskId: string) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						webViewUrls: [...state.task.webViewUrls, { url: webViewUrl, processTaskId: processTaskId }],
					},
				};
			})
		},
		setWebViewUrls(webViewUrls: { url: string, processTaskId: string }[]) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						webViewUrls: [...webViewUrls],
					},
				};
			})
		},
		setActiveAskList(askList: Message[]) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						askList: [...askList],
					},
				};
			})
		},
		setTaskAssigning(taskAssigning: Agent[]) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						taskAssigning: [...taskAssigning],
					},
				};
			})
		},
		setStatus(status: 'running' | 'finished' | 'pending' | 'pause') {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						status
					},
				};
			})
		},
		handleConfirmTask: async (project_id: string, type?: string) => {
			const { task, taskId, setMessages, setActiveWorkSpace, setStatus, setTaskTime, setTaskInfo, setTaskRunning, setIsTaskEdit } = get();
			if (!task || !taskId) return;

			// Stop any pending auto-confirm timers for this task (manual confirmation)
			try {
				if (autoConfirmTimers[taskId]) {
					clearTimeout(autoConfirmTimers[taskId]);
					delete autoConfirmTimers[taskId];
				}
			} catch (error) {
				console.warn('Error clearing auto-confirm timer in handleConfirmTask:', error);
			}

			// record task start time
			setTaskTime(Date.now());
			const filteredTaskInfo = task.taskInfo.filter((t: TaskInfo) => t.content !== '')
			setTaskInfo(filteredTaskInfo)
			// Also update taskRunning with the filtered tasks to keep counts consistent
			const filteredTaskRunning = task.taskRunning.filter((t: TaskInfo) => t.content !== '')
			setTaskRunning(filteredTaskRunning)
			if (!type) {
				await fetchPut(`/task/${project_id}`, {
					task: filteredTaskInfo,
				});
				await fetchPost(`/task/${project_id}/start`, {});

				setActiveWorkSpace('workflow')
				setStatus('running')
			}
			let messages = [...task.messages]
			const cardTaskIndex = messages.findLastIndex((message) => message.step === 'to_sub_tasks')
			if (cardTaskIndex !== -1) {
				messages[cardTaskIndex] = {
					...messages[cardTaskIndex],
					isConfirm: true,
					taskType: 2,
				}
				setMessages(messages)
			}

			// Reset editing state after manual confirmation so next round can auto-start
			setIsTaskEdit(false);
		},
		addTaskInfo() {
			const { task, setTaskInfo } = get()
			if (!task) return
			let targetTaskInfo = [...task.taskInfo]
			const newTaskInfo = {
				id: "",
				content: "",
			};
			targetTaskInfo.push(newTaskInfo)
			setTaskInfo(targetTaskInfo)
		},
		addTerminal(processTaskId: string, terminal: any) {
			if (!processTaskId) return
			const { task, setTaskAssigning } = get()
			if (!task) return
			const taskAssigning = [...task.taskAssigning]
			const taskAssigningIndex = taskAssigning.findIndex((agent) => agent.tasks.find((t) => t.id === processTaskId))
			if (taskAssigningIndex !== -1) {
				const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((t) => t.id === processTaskId)
				taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal ??= []
				taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal?.push(terminal)
				console.log(taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal)
				setTaskAssigning(taskAssigning)
			}
		},
		setActiveAsk(agentName: string) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						activeAsk: agentName,
					},
				};
			})
		},
		setProgressValue(progressValue: number) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						progressValue
					},
				};
			})
		},
		setIsPending(isPending: boolean) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						isPending
					},
				};
			})
		},
		setActiveWorkSpace(activeWorkSpace: string) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						activeWorkSpace
					},
				};
			})
		},
		setActiveAgent(agent_id: string) {
			set((state) => {
				if (!state.task) return state;
				if (state.task.activeAgent === agent_id) {
					return state;
				}
				return {
					task: {
						...state.task,
						activeAgent: agent_id
					},
				};
			})
		},
		setHasMessages(hasMessages: boolean) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						hasMessages
					},
				};
			})
		},
		setHasAddWorker(hasAddWorker: boolean) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						hasAddWorker
					},
				};
			})
		},
		addFileList(processTaskId: string, fileInfo: FileInfo) {
			const { task, setTaskAssigning } = get()
			if (!task) return
			const taskAssigning = [...task.taskAssigning]
			let agentId = ''
			const taskAssigningIndex = taskAssigning.findIndex((agent: Agent) => {
				const hasAgentTask = agent.tasks.find((t: any) => t.id === processTaskId)
				if (hasAgentTask) {
					agentId = agent.agent_id
				}
				return hasAgentTask
			})
			if (taskAssigningIndex !== -1) {
				const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((t: any) => t.id === processTaskId)
				if (taskIndex !== -1) {
					taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList ??= []
					taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList?.push({ ...fileInfo, agent_id: agentId, task_id: processTaskId })
					setTaskAssigning(taskAssigning)
				}
			}
		},
		setFileList(processTaskId: string, fileList: FileInfo[]) {
			const { task, setTaskAssigning } = get()
			if (!task) return
			const taskAssigning = [...task.taskAssigning]

			const taskAssigningIndex = taskAssigning.findIndex((agent) => agent.tasks.find((t) => t.id === processTaskId))
			if (taskAssigningIndex === -1) return
			const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((t) => t.id === processTaskId)
			if (taskIndex !== -1) {
				taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList = [...fileList]
				setTaskAssigning(taskAssigning)
			}
		},
		updateTaskInfo(index: number, content: string) {
			const { task, setTaskInfo } = get()
			if (!task) return
			let targetTaskInfo = [...task.taskInfo]
			if (targetTaskInfo) {
				targetTaskInfo[index].content = content
			}
			setTaskInfo(targetTaskInfo)
		},
		deleteTaskInfo(index: number) {
			const { task, setTaskInfo } = get()
			if (!task) return
			let targetTaskInfo = [...task.taskInfo]

			if (targetTaskInfo) {
				targetTaskInfo.splice(index, 1)
			}
			setTaskInfo(targetTaskInfo)

		},
		getLastUserMessage() {
			const { task } = get();
			if (!task) return null
			return task.messages.findLast((message: Message) => message.role === 'user') || null
		},
		setTaskTime(taskTime: number) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						taskTime
					},
				};
			})
		},
		setNuwFileNum(nuwFileNum: number) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						nuwFileNum
					},
				};
			})
		},
		setType(type: string) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						type
					},
				};
			})
		},
		setDelayTime(delayTime: number) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						delayTime
					},
				};
			})
		},
		setElapsed(elapsed: number) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						elapsed
					},
				};
			})
		},
		getFormattedTaskTime() {
			const { task } = get();
			if (!task) return "N/A";

			let taskTime = task.taskTime;
			let elapsed = task.elapsed;
			let time = 0
			// if task is running, compute current time
			if (taskTime !== 0) {
				const currentTime = Date.now()
				time = currentTime - taskTime + elapsed;
			} else {
				time = elapsed;
			}
			const hours = Math.floor(time / 3600000);
			const minutes = Math.floor((time % 3600000) / 60000);
			const seconds = Math.floor((time % 60000) / 1000);
			return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		},
		addTokens(tokens: number) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						tokens: state.task.tokens + tokens
					},
				};
			})
		},
		getTokens() {
			const { task } = get();
			return task?.tokens ?? 0;
		},
		setSelectedFile(selectedFile: FileInfo | null) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						selectedFile: selectedFile,
					},
				};
			})
		},
		setSnapshots(snapshots: any[]) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						snapshots,
					},
				};
			})
		},
		setSnapshotsTemp(snapshot: any) {
			set((state) => {
				if (!state.task) return state;
				const oldList = state.task.snapshotsTemp || [];
				if (oldList.find((item: any) => item.browser_url === snapshot.browser_url)) {
					return state;
				}
				return {
					task: {
						...state.task,
						snapshotsTemp: [...state.task.snapshotsTemp, snapshot],
					},
				};
			})
		},
		setIsTaskEdit(isTaskEdit: boolean) {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						isTaskEdit
					},
				};
			})
		},
		clearTask: () => {
			const { taskId, create } = get()
			console.log('clearTask')

			// Clean up pending auto-confirm timer for current task
			try {
				if (taskId && autoConfirmTimers[taskId]) {
					clearTimeout(autoConfirmTimers[taskId]);
					delete autoConfirmTimers[taskId];
				}
			} catch (error) {
				console.warn('Error clearing auto-confirm timer in clearTask:', error);
			}

			// Clean up active SSE connection for current task
			try {
				if (taskId && activeSSEControllers[taskId]) {
					activeSSEControllers[taskId].abort();
					delete activeSSEControllers[taskId];
				}
			} catch (error) {
				console.warn('Error aborting SSE connection in clearTask:', error);
			}

			window.ipcRenderer.invoke('restart-backend')
				.then((res) => {
					console.log('restart-backend', res)
				})
				.catch((error) => {
					console.error('Error in clearTask cleanup:', error)
				})

			// Create new task to maintain UI responsiveness
			create()
		},
		setIsContextExceeded: (isContextExceeded: boolean) => {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						isContextExceeded: isContextExceeded,
					},
				};
			})
		},
		setNextTaskId: (nextTaskId: string | null) => {
			set(() => ({
				nextTaskId: nextTaskId,
			}))
		},
		setStreamingDecomposeText: (text: string) => {
			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						streamingDecomposeText: text,
					},
				};
			});
		},
		clearStreamingDecomposeText: () => {
			const { taskId } = get();
			// Clear buffer and any pending timer
			if (taskId) {
				delete streamingDecomposeTextBuffer[taskId];
				if (streamingDecomposeTextTimers[taskId]) {
					clearTimeout(streamingDecomposeTextTimers[taskId]);
					delete streamingDecomposeTextTimers[taskId];
				}
			}

			set((state) => {
				if (!state.task) return state;
				return {
					task: {
						...state.task,
						streamingDecomposeText: '',
					},
				};
			});
		}
	})
);

const filterMessage = (message: AgentMessage) => {
	if (message.data.toolkit_name?.includes('Search ')) {
		message.data.toolkit_name = 'Search Toolkit'
	}
	if (message.data.method_name?.includes('search')) {
		message.data.method_name = 'search'
	}

	message.data.message = normalizeToolkitMessage(message.data.message);

	if (message.data.toolkit_name === 'Note Taking Toolkit') {
		message.data.message = message.data.message.replace(/content='/g, '').replace(/', update=False/g, '').replace(/', update=True/g, '')
	}
	if (message.data.method_name === 'scrape') {
		message.data.message = message.data.message.replace(/url='/g, '').slice(0, -1)
	}
	return message
}



export const useChatStore = chatStore;

export const getToolStore = () => chatStore().getState();
