import { fetchPost, fetchPut, getBaseURL, proxyFetchPost, proxyFetchPut, proxyFetchGet, uploadFile, fetchDelete } from '@/api/http';
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
}

export interface ChatStore {
	updateCount: number;
	activeTaskId: string | null;
	nextTaskId: string | null;
	tasks: { [key: string]: Task };
	create: (id?: string, type?: any) => string;
	removeTask: (taskId: string) => void;
	setStatus: (taskId: string, status: 'running' | 'finished' | 'pending' | 'pause') => void;
	setActiveTaskId: (taskId: string) => void;
	replay: (taskId: string, question: string, time: number) => Promise<void>;
	startTask: (taskId: string, type?: string, shareToken?: string, delayTime?: number, messageContent?: string, messageAttaches?: File[]) => Promise<void>;
	handleConfirmTask: (project_id:string, taskId: string, type?: string) => void;
	addMessages: (taskId: string, messages: Message) => void;
	setMessages: (taskId: string, messages: Message[]) => void;
	removeMessage: (taskId: string, messageId: string) => void;
	setAttaches: (taskId: string, attaches: File[]) => void;
	setSummaryTask: (taskId: string, summaryTask: string) => void;
	setHasWaitComfirm: (taskId: string, hasWaitComfirm: boolean) => void;
	setTaskAssigning: (taskId: string, taskAssigning: Agent[]) => void;
	setTaskInfo: (taskId: string, taskInfo: TaskInfo[]) => void;
	setTaskRunning: (taskId: string, taskRunning: TaskInfo[]) => void;
	setActiveAsk: (taskId: string, agentName: string) => void;
	setActiveAskList: (taskId: string, message: Message[]) => void;
	addWebViewUrl: (taskId: string, webViewUrl: string, processTaskId: string) => void;
	setWebViewUrls: (taskId: string, webViewUrls: { url: string, processTaskId: string }[]) => void;
	setProgressValue: (taskId: string, progressValue: number) => void;
	computedProgressValue: (taskId: string) => void;
	setIsPending: (taskId: string, isPending: boolean) => void;
	addTerminal: (taskId: string, processTaskId: string, terminal: string) => void;
	addFileList: (taskId: string, processTaskId: string, fileInfo: FileInfo) => void;
	setFileList: (taskId: string, processTaskId: string, fileList: FileInfo[]) => void;
	setActiveWorkSpace: (taskId: string, activeWorkSpace: string) => void;
	setActiveAgent: (taskId: string, agentName: string) => void;
	setHasMessages: (taskId: string, hasMessages: boolean) => void;
	getLastUserMessage: () => Message | null;
	addTaskInfo: () => void;
	updateTaskInfo: (index: number, content: string) => void;
	deleteTaskInfo: (index: number) => void;
	setTaskTime: (taskId: string, taskTime: number) => void;
	setElapsed: (taskId: string, taskTime: number) => void;
	getFormattedTaskTime: (taskId: string) => string;
	addTokens: (taskId: string, tokens: number) => void;
	getTokens: (taskId: string) => void;
	setUpdateCount: () => void;
	setCotList: (taskId: string, cotList: string[]) => void;
	setHasAddWorker: (taskId: string, hasAddWorker: boolean) => void;
	setNuwFileNum: (taskId: string, nuwFileNum: number) => void;
	setDelayTime: (taskId: string, delayTime: number) => void;
	setType: (taskId: string, type: string) => void;
	setSelectedFile: (taskId: string, selectedFile: FileInfo | null) => void;
	setSnapshots: (taskId: string, snapshots: any[]) => void,
	setIsTakeControl: (taskId: string, isTakeControl: boolean) => void,
	setSnapshotsTemp: (taskId: string, snapshot: any) => void,
	setIsTaskEdit: (taskId: string, isTaskEdit: boolean) => void,
	clearTasks: () => void,
	setIsContextExceeded: (taskId: string, isContextExceeded: boolean) => void;
	setNextTaskId: (taskId: string | null) => void;
}




