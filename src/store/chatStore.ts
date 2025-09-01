import { fetchPost, fetchPut, getBaseURL, proxyFetchPost, proxyFetchPut, proxyFetchGet, uploadFile } from '@/api/http';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { create } from 'zustand';
import { generateUniqueId, uploadLog } from "@/lib";
import { FileText } from 'lucide-react';
import { getAuthStore, useWorkerList } from './authStore';
import { showCreditsToast } from '@/components/Toast/creditsToast';
import { showStorageToast } from '@/components/Toast/storageToast';


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
}

interface ChatStore {
	updateCount: number;
	activeTaskId: string | null;
	tasks: { [key: string]: Task };
	create: (id?: string, type?: any) => string;
	removeTask: (taskId: string) => void;
	setStatus: (taskId: string, status: 'running' | 'finished' | 'pending' | 'pause') => void;
	setActiveTaskId: (taskId: string) => void;
	replay: (taskId: string, question: string, time: number) => Promise<void>;
	startTask: (taskId: string, type?: string, shareToken?: string, delayTime?: number) => Promise<void>;
	handleConfirmTask: (taskId: string, type?: string) => void;
	addMessages: (taskId: string, messages: Message) => void;
	setMessages: (taskId: string, messages: Message[]) => void;
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
}



const chatStore = create<ChatStore>()(
	(set, get) => ({
		activeTaskId: null,
		tasks: {},
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
						isTaskEdit: false
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
		startTask: async (taskId: string, type?: string, shareToken?: string, delayTime?: number) => {
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
			const base_Url = import.meta.env.DEV ? import.meta.env.VITE_PROXY_URL : import.meta.env.VITE_BASE_URL
			const api = type == 'share' ? `${base_Url}/api/chat/share/playback/${shareToken}?delay_time=${delayTime}` : type == 'replay' ? `${base_Url}/api/chat/steps/playback/${taskId}?delay_time=${delayTime}` : `${baseURL}/chat`

			const { tasks } = get()
			let historyId: string | null = null;
			let snapshots: any = [];

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
					model_platform: cloud_model_type.includes('gpt') ? 'openai' : 'gemini',
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
			if (!type) {
				const authStore = getAuthStore();

				const obj = {
					"task_id": taskId,
					"user_id": authStore.user_id,
					"question": tasks[taskId]?.messages[0]?.content ?? '',
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
				})
			}
			const browser_port = await window.ipcRenderer.invoke('get-browser-port');
			fetchEventSource(api, {
				method: !type ? "POST" : "GET",
				openWhenHidden: true,
				headers: { "Content-Type": "application/json", "Authorization": type == 'replay' ? `Bearer ${token}` : undefined as unknown as string },
				body: !type ? JSON.stringify({
					task_id: taskId,
					question: getLastUserMessage()?.content,
					model_platform: apiModel.model_platform,
					email,
					model_type: apiModel.model_type,
					api_key: apiModel.api_key,
					api_url: apiModel.api_url,
					extra_params: apiModel.extra_params,
					installed_mcp: mcpLocal,
					language: systemLanguage,
					allow_local_system: true,
					attaches: tasks[taskId].attaches.map(f => f.filePath),
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
					const { setNuwFileNum, setCotList, getTokens, setUpdateCount, addTokens, setStatus, addWebViewUrl, setIsPending, addMessages, setHasWaitComfirm, setSummaryTask, setTaskAssigning, setTaskInfo, setTaskRunning, addTerminal, addFileList, setActiveAsk, setActiveAskList, tasks, create, setActiveTaskId } = get()
					// if (tasks[taskId].status === 'finished') return

					if (agentMessages.step === "to_sub_tasks") {


						const messages = [...tasks[taskId].messages]
						const toSubTaskIndex = messages.findLastIndex((message: Message) => message.step === 'to_sub_tasks')
						if (toSubTaskIndex === -1) {
							// 30 seconds auto confirm
							setTimeout(() => {
								const { tasks, handleConfirmTask, setIsTaskEdit } = get();
								const message = tasks[taskId].messages.findLast((item) => item.step === "to_sub_tasks");
								const isConfirm = message?.isConfirm || false;
								const isTakeControl =
									tasks[taskId].isTakeControl;
								if (!isConfirm && !isTakeControl && !tasks[taskId].isTaskEdit) {
									handleConfirmTask(taskId);
								}
								setIsTaskEdit(taskId, false);
							}, 30000);

							const newNoticeMessage: Message = {
								id: generateUniqueId(),
								role: "agent",
								content: "",
								step: 'notice_card',
							};
							addMessages(taskId, newNoticeMessage)
							const newMessage: Message = {
								id: generateUniqueId(),
								role: "agent",
								content: "",
								step: agentMessages.step,
								taskType: type ? 2 : 1,
								showType: "list",
								isConfirm: type ? true : false // share and replay, skip to_sub_tasks
							};
							addMessages(taskId, newMessage)
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
								"tokens": getTokens(taskId)
							}
							proxyFetchPut(`/api/chat/history/${historyId}`, obj)
						}
						setSummaryTask(taskId, agentMessages.data.summary_task as string)
						setTaskInfo(taskId, agentMessages.data.sub_tasks as TaskInfo[])
						setTaskRunning(taskId, agentMessages.data.sub_tasks as TaskInfo[])
						return;
					}
					// Create agent
					if (agentMessages.step === "create_agent") {
						const { agent_name, agent_id } = agentMessages.data;
						if (!agent_name || !agent_id) return;

						// Add agent to taskAssigning
						if (!['mcp_agent', 'new_worker_agent', 'task_agent', 'task_summary_agent', "coordinator_agent"].includes(agent_name)) {
							// if (agentNameMap[agent_name as keyof typeof agentNameMap]) {
							const hasAgent = tasks[taskId].taskAssigning.find((agent) => agent.agent_id === agent_id)

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
								setTaskAssigning(taskId, [...tasks[taskId].taskAssigning, {
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
						setHasWaitComfirm(taskId, true)
						setIsPending(taskId, false)
						addMessages(taskId, {
							id: generateUniqueId(),
							role: "agent",
							content: agentMessages.data!.content as string,
							step: "wait_confirm",
							isConfirm: false,
						})
						return;
					}
					if (agentMessages.step === "confirmed") {
						setHasWaitComfirm(taskId, false)
						return
					}
					// Task State
					if (agentMessages.step === "task_state") {
						const { state, task_id, result, failure_count } = agentMessages.data;
						if (!state && !task_id) return

						let taskRunning = [...tasks[taskId].taskRunning]
						let taskAssigning = [...tasks[taskId].taskAssigning]
						const targetTaskIndex = taskRunning.findIndex((task) => task.id === task_id)
						const targetTaskAssigningIndex = taskAssigning.findIndex((agent) => agent.tasks.find((task: TaskInfo) => task.id === task_id))
						if (targetTaskAssigningIndex !== -1) {
							const taskIndex = taskAssigning[targetTaskAssigningIndex].tasks.findIndex((task: TaskInfo) => task.id === task_id)
							taskAssigning[targetTaskAssigningIndex].tasks[taskIndex].status = state === "DONE" ? "completed" : "failed";

							// destroy webview
							tasks[taskId].taskAssigning = tasks[taskId].taskAssigning.map((item) => {
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
									addMessages(taskId, {
										id: generateUniqueId(),
										role: "agent",
										content: targetResult,
										step: "failed",
									})
									setStatus(taskId, 'pause')
								}
							}

						}
						if (targetTaskIndex !== -1) {

							taskRunning[targetTaskIndex].status = state === "DONE" ? "completed" : "failed";
						}
						setTaskRunning(taskId, taskRunning)
						setTaskAssigning(taskId, taskAssigning)
						return;
					}
					// Activate agent
					if (agentMessages.step === "activate_agent" || agentMessages.step === "deactivate_agent") {
						let taskAssigning = [...tasks[taskId].taskAssigning]
						let taskRunning = [...tasks[taskId].taskRunning]
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
							setTaskRunning(taskId, [...taskRunning]);
							setTaskAssigning(taskId, [...taskAssigning]);
						}
						if (agentMessages.step === "deactivate_agent") {
							taskAssigning[agentIndex].status = "completed";
							if (message) {
								const index = taskAssigning[agentIndex].log.findLastIndex((log) => log.data.method_name === agentMessages.data.method_name && log.data.toolkit_name === agentMessages.data.toolkit_name)
								if (index != -1) {
									taskAssigning[agentIndex].log[index].status = "completed";
									setTaskAssigning(taskId, [...taskAssigning]);
								}

							}
							// const taskIndex = taskRunning!.findLastIndex((task) => task.agent?.agent_id === agent_id && task.status !== 'completed' && task.status !== 'failed');
							const taskIndex = taskRunning.findIndex((task) => task.id === process_task_id);
							if (taskIndex !== -1) {
								taskRunning![taskIndex].agent!.status = "completed";
								taskRunning![taskIndex]!.status = "completed";
							}
							if (agentMessages.data.tokens) {
								addTokens(taskId, agentMessages.data.tokens)
							}
							if (!type && historyId) {
								const obj = {
									"project_name": tasks[taskId].summaryTask.split('|')[0],
									"summary": tasks[taskId].summaryTask.split('|')[1],
									"status": 1,
									"tokens": getTokens(taskId)
								}
								proxyFetchPut(`/api/chat/history/${historyId}`, obj)
							}


							setTaskRunning(taskId, [...taskRunning]);
							setTaskAssigning(taskId, [...taskAssigning]);



						}
						return;
					}
					// Assign task
					if (agentMessages.step === "assign_task") {
						if (!agentMessages.data?.assignee_id || !agentMessages.data?.task_id) return;

						const { assignee_id, task_id, content = "", state: taskState } = agentMessages.data as any;
						let taskAssigning = [...tasks[taskId].taskAssigning]
						let taskRunning = [...tasks[taskId].taskRunning]
						let taskInfo = [...tasks[taskId].taskInfo]

						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.agent_id === assignee_id);
						// Find task corresponding to task_id
						const task = taskInfo!.find((task: TaskInfo) => task.id === task_id);

						const taskRunningIndex = taskRunning!.findIndex((task: TaskInfo) => task.id === task_id);

						if (assigneeAgentIndex === -1) return;
						const taskAgent = taskAssigning![assigneeAgentIndex];

						// If the state is "waiting", only mark it in the agent's task list and do not add it to taskRunning
						if (taskState === "waiting") {
							if (!taskAssigning[assigneeAgentIndex].tasks.find(item => item.id === task_id)) {
								taskAssigning[assigneeAgentIndex].tasks.push(task ?? { id: task_id, content, status: "waiting" });
							}
							setTaskAssigning(taskId, [...taskAssigning]);
							return; // Return early, do not add to the running queue
						}

						// The following logic is for when the task actually starts executing (running)
						if (taskAssigning && taskAssigning[assigneeAgentIndex]) {
							const exist = taskAssigning[assigneeAgentIndex].tasks.find(item => item.id === task_id);
							if (exist) {
								exist.status = "running";
							} else {
								taskAssigning[assigneeAgentIndex].tasks.push(task ?? { id: task_id, content, status: "running", });
							}
						}
						if (taskRunningIndex === -1) {
							taskRunning!.push(
								task ?? {
									id: task_id,
									content,
									status: "",
									agent: JSON.parse(JSON.stringify(taskAgent)),
								}
							);
						} else {
							taskRunning![taskRunningIndex] = {
								...taskRunning![taskRunningIndex],
								content,
								status: "",
								agent: JSON.parse(JSON.stringify(taskAgent)),
							};
						}
						setTaskRunning(taskId, [...taskRunning]);
						setTaskAssigning(taskId, [...taskAssigning]);

						return;
					}
					// Activate Toolkit
					if (agentMessages.step === "activate_toolkit") {
						if (agentMessages.data.method_name === 'send message to user') {
							return
						}
						// add log
						let taskAssigning = [...tasks[taskId].taskAssigning]
						const assigneeAgentIndex = taskAssigning!.findIndex((agent: Agent) => agent.tasks.find((task: TaskInfo) => task.id === agentMessages.data.process_task_id));
						if (assigneeAgentIndex !== -1) {
							const message = filterMessage(agentMessages)
							if (message) {
								taskAssigning[assigneeAgentIndex].log.push(agentMessages);
								setTaskAssigning(taskId, [...taskAssigning]);
							}
						}
						console.log('agentMessages.data', agentMessages.data.toolkit_name, agentMessages.data.method_name)

						if (agentMessages.data.toolkit_name === 'Browser Toolkit' && agentMessages.data.method_name === 'browser visit page') {
							console.log('match success')
							addWebViewUrl(taskId, agentMessages.data.message?.replace(/url=/g, '').replace(/'/g, '') as string, agentMessages.data.process_task_id as string)
						}
						if (agentMessages.data.toolkit_name === 'Browser Toolkit' && agentMessages.data.method_name === 'visit page') {
							console.log('match success')
							addWebViewUrl(taskId, agentMessages.data.message as string, agentMessages.data.process_task_id as string)
						}
						if (agentMessages.data.toolkit_name === 'ElectronToolkit' && agentMessages.data.method_name === 'browse_url') {
							addWebViewUrl(taskId, agentMessages.data.message as string, agentMessages.data.process_task_id as string)
						}
						if (agentMessages.data.method_name === 'browser_navigate' && agentMessages.data.message?.startsWith('{"url"')) {
							addWebViewUrl(taskId, JSON.parse(agentMessages.data.message)?.url as string, agentMessages.data.process_task_id as string)
						}
						let taskRunning = [...tasks[taskId].taskRunning]

						const taskIndex = taskRunning.findIndex((task) => task.id === agentMessages.data.process_task_id);

						if (taskIndex !== -1) {
							const { toolkit_name, method_name } = agentMessages.data;
							if (toolkit_name && method_name) {

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
									if (assigneeAgentIndex !== -1 && task) {
										task.toolkits ??= []
										task.toolkits.push({ ...toolkit });
										task.status = "running";
										setTaskAssigning(taskId, [...taskAssigning]);
									}
									taskRunning![taskIndex].status = "running";
									taskRunning![taskIndex].toolkits ??= [];
									taskRunning![taskIndex].toolkits.push({ ...toolkit });
								}

							}
						}
						setTaskRunning(taskId, taskRunning);
						return;
					}
					// Deactivate Toolkit
					if (agentMessages.step === "deactivate_toolkit") {

						// add log
						let taskAssigning = [...tasks[taskId].taskAssigning]
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

								setTaskAssigning(taskId, [...taskAssigning]);
							}
						}

						let taskRunning = [...tasks[taskId].taskRunning]
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
						setTaskAssigning(taskId, [...taskAssigning]);
						setTaskRunning(taskId, taskRunning);
						return;
					}
					// Terminal
					if (agentMessages.step === "terminal") {
						addTerminal(taskId, agentMessages.data.process_task_id as string, agentMessages.data.output as string)
						return
					}
					// Write File
					if (agentMessages.step === "write_file") {
						console.log('write_to_file', agentMessages.data)
						setNuwFileNum(taskId, tasks[taskId].nuwFileNum + 1)
						const { file_path } = agentMessages.data;
						const fileName = file_path?.replace(/\\/g, "/").split("/").pop() || "";
						const fileType = fileName.split(".").pop() || "";
						const fileInfo: FileInfo = {
							name: fileName,
							type: fileType,
							path: file_path || "",
							icon: FileText,
						};
						addFileList(taskId, agentMessages.data.process_task_id as string, fileInfo);
						return;
					}

					if (agentMessages.step === "budget_not_enough") {
						console.log('error', agentMessages.data)
						showCreditsToast()
						setStatus(taskId, 'pause');
						uploadLog(taskId, type)
						return
					}

					if (agentMessages.step === "error" || agentMessages.error) {
						console.error('Model error:', agentMessages.data || agentMessages.error)
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
						uploadLog(taskId, type)
						return
					}

					if (agentMessages.step === "end") {
						// compute task time
						const { setTaskTime, setElapsed } = get();
						console.log('tasks[taskId].snapshotsTemp', tasks[taskId].snapshotsTemp)
						Promise.all(tasks[taskId].snapshotsTemp.map((snapshot) =>
							proxyFetchPost(`/api/chat/snapshots`, { ...snapshot })
						));

						// Async file upload
						let res = await window.ipcRenderer.invoke(
							"get-file-list",
							email,
							taskId as string
						);
						if (!type && import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && res.length > 0) {
							// Upload files sequentially to avoid overwhelming the server
							const uploadResults = await Promise.allSettled(
								res.map(async (file: any) => {
									try {
										// Read file content using Electron API
										const result = await window.ipcRenderer.invoke('read-file', file.path);
										if (result.success && result.data) {
											// Create FormData for file upload
											const formData = new FormData();
											const blob = new Blob([result.data], { type: 'application/octet-stream' });
											formData.append('file', blob, file.name);
											formData.append('task_id', taskId);

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
								"project_name": tasks[taskId].summaryTask.split('|')[0],
								"summary": tasks[taskId].summaryTask.split('|')[1],
								"status": 2,
								"tokens": getTokens(taskId)
							}
							proxyFetchPut(`/api/chat/history/${historyId}`, obj)
						}
						uploadLog(taskId, type)


						let taskRunning = [...tasks[taskId].taskRunning];
						let taskAssigning = [...tasks[taskId].taskAssigning];
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
						setTaskAssigning(taskId, [...taskAssigning]);
						setTaskRunning(taskId, [...taskRunning]);

						if (!taskId || !tasks[taskId]) return "N/A";

						const task = tasks[taskId];
						let taskTime = task.taskTime;
						let elapsed = task.elapsed;
						// if task is running, compute current time
						if (taskTime !== 0) {
							const currentTime = Date.now()
							elapsed += currentTime - taskTime
						}

						setTaskTime(taskId, 0);
						setElapsed(taskId, elapsed);
						const fileList = tasks[taskId].taskAssigning.map((agent) => {
							return agent.tasks.map((task) => {
								return task.fileList || []
							}).flat()
						}).flat()
						let endMessage = agentMessages.data as string
						let summary = endMessage.match(/<summary>(.*?)<\/summary>/)?.[1]
						let newMessage: Message | null = null
						const agent_summary_end = tasks[taskId].messages.findLast((message: Message) => message.step === 'agent_summary_end')
						console.log('summary', summary)
						if (summary) {
							endMessage = summary
						}
						else if (agent_summary_end) {
							console.log('agent_summary_end', agent_summary_end)
							endMessage = agent_summary_end.summary || ""
						} else if (endMessage.indexOf('Result ---') !== -1) {
							endMessage = endMessage.split('Result ---').at(-1) || ""
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


						addMessages(taskId, newMessage);

						setIsPending(taskId, false);
						setStatus(taskId, 'finished');
						// completed tasks move to history
						setUpdateCount();

						console.log(tasks[taskId], 'end');


						return;
					}
					if (agentMessages.step === "notice") {
						if (agentMessages.data.process_task_id !== '') {
							let taskAssigning = [...tasks[taskId].taskAssigning]

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
							setTaskAssigning(taskId, [...taskAssigning]);
						} else {
							const messages = [...tasks[taskId].messages]
							const noticeCardIndex = messages.findLastIndex((message) => message.step === 'notice_card')
							if (noticeCardIndex === -1) {
								const newMessage: Message = {
									id: generateUniqueId(),
									role: "agent",
									content: "",
									step: 'notice_card',
								};
								addMessages(taskId, newMessage)
							}
							setCotList(taskId, [...tasks[taskId].cotList, agentMessages.data.notice as string])
							// addMessages(taskId, newMessage);
						}
						return

					}
					if (["sync"].includes(agentMessages.step)) return
					if (agentMessages.step === "ask") {
						if (tasks[taskId].activeAsk != '') {
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
							let activeAskList = tasks[taskId].askList
							setActiveAskList(taskId, [...activeAskList, newMessage]);
							return
						}
						setActiveAsk(taskId, agentMessages.data.agent || '')
						setIsPending(taskId, false)
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
					addMessages(taskId, newMessage);
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
					const { setUpdateCount, setStatus, setIsPending,  } = get()
					setIsPending(taskId, false);
					setStatus(taskId, 'finished');
					setUpdateCount();
				},
			});

		},

		replay: async (taskId: string, question: string, time: number) => {
			const { create, setHasMessages, addMessages, startTask, setActiveTaskId, handleConfirmTask } = get();
			create(taskId, "replay");
			setHasMessages(taskId, true);
			addMessages(taskId, {
				id: generateUniqueId(),
				role: "user",
				content: question.split("|")[0],
			});

			await startTask(taskId, "replay", undefined, time);
			setActiveTaskId(taskId);
			handleConfirmTask(taskId, "replay");
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
		handleConfirmTask: async (taskId: string, type?: string) => {
			const { tasks, setMessages, setActiveWorkSpace, setStatus, setTaskTime, setTaskInfo } = get();
			if (!taskId) return;

			// record task start time
			setTaskTime(taskId, Date.now());
			const taskInfo = tasks[taskId].taskInfo.filter((task) => task.content !== '')
			setTaskInfo(taskId, taskInfo)
			if (!type) {
				await fetchPut(`/task/${taskId}`, {
					task: taskInfo,
				});
				await fetchPost(`/task/${taskId}/start`, {});
			}
			setActiveWorkSpace(taskId, 'workflow')
			setStatus(taskId, 'running')
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
			const taskIndex = taskAssigning[taskAssigningIndex].tasks.findIndex((task) => task.id === processTaskId)
			if (taskAssigningIndex !== -1) {
				taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList ??= []
				taskAssigning[taskAssigningIndex].tasks[taskIndex].fileList?.push({ ...fileInfo, agent_id: agentId, task_id: processTaskId })
				setTaskAssigning(taskId, taskAssigning)
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

export const getToolStore = () => chatStore.getState();