const chatStore = (initial?: Partial<ChatStore>) => createStore<ChatStore>()(
	(set, get) => ({
		activeTaskId: null,
		nextTaskId: null,
		tasks: initial?.tasks ?? {},
		updateCount: 0,
		create(id?: string, type?: any) {
			const taskId = id ? id : generateUniqueId();
			console.log("Create Task", taskId)
			set((state) => ({
				activeTaskId: taskId,
				tasks: {
					...state.tasks,
					[taskId]: {
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
					},
				}
			}))
			return taskId
		},
		computedProgressValue(taskId: string) {
			const { tasks, setProgressValue, activeTaskId } = get()
			const taskRunning = [...tasks[taskId].taskRunning]
			const finshedTask = taskRunning?.filter(
				(task) => task.status === "completed" || task.status === "failed"
			).length;
			const taskProgress = (
				((finshedTask || 0) / (taskRunning?.length || 0)) *
				100
			).toFixed(2);
			setProgressValue(
				activeTaskId as string,
				Number(taskProgress)
			);
		},
		removeTask(taskId: string) {
			set((state) => {
				delete state.tasks[taskId];
				return ({
					tasks: {
						...state.tasks,
					},
				})
			})
		},
		startTask: async (taskId: string, type?: string, shareToken?: string, delayTime?: number, messageContent?: string, messageAttaches?: File[]) => {
			const { token, language, modelType, cloud_model_type, email } = getAuthStore()
			const workerList = useWorkerList();
			const { getLastUserMessage, setDelayTime, setType } = get();
			const baseURL = await getBaseURL();
			let systemLanguage = language
			if (language === 'system') {
				systemLanguage = await window.ipcRenderer.invoke('get-system-language');
			}
			if (type === 'replay') {
				setDelayTime(taskId, delayTime as number)
				setType(taskId, type)
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
			if(project_id && type !== "replay") {
				console.log("Creating a new Chat Instance for current project on end")
				const newChatResult = projectStore.appendInitChatStore(project_id);

				if (newChatResult) {
					newTaskId = newChatResult.taskId;
					targetChatStore = newChatResult.chatStore;
					targetChatStore.getState().setIsPending(newTaskId, true);
					
					//From handleSend if message is given
					// Add the message to the new chatStore if provided
					if (messageContent) {
						targetChatStore.getState().addMessages(newTaskId, {
							id: generateUniqueId(),
							role: "user",
							content: messageContent,
							attaches: messageAttaches || [],
						});
						targetChatStore.getState().setHasMessages(newTaskId, true);
					}
				}
			}

			const base_Url = import.meta.env.DEV ? import.meta.env.VITE_PROXY_URL : import.meta.env.VITE_BASE_URL
			const api = type == 'share' ? 
			`${base_Url}/api/chat/share/playback/${shareToken}?delay_time=${delayTime}` 
			: type == 'replay' ? 
				`${base_Url}/api/chat/steps/playback/${project_id}?delay_time=${delayTime}` 
				: `${baseURL}/chat`

			const { tasks } = get()
			let historyId: string | null = projectStore.getHistoryId(project_id);
			let snapshots: any = [];
			let skipFirstConfirm = true;

			// replay or share request
			if (type) {
				await proxyFetchGet(`/api/chat/snapshots`, {
					api_task_id: taskId
				}).then(res => {
					if (res) {
						snapshots = [...new Map(res.map((item: any) => [item.camel_task_id, item])).values()];
					}
				})
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
			if (!type && !historyId) {
				const authStore = getAuthStore();

				const obj = {
					/**
					 * TODO(history): Currently reusing project_id as the source
					 * of truth per project. Need to update field
					 * name after backend update.
					 */
					"task_id": project_id,
					"user_id": authStore.user_id,
					"question": messageContent || (targetChatStore.getState().tasks[newTaskId]?.messages[0]?.content ?? ''),
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
					if(project_id && historyId) projectStore.setHistoryId(project_id, historyId);
				})
			}
			const browser_port = await window.ipcRenderer.invoke('get-browser-port');
			
			// Lock the chatStore reference at the start of SSE session to prevent focus changes
			// during active message processing
			let lockedChatStore = targetChatStore;
			let lockedTaskId = newTaskId;
			
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
					installed_mcp: mcpLocal,
					language: systemLanguage,
					allow_local_system: true,
					attaches: (messageAttaches || targetChatStore.getState().tasks[newTaskId]?.attaches || []).map(f => f.filePath),
					bun_mirror: systemLanguage === 'zh-cn' ? 'https://registry.npmmirror.com' : '',
					uvx_mirror: systemLanguage === 'zh-cn' ? 'http://mirrors.aliyun.com/pypi/simple/' : '',
					summary_prompt: ``,
					new_agents: [...addWorkers],
					browser_port: browser_port,
					env_path: envPath
				}) : undefined,

				async onmessage(event: any) {
					const agentMessages: AgentMessage = JSON.parse(event.data);
					console.log("agentMessages", agentMessages);
					const agentNameMap = {
						developer_agent: "Developer Agent",
						search_agent: "Search Agent",
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
					if(agentMessages.step === "confirmed") {
						const { question } = agentMessages.data;
						const shouldCreateNewChat = project_id && (question || messageContent);
						
						//All except first confirmed event to reuse the existing chatStore
						if(shouldCreateNewChat && !skipFirstConfirm) {
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
										newChatStore.getState().setIsPending(newTaskId, false);
										
										if(type === "replay") {
												newChatStore.getState().setDelayTime(newTaskId, delayTime as number);
												newChatStore.getState().setType(newTaskId, "replay");
										}

										const lastMessage = previousChatStore.tasks[currentTaskId]?.messages.at(-1);
										if(lastMessage?.role === "user" && lastMessage?.id) {
											previousChatStore.removeMessage(currentTaskId, lastMessage.id);
										}
										
										//Trick: by the time the question is retrieved from event, 
										//the last message from previous chatStore is at display
										newChatStore.getState().addMessages(newTaskId, {
												id: generateUniqueId(),
												role: "user",
												content: question || messageContent as string,
												//TODO: The attaches that reach here (when Improve API is called) doesn't reach the backend
												attaches: [...(previousChatStore.tasks[currentTaskId]?.attaches, messageAttaches) || []],
										});
										console.log("[NEW CHATSTORE] Created for ", project_id);

										//Handle Original cases - with new chatStore
										newChatStore.getState().setHasWaitComfirm(currentTaskId, false);
										newChatStore.getState().setStatus(currentTaskId, 'pending');
								}
						} else {
							//NOTE: Triggered only with first "confirmed" in the project
							//Handle Original cases - with old chatStore
							previousChatStore.setStatus(currentTaskId, 'pending');
							previousChatStore.setHasWaitComfirm(currentTaskId, false);
						}

						//Enable it for the rest of current SSE session
						skipFirstConfirm = false;
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
						tasks,
						create,
						setTaskTime,
						setElapsed,
						setActiveTaskId,
						setIsContextExceeded} = getCurrentChatStore()

					currentTaskId = getCurrentTaskId();
					// if (tasks[currentTaskId].status === 'finished') return
					if (agentMessages.step === "to_sub_tasks") {
						// Check if this is a multi-turn scenario after task completion
						const isMultiTurnAfterCompletion = tasks[currentTaskId].status === 'finished';

						// Reset status for multi-turn complex tasks to allow splitting panel to show
						if (isMultiTurnAfterCompletion) {
							setStatus(currentTaskId, 'pending');
						}

						const messages = [...tasks[currentTaskId].messages]
						const toSubTaskIndex = messages.findLastIndex((message: Message) => message.step === 'to_sub_tasks')
						// For multi-turn scenarios, always create a new to_sub_tasks message
						// even if one already exists from a previous task
						if (toSubTaskIndex === -1 || isMultiTurnAfterCompletion) {
							// 30 seconds auto confirm
							setTimeout(() => {
								const currentStore = getCurrentChatStore();
								const currentId = getCurrentTaskId();
								const { tasks, handleConfirmTask, setIsTaskEdit } = currentStore;
								const message = tasks[currentId].messages.findLast((item) => item.step === "to_sub_tasks");
								const isConfirm = message?.isConfirm || false;
								const isTakeControl =
									tasks[currentId].isTakeControl;

								if (project_id && !isConfirm && !isTakeControl && !tasks[currentId].isTaskEdit) {
									handleConfirmTask(project_id, currentId, type);
								}
								setIsTaskEdit(currentId, false);
							}, 30000);

							const newNoticeMessage: Message = {
								id: generateUniqueId(),
								role: "agent",
								content: "",
								step: 'notice_card',
							};
							addMessages(currentTaskId, newNoticeMessage)
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
							addMessages(currentTaskId, newMessage)
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
								"tokens": getTokens(currentTaskId)
							}
							proxyFetchPut(`/api/chat/history/${historyId}`, obj)
						}
						setSummaryTask(currentTaskId, agentMessages.data.summary_task as string)
						setTaskInfo(currentTaskId, agentMessages.data.sub_tasks as TaskInfo[])
						setTaskRunning(currentTaskId, agentMessages.data.sub_tasks as TaskInfo[])
						return;
					}
					// Create agent
					if (agentMessages.step === "create_agent") {
						const { agent_name, agent_id } = agentMessages.data;
						if (!agent_name || !agent_id) return;

						// Add agent to taskAssigning
						if (!['mcp_agent', 'new_worker_agent', 'task_agent', 'task_summary_agent', "coordinator_agent", "question_confirm_agent"].includes(agent_name)) {
							// if (agentNameMap[agent_name as keyof typeof agentNameMap]) {
							const hasAgent = tasks[currentTaskId].taskAssigning.find((agent) => agent.agent_id === agent_id)

							if (!hasAgent) {
								let activeWebviewIds: any = [];
								if (agent_name == 'search_agent') {
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
								setTaskAssigning(currentTaskId, [...tasks[currentTaskId].taskAssigning, {
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
						const {content, question} = agentMessages.data;
						setHasWaitComfirm(currentTaskId, true)
						setIsPending(currentTaskId, false)

						const currentChatStore = getCurrentChatStore();
						//Make sure to add user Message on replay and avoid duplication of first msg						
						if(type === "replay" && question && 
							!(currentChatStore.tasks[currentTaskId].messages.length === 1)) {
							addMessages(currentTaskId, {
								id: generateUniqueId(),
								role: "user",
								content: question as string,
								step: "wait_confirm",
								isConfirm: false,
							})
						}
						addMessages(currentTaskId, {
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

						let taskRunning = [...tasks[currentTaskId].taskRunning]
						let taskAssigning = [...tasks[currentTaskId].taskAssigning]
						const targetTaskIndex = taskRunning.findIndex((task) => task.id === task_id)
						const targetTaskAssigningIndex = taskAssigning.findIndex((agent) => agent.tasks.find((task: TaskInfo) => task.id === task_id && !task.reAssignTo))
						if (targetTaskAssigningIndex !== -1) {
							const taskIndex = taskAssigning[targetTaskAssigningIndex].tasks.findIndex((task: TaskInfo) => task.id === task_id)
							taskAssigning[targetTaskAssigningIndex].tasks[taskIndex].status = state === "DONE" ? "completed" : "failed";
							taskAssigning[targetTaskAssigningIndex].tasks[taskIndex].failure_count = failure_count || 0

							// destroy webview
							tasks[currentTaskId].taskAssigning = tasks[currentTaskId].taskAssigning.map((item) => {
								if (item.type === "search_agent" && item.activeWebviewIds?.length && item.activeWebviewIds?.length > 0) {
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
								return item
							})


							if (result && result !== '') {
								let targetResult = result.replace(taskAssigning[targetTaskAssigningIndex].agent_id, taskAssigning[targetTaskAssigningIndex].name)
								taskAssigning[targetTaskAssigningIndex].tasks[taskIndex].report = targetResult
								if (state === "FAILED" && failure_count && failure_count >= 3) {
									addMessages(currentTaskId, {
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
						setTaskRunning(currentTaskId, taskRunning)
						setTaskAssigning(currentTaskId, taskAssigning)
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
						let taskAssigning = [...tasks[currentTaskId].taskAssigning]
						let taskRunning = [...tasks[currentTaskId].taskRunning]
						if (agentMessages.data.tokens) {
							addTokens(currentTaskId, agentMessages.data.tokens)
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
							const taskIndex = taskRunning.findIndex((task) => task.id === process_task_id);
							if (taskIndex !== -1 && taskRunning![taskIndex].status) {
								taskRunning![taskIndex].agent!.status = "running";
								taskRunning![taskIndex]!.status = "running";

								const task = taskAssigning[agentIndex].tasks.find((task: TaskInfo) => task.id === process_task_id);
								if (task) {
									task.status = "running";
								}
							}
							setTaskRunning(currentTaskId, [...taskRunning]);
							setTaskAssigning(currentTaskId, [...taskAssigning]);
						}
						if (agentMessages.step === "deactivate_agent") {
							if (message) {
								const index = taskAssigning[agentIndex].log.findLastIndex((log) => log.data.method_name === agentMessages.data.method_name && log.data.toolkit_name === agentMessages.data.toolkit_name)
								if (index != -1) {
									taskAssigning[agentIndex].log[index].status = "completed";
									setTaskAssigning(currentTaskId, [...taskAssigning]);
								}

							}
							// const taskIndex = taskRunning.findIndex((task) => task.id === process_task_id);
							// if (taskIndex !== -1) {
							// 	taskRunning![taskIndex].agent!.status = "completed";
							// 	taskRunning![taskIndex]!.status = "completed";
							// }


							if (!type && historyId) {
								const obj = {
									"project_name": tasks[currentTaskId].summaryTask.split('|')[0],
									"summary": tasks[currentTaskId].summaryTask.split('|')[1],
									"status": 1,
									"tokens": getTokens(currentTaskId)
								}
								proxyFetchPut(`/api/chat/history/${historyId}`, obj)
							}


							setTaskRunning(currentTaskId, [...taskRunning]);
							setTaskAssigning(currentTaskId, [...taskAssigning]);



						}
						return;
					}
					// Assign task
					if (agentMessages.step === "assign_task") {
						if (!agentMessages.data?.assignee_id || !agentMessages.data?.task_id) return;

						const { assignee_id, task_id, content = "", state: taskState, failure_count } = agentMessages.data as any;
						let taskAssigning = [...tasks[currentTaskId].taskAssigning]
						let taskRunning = [...tasks[currentTaskId].taskRunning]
						let taskInfo = [...tasks[currentTaskId].taskInfo]

						// Find the index of the agent corresponding to assignee_id
						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.agent_id === assignee_id);
						// Find task corresponding to task_id
						const task = taskInfo!.find((task: TaskInfo) => task.id === task_id);

						const taskRunningIndex = taskRunning!.findIndex((task: TaskInfo) => task.id === task_id);

						// Skip tasks with empty content only if the task doesn't exist in taskInfo
						// If task exists in taskInfo, we should still process status updates
						if ((!content || content.trim() === "") && !task) {
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
							taskAssigning[agentIndex].tasks[taskIndex].reAssignTo = agentName
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
								taskAssigning[assigneeAgentIndex].tasks.push(task ?? { id: task_id, content, status: "waiting" });
							}
							setTaskAssigning(currentTaskId, [...taskAssigning]);

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
								if (task) {
									taskTemp = JSON.parse(JSON.stringify(task))
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
							if(task){
								task.status = taskState === "waiting" ? "waiting" : "running";
							}
							taskRunning!.push(
								task ?? {
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
						setTaskRunning(currentTaskId, [...taskRunning]);
						setTaskAssigning(currentTaskId, [...taskAssigning]);

						return;
					}
					// Activate Toolkit
					if (agentMessages.step === "activate_toolkit") {
						if (agentMessages.data.method_name === 'send message to user') {
							return
						}
						// add log
						let taskAssigning = [...tasks[currentTaskId].taskAssigning]
						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id));
						if (assigneeAgentIndex !== -1) {
							const message = filterMessage(agentMessages)
							if (message) {
								taskAssigning[assigneeAgentIndex].log.push(agentMessages);
								setTaskAssigning(currentTaskId, [...taskAssigning]);
							}
						}
						console.log('agentMessages.data', agentMessages.data.toolkit_name, agentMessages.data.method_name)

						if (agentMessages.data.toolkit_name === 'Browser Toolkit' && agentMessages.data.method_name === 'browser visit page') {
							console.log('match success')
							addWebViewUrl(currentTaskId, agentMessages.data.message?.replace(/url=/g, '').replace(/'/g, '') as string, agentMessages.data.process_task_id as string)
						}
						if (agentMessages.data.toolkit_name === 'Browser Toolkit' && agentMessages.data.method_name === 'visit page') {
							console.log('match success')
							addWebViewUrl(currentTaskId, agentMessages.data.message as string, agentMessages.data.process_task_id as string)
						}
						if (agentMessages.data.toolkit_name === 'ElectronToolkit' && agentMessages.data.method_name === 'browse_url') {
							addWebViewUrl(currentTaskId, agentMessages.data.message as string, agentMessages.data.process_task_id as string)
						}
						if (agentMessages.data.method_name === 'browser_navigate' && agentMessages.data.message?.startsWith('{"url"')) {
							addWebViewUrl(currentTaskId, JSON.parse(agentMessages.data.message)?.url as string, agentMessages.data.process_task_id as string)
						}
						let taskRunning = [...tasks[currentTaskId].taskRunning]

						const taskIndex = taskRunning.findIndex((task) => task.id === agentMessages.data.process_task_id);

						if (taskIndex !== -1) {
							const { toolkit_name, method_name } = agentMessages.data;
							if (toolkit_name && method_name && assigneeAgentIndex !== -1) {

								if (assigneeAgentIndex !== -1) {
									const task = taskAssigning[assigneeAgentIndex].tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id);
									const message = filterMessage(agentMessages)
									if (message) {
										const toolkit = {
											toolkitId: generateUniqueId(),
											toolkitName: toolkit_name,
											toolkitMethods: method_name,
											message: message.data.message as string,
											toolkitStatus: "running" as AgentStatus,
										}
										if (task) {
											task.toolkits ??= []
											task.toolkits.push({ ...toolkit });
											task.status = "running";
											setTaskAssigning(currentTaskId, [...taskAssigning]);
										}
										taskRunning![taskIndex].status = "running";
										taskRunning![taskIndex].toolkits ??= [];
										taskRunning![taskIndex].toolkits.push({ ...toolkit });
									}
								}

							}
						}
						setTaskRunning(currentTaskId, taskRunning);
						return;
					}
					// Deactivate Toolkit
					if (agentMessages.step === "deactivate_toolkit") {

						// add log
						let taskAssigning = [...tasks[currentTaskId].taskAssigning]
						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id));
						if (assigneeAgentIndex !== -1) {
							const message = filterMessage(agentMessages)
							if (message) {
								const task = taskAssigning[assigneeAgentIndex].tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id);
								if (task) {
									let index = task.toolkits?.findIndex((toolkit) => {
										return toolkit.toolkitName === agentMessages.data.toolkit_name && toolkit.toolkitMethods === agentMessages.data.method_name && toolkit.toolkitStatus === 'running'
									})

									if (task.toolkits && index !== undefined && index != -1) {
										task.toolkits[index].message += '\n' + message.data.message as string
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

								setTaskAssigning(currentTaskId, [...taskAssigning]);
							}
						}

						let taskRunning = [...tasks[currentTaskId].taskRunning]
						const { toolkit_name, method_name, message } =
							agentMessages.data;
						const taskIndex = taskRunning.findIndex((task) =>
							task.agent?.type === agentMessages.data.agent_name &&
							task.toolkits?.at(-1)?.toolkitName === toolkit_name
						);

						if (taskIndex !== -1) {
							if (toolkit_name && method_name && message) {
								const targetMessage = filterMessage(agentMessages)

								if (targetMessage) {
									taskRunning![taskIndex].toolkits?.unshift({
										toolkitName: toolkit_name,
										toolkitMethods: method_name,
										message: targetMessage.data.message as string,
										toolkitStatus: "completed",
									});
								}

							}
						}
						setTaskAssigning(currentTaskId, [...taskAssigning]);
						setTaskRunning(currentTaskId, taskRunning);
						return;
					}
					// Terminal
					if (agentMessages.step === "terminal") {
						addTerminal(currentTaskId, agentMessages.data.process_task_id as string, agentMessages.data.output as string)
						return
					}
					// Write File
					if (agentMessages.step === "write_file") {
						console.log('write_to_file', agentMessages.data)
						setNuwFileNum(currentTaskId, tasks[currentTaskId].nuwFileNum + 1)
						const { file_path } = agentMessages.data;
						const fileName = file_path?.replace(/\\/g, "/").split("/").pop() || "";
						const fileType = fileName.split(".").pop() || "";
						const fileInfo: FileInfo = {
							name: fileName,
							type: fileType,
							path: file_path || "",
							icon: FileText,
						};
						addFileList(currentTaskId, agentMessages.data.process_task_id as string, fileInfo);
						return;
					}

					if (agentMessages.step === "budget_not_enough") {
						console.log('error', agentMessages.data)
						showCreditsToast()
						setStatus(currentTaskId, 'pause');
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
					setIsContextExceeded(currentTaskId, true);
					setStatus(currentTaskId, "pause");
					uploadLog(currentTaskId, type);
					return
				}

					if (agentMessages.step === "error") {
						console.error('Model error:', agentMessages.data)
						const errorMessage = agentMessages.data.message || 'An error occurred while processing your request';

						// Create a new task to avoid "Task already exists" error
						// and completely reset the interface
						const newTaskId = create();
						// Prevent showing task skeleton after an error occurs
						setActiveTaskId(newTaskId);
						setHasWaitComfirm(newTaskId, true);

						// Add error message to the new clean task
						addMessages(newTaskId, {
							id: generateUniqueId(),
							role: "agent",
							content: `❌ **Error**: ${errorMessage}`,
						});
						uploadLog(currentTaskId, type)
						return
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
							if(project_id) {
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
						console.log('tasks[taskId].snapshotsTemp', tasks[currentTaskId].snapshotsTemp)
						Promise.all(tasks[currentTaskId].snapshotsTemp.map((snapshot) =>
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
								"project_name": tasks[currentTaskId].summaryTask.split('|')[0],
								"summary": tasks[currentTaskId].summaryTask.split('|')[1],
								"status": 2,
								"tokens": getTokens(currentTaskId)
							}
							proxyFetchPut(`/api/chat/history/${historyId}`, obj)
						}
						uploadLog(currentTaskId, type)


						let taskRunning = [...tasks[currentTaskId].taskRunning];
						let taskAssigning = [...tasks[currentTaskId].taskAssigning];
						taskAssigning = taskAssigning.map((agent) => {
							agent.tasks = agent.tasks.map((task) => {
								if (task.status !== "completed" && task.status !== "failed" && !type) {
									task.status = "skipped"
								}
								return task
							})
							return agent
						})

						taskRunning = taskRunning.map((task) => {
							console.log('task.status', task.status)
							if (task.status !== "completed" && task.status !== "failed" && !type) {
								task.status = "skipped"
							}
							return task
						})
						setTaskAssigning(currentTaskId, [...taskAssigning]);
						setTaskRunning(currentTaskId, [...taskRunning]);

						if (!currentTaskId || !tasks[currentTaskId]) return "N/A";

						const task = tasks[currentTaskId];
						let taskTime = task.taskTime;
						let elapsed = task.elapsed;
						// if task is running, compute current time
						if (taskTime !== 0) {
							const currentTime = Date.now()
							elapsed += currentTime - taskTime
						}

						setTaskTime(currentTaskId, 0);
						setElapsed(currentTaskId, elapsed);
						const fileList = tasks[currentTaskId].taskAssigning.map((agent) => {
							return agent.tasks.map((task) => {
								return task.fileList || []
							}).flat()
						}).flat()
						let endMessage = agentMessages.data as string
						let summary = endMessage.match(/<summary>(.*?)<\/summary>/)?.[1]
						let newMessage: Message | null = null
						const agent_summary_end = tasks[currentTaskId].messages.findLast((message: Message) => message.step === 'agent_summary_end')
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


						addMessages(currentTaskId, newMessage);

						setIsPending(currentTaskId, false);
						setStatus(currentTaskId, 'finished');
						// completed tasks move to history
						setUpdateCount();

						console.log(tasks[currentTaskId], 'end');


						return;
					}
					if (agentMessages.step === "notice") {
						if (agentMessages.data.process_task_id !== '') {
							let taskAssigning = [...tasks[currentTaskId].taskAssigning]

							const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id));
							const task = taskAssigning[assigneeAgentIndex].tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id);
							const toolkit = {
								toolkitId: generateUniqueId(),
								toolkitName: 'notice',
								toolkitMethods: '',
								message: agentMessages.data.notice as string,
								toolkitStatus: "running" as AgentStatus,
							}
							if (assigneeAgentIndex !== -1 && task) {
								task.toolkits ??= []
								task.toolkits.push({ ...toolkit });
							}
							setTaskAssigning(currentTaskId, [...taskAssigning]);
						} else {
							const messages = [...tasks[currentTaskId].messages]
							const noticeCardIndex = messages.findLastIndex((message) => message.step === 'notice_card')
							if (noticeCardIndex === -1) {
								const newMessage: Message = {
									id: generateUniqueId(),
									role: "agent",
									content: "",
									step: 'notice_card',
								};
								addMessages(currentTaskId, newMessage)
							}
							setCotList(currentTaskId, [...tasks[currentTaskId].cotList, agentMessages.data.notice as string])
							// addMessages(currentTaskId, newMessage);
						}
						return

					}
					if (["sync"].includes(agentMessages.step)) return
					if (agentMessages.step === "ask") {
						if (tasks[currentTaskId].activeAsk != '') {
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
							let activeAskList = tasks[currentTaskId].askList
							setActiveAskList(currentTaskId, [...activeAskList, newMessage]);
							return
						}
						setActiveAsk(currentTaskId, agentMessages.data.agent || '')
						setIsPending(currentTaskId, false)
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
					addMessages(currentTaskId, newMessage);
				},
				async onopen(respond) {
					console.log("open", respond);
					const { setAttaches, activeTaskId } = get()
					setAttaches(activeTaskId as string, [])
					return;
				},

				onerror(err) {
					console.error("Error:", err);
					throw err;
				},

				// Server closes connection
				onclose() {
					console.log("server closed");
				},
			});

		},

		replay: async (taskId: string, question: string, time: number) => {
			const { create, setHasMessages, addMessages, startTask, setActiveTaskId, handleConfirmTask } = get();
			//get project id
			const project_id = useProjectStore.getState().activeProjectId
			if(!project_id) {
				console.error("Can't replay task because no project id provided")
				return;
			}

			create(taskId, "replay");
			setHasMessages(taskId, true);
			addMessages(taskId, {
				id: generateUniqueId(),
				role: "user",
				content: question.split("|")[0],
			});

			await startTask(taskId, "replay", undefined, time);
			setActiveTaskId(taskId);
			handleConfirmTask(project_id, taskId, "replay");
		},
		setUpdateCount() {
			set((state) => ({
				...state,
				updateCount: state.updateCount + 1
			}))
		},
		setActiveTaskId: (taskId: string) => {
			set({
				activeTaskId: taskId,
			});
		},
		addMessages(taskId, message) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						messages: [
							...state.tasks[taskId].messages,
							message,
						],
					},
				},
			}))
		},
		setAttaches(taskId, attaches) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						attaches: [...attaches],
					},
				},
			}))
		},
		setMessages(taskId, messages) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						messages: [
							...messages,
						],
					},
				},
			}))
		},
		removeMessage(taskId, messageId) {
			set((state) => {
				if (!state.tasks[taskId]) {
					return state;
				}
				return {
					...state,
					tasks: {
						...state.tasks,
						[taskId]: {
							...state.tasks[taskId],
							messages: state.tasks[taskId].messages.filter(
								(message) => message.id !== messageId
							),
						},
					},
				};
			})
		},
		setCotList(taskId, cotList) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						cotList: [...cotList],
					},
				},
			}))
		},

		setSummaryTask(taskId, summaryTask) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						summaryTask,
					},
				},
			}))
		},
		setIsTakeControl(taskId, isTakeControl) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						isTakeControl,
					},
				},
			}))
		},
		setHasWaitComfirm(taskId, hasWaitComfirm) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						hasWaitComfirm,
					},
				},
			}))
		},
		setTaskInfo(taskId, taskInfo) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						taskInfo: [...taskInfo],
					},
				},
			}))
		},
		setTaskRunning(taskId, taskRunning) {
			const { computedProgressValue } = get()
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						taskRunning: [...taskRunning],
					},
				},
			}))
			computedProgressValue(taskId)
		},
		addWebViewUrl(taskId: string, webViewUrl: string, processTaskId: string) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						webViewUrls: [...state.tasks[taskId].webViewUrls, { url: webViewUrl, processTaskId: processTaskId }],
					},
				},
			}))
		},
		setWebViewUrls(taskId: string, webViewUrls: { url: string, processTaskId: string }[]) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						webViewUrls: [...webViewUrls],
					},
				},
			}))
		},
		setActiveAskList(taskId, askList) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						actuveAskList: [...askList],
					},
				},
			}))
		},
		setTaskAssigning(taskId, taskAssigning) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						taskAssigning: [...taskAssigning],
					},
				},
			}))
		},
		setStatus(taskId: string, status: 'running' | 'finished' | 'pending' | 'pause') {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						status
					},
				},
			}))
		},
		handleConfirmTask: async (project_id:string, taskId: string, type?: string) => {
			const { tasks, setMessages, setActiveWorkSpace, setStatus, setTaskTime, setTaskInfo, setTaskRunning } = get();
			if (!taskId) return;

			// record task start time
			setTaskTime(taskId, Date.now());
			const taskInfo = tasks[taskId].taskInfo.filter((task) => task.content !== '')
			setTaskInfo(taskId, taskInfo)
			// Also update taskRunning with the filtered tasks to keep counts consistent
			const taskRunning = tasks[taskId].taskRunning.filter((task) => task.content !== '')
			setTaskRunning(taskId, taskRunning)
			if (!type) {
				await fetchPut(`/task/${project_id}`, {
					task: taskInfo,
				});
				await fetchPost(`/task/${project_id}/start`, {});
				
				setActiveWorkSpace(taskId, 'workflow')
				setStatus(taskId, 'running')
			}
			let messages = [...tasks[taskId].messages]
			const cardTaskIndex = messages.findLastIndex((message) => message.step === 'to_sub_tasks')
			if (cardTaskIndex !== -1) {
				messages[cardTaskIndex] = {
					...messages[cardTaskIndex],
					isConfirm: true,
					taskType: 2,
				}
				setMessages(taskId, messages)
			}
		},
		addTaskInfo() {
			const { tasks, activeTaskId, setTaskInfo } = get()
			if (!activeTaskId) return
			let targetTaskInfo = [...tasks[activeTaskId].taskInfo]
			const newTaskInfo = {
				id: "",
				content: "",
			};
			targetTaskInfo.push(newTaskInfo)
			setTaskInfo(activeTaskId, targetTaskInfo)
		},
		addTerminal(taskId, processTaskId, terminal) {
			if (!processTaskId) return
			const { tasks, setTaskAssigning } = get()
			const taskAssigning = [...tasks[taskId].taskAssigning]
			const taskAssigningIndex = taskAssigning.findIndex((task) => task.tasks.find((task) => task.id === processTaskId))
			if (taskAssigningIndex !== -1) {
				const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((task) => task.id === processTaskId)
				taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal ??= []
				taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal?.push(terminal)
				console.log(taskAssigning[taskAssigningIndex].tasks[taskIndex].terminal)
				setTaskAssigning(taskId, taskAssigning)
			}
		},
		setActiveAsk(taskId, agentName) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						activeAsk: agentName,
					},
				},
			}))
		},
		setProgressValue(taskId: string, progressValue: number) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						progressValue
					},
				},
			}))
		},
		setIsPending(taskId: string, isPending: boolean) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						isPending
					},
				},
			}))
		},
		setActiveWorkSpace(taskId: string, activeWorkSpace: string) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						activeWorkSpace
					},
				},
			}))
		},
		setActiveAgent(taskId: string, agent_id: string) {
			console.log('setActiveAgent', taskId, agent_id)

			set((state) => {
				if (state.tasks[taskId]?.activeAgent === agent_id) {
					return state;
				}
				return ({
					...state,
					tasks: {
						...state.tasks,
						[taskId]: {
							...state.tasks[taskId],
							activeAgent: agent_id
						},
					},
				})
			})
		},
		setHasMessages(taskId: string, hasMessages: boolean) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						hasMessages
					},
				},
			}))
		},
		setHasAddWorker(taskId: string, hasAddWorker: boolean) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						hasAddWorker
					},
				},
			}))
		},
		addFileList(taskId, processTaskId, fileInfo) {
			const { tasks, setTaskAssigning } = get()
			const taskAssigning = [...tasks[taskId].taskAssigning]
			let agentId = ''
			const taskAssigningIndex = taskAssigning.findIndex((agent) => {
				const hasTask = agent.tasks.find((task) => task.id === processTaskId)
				if (hasTask) {
					agentId = agent.agent_id
				}
				return hasTask
			})
			if (taskAssigningIndex !== -1) {
				const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((task) => task.id === processTaskId)
				if (taskIndex !== -1) {
					taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList ??= []
					taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList?.push({ ...fileInfo, agent_id: agentId, task_id: processTaskId })
					setTaskAssigning(taskId, taskAssigning)
				}
			}
		},
		setFileList(taskId, processTaskId, fileList: FileInfo[]) {
			const { tasks, setTaskAssigning } = get()
			const taskAssigning = [...tasks[taskId].taskAssigning]

			const taskAssigningIndex = taskAssigning.findIndex((task) => task.tasks.find((task) => task.id === processTaskId))
			const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((task) => task.id === processTaskId)
			if (taskAssigningIndex !== -1) {
				taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList = [...fileList]
				setTaskAssigning(taskId, taskAssigning)
			}
		},
		updateTaskInfo(index: number, content: string) {
			const { tasks, activeTaskId, setTaskInfo } = get()
			if (!activeTaskId) return
			let targetTaskInfo = [...tasks[activeTaskId].taskInfo]
			if (targetTaskInfo) {
				targetTaskInfo[index].content = content
			}
			setTaskInfo(activeTaskId, targetTaskInfo)
		},
		deleteTaskInfo(index: number) {
			const { tasks, activeTaskId, setTaskInfo } = get()
			if (!activeTaskId) return
			let targetTaskInfo = [...tasks[activeTaskId].taskInfo]

			if (targetTaskInfo) {
				targetTaskInfo.splice(index, 1)
			}
			setTaskInfo(activeTaskId, targetTaskInfo)

		},
		getLastUserMessage() {
			const { activeTaskId, tasks } = get();
			if (!activeTaskId) return null
			return tasks[activeTaskId]?.messages.findLast((message: Message) => message.role === 'user') || null
		},
		setTaskTime(taskId: string, taskTime: number) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						taskTime
					},
				},
			}))
		},
		setNuwFileNum(taskId: string, nuwFileNum: number) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						nuwFileNum
					},
				},
			}))
		},
		setType(taskId: string, type: string) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						type
					},
				},
			}))
		},
		setDelayTime(taskId: string, delayTime: number) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						delayTime
					},
				},
			}))
		},
		setElapsed(taskId: string, elapsed: number) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						elapsed
					},
				},
			}))
		},
		getFormattedTaskTime(taskId: string) {

			const { tasks } = get();
			if (!taskId || !tasks[taskId]) return "N/A";

			const task = tasks[taskId];
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
		addTokens(taskId: string, tokens: number) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						tokens: state.tasks[taskId].tokens + tokens
					},
				},
			}))
		},
		getTokens(taskId: string) {
			const { tasks } = get();
			return tasks[taskId]?.tokens ?? 0;
		},
		setSelectedFile(taskId: string, selectedFile: FileInfo | null) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						selectedFile: selectedFile,
					},
				},
			}))
		},
		setSnapshots(taskId: string, snapshots: any[]) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						snapshots,
					},
				},
			}))
		},
		setSnapshotsTemp(taskId: string, snapshot: any) {
			set((state) => {
				const oldList = state.tasks[taskId]?.snapshotsTemp || [];
				if (oldList.find(item => item.browser_url === snapshot.browser_url)) {
					return state;
				}
				return {
					...state,
					tasks: {
						...state.tasks,
						[taskId]: {
							...state.tasks[taskId],
							snapshotsTemp: [...state.tasks[taskId].snapshotsTemp, snapshot],
						},
					},
				}
			})
		},
		setIsTaskEdit(taskId: string, isTaskEdit: boolean) {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						isTaskEdit
					},
				},
			}))
		},
		clearTasks: () => {
			const { create } = get()
			console.log('clearTasks')

			window.ipcRenderer.invoke('restart-backend')
				.then((res) => {
					console.log('restart-backend', res)
				})
				.catch((error) => {
					console.error('Error in clearTasks cleanup:', error)
				})


			// Immediately create new task to maintain UI responsiveness
			const newTaskId = create()
			set((state) => ({
				...state,
				tasks: {
					[newTaskId]: {
						...state.tasks[newTaskId],
					},
				},
			}))
		},
		setIsContextExceeded: (taskId, isContextExceeded) => {
			set((state) => ({
				...state,
				tasks: {
					...state.tasks,
					[taskId]: {
						...state.tasks[taskId],
						isContextExceeded: isContextExceeded,
					},
				},
			}))
		},
		setNextTaskId: (taskId) => {
			set((state) => ({
				...state,
				nextTaskId: taskId,
			}))
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

	if (message.data.toolkit_name === 'Note Taking Toolkit') {
		message.data.message = message.data.message!.replace(/content='/g, '').replace(/', update=False/g, '').replace(/', update=True/g, '')
	}
	if (message.data.method_name === 'scrape') {
		message.data.message = message.data.message!.replace(/url='/g, '').slice(0, -1)
	}
	return message
}



export const useChatStore = chatStore;

export type VanillaChatStore = ReturnType<typeof chatStore>;

export const getToolStore = () => chatStore().getState();
