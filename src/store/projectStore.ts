import { create } from 'zustand';
import { generateUniqueId } from "@/lib";
import { useChatStore, VanillaChatStore } from './chatStore';
import { devtools } from 'zustand/middleware';

export enum ProjectType {
	NORMAL = 'normal',
	REPLAY = 'replay'
}

interface Project {
	id: string;
	name: string;
	description?: string;
	createdAt: number;
	updatedAt: number;
	chatStores: { [chatId: string]: VanillaChatStore }; // Multiple chat stores for this project
	chatStoreTimestamps: { [chatId: string]: number }; // Track creation time of each chat store
	activeChatId: string | null; // ID of the currently active chat store
	queuedMessages: Array<{ task_id: string; content: string; timestamp: number; attaches: File[] }>; // Project-level queued messages
	metadata?: {
		tags?: string[];
		priority?: 'low' | 'medium' | 'high';
		status?: 'active' | 'completed' | 'archived';
		/**Save history id for replay reuse purposes.
		 * TODO(history): Remove historyId handling to support per projectId 
		 * instead in history api
		 */
		historyId?: string;
	};
}

interface ProjectStore {
	activeProjectId: string | null;
	projects: { [projectId: string]: Project };
	
	// Project management
	/**
	 * 
	 * @param name 
	 * @param description 
	 * @param projectId 
	 * @param type 
	 * @param historyId Mainly passed from @function replayProject 
	 * @returns projectId
	 */
	createProject: (name: string, description?: string, projectId?:string, type?:ProjectType, historyId?: string) => string;
	setActiveProject: (projectId: string) => void;
	removeProject: (projectId: string) => void;
	updateProject: (projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void;
	replayProject: (taskIds: string[], question?: string, projectId?: string, historyId?: string) => string;
	
	// Project-level queued messages management
	addQueuedMessage: (projectId: string, content: string, attaches: File[]) => string|null;
	removeQueuedMessage: (projectId: string, taskId: string) => void;
	restoreQueuedMessage: (projectId: string, messageData: { task_id: string; content: string; timestamp: number; attaches: File[] }) => void;
	clearQueuedMessages: (projectId: string) => void;
	
	// Chat store state management
	createChatStore: (projectId: string, chatName?: string) => string | null;
	appendInitChatStore: (projectId: string, customTaskId?:string, chatName?: string) => {taskId:string, chatStore:VanillaChatStore} | null;
	setActiveChatStore: (projectId: string, chatId: string) => void;
	removeChatStore: (projectId: string, chatId: string) => void;
	saveChatStore: (projectId: string, chatId: string, state: VanillaChatStore) => void;
	getChatStore: (projectId?: string, chatId?: string) => VanillaChatStore | null;
	getActiveChatStore: (projectId?: string) => VanillaChatStore | null;
	getAllChatStores: (projectId: string) => Array<{ chatId: string; chatStore: VanillaChatStore }>;
	
	// Utility methods
	getAllProjects: () => Project[];
	getProjectById: (projectId: string) => Project | null;
	getProjectTotalTokens: (projectId: string) => number;

	//History ID
	setHistoryId: (projectId: string, historyId: string) => void;
	getHistoryId: (projectId: string | null) => string | null;
}


// Helper function to check if a project is empty/unused
const isEmptyProject = (project: Project): boolean => {
	try {
		// Check if project has only one chat store
		const chatStoreIds = Object.keys(project.chatStores);
		if (chatStoreIds.length !== 1) {
			return false;
		}
		
		const chatStore = project.chatStores[chatStoreIds[0]];
		if (!chatStore || !chatStore.getState) {
			return false;
		}
		
		const chatState = chatStore.getState();
		const taskIds = Object.keys(chatState.tasks);
		
		// Check if chat store has only one task
		if (taskIds.length !== 1) {
			return false;
		}
		
		const task = chatState.tasks[taskIds[0]];
		if (!task) {
			return false;
		}
		
		// Check if project has any queued messages
		if (project.queuedMessages && project.queuedMessages.length > 0) {
			return false;
		}
		
		// Check if task is in initial/empty state
		const isEmpty = (
			Array.isArray(task.messages) && task.messages.length === 0 &&
			task.summaryTask === "" &&
			task.progressValue === 0 &&
			task.isPending === false &&
			task.status === "pending" &&
			task.taskTime === 0 &&
			task.tokens === 0 &&
			task.elapsed === 0 &&
			task.hasWaitComfirm === false
		);
		
		return isEmpty;
	} catch (error) {
		console.warn("[store] Error checking if project is empty:", error);
		return false;
	}
};

const projectStore = create<ProjectStore>()((set, get) => ({
	activeProjectId: null,
	projects: {},
	
	createProject: (name: string, description?: string, projectId?: string, type?:ProjectType, historyId?: string) => {
		const { projects } = get();
		
		//Replay doesn't need to use an empty project container
		if(type !== ProjectType.REPLAY) {
			// First, check if there are any existing empty projects
			const existingEmptyProject = Object.values(projects).find(project => isEmptyProject(project));
			
			if (existingEmptyProject) {
				console.log("[store] Found existing empty project, reusing:", existingEmptyProject.id);
				
				// Update the existing empty project with new name and description
				const now = Date.now();
				set((state) => ({
					projects: {
						...state.projects,
						[existingEmptyProject.id]: {
							...existingEmptyProject,
							name,
							description,
							metadata: {
								...existingEmptyProject.metadata,
								historyId: historyId
							},
							updatedAt: now
						}
					},
					activeProjectId: existingEmptyProject.id
				}));
				
				return existingEmptyProject.id;
			}
		}
		
		// If no empty project exists, create a new one
		const targetProjectId = projectId ?? generateUniqueId();
		const now = Date.now();
		
		// Create initial chat store for the project
		const initialChatId = generateUniqueId();
		const initialChatStore = useChatStore();
		
		// Initialize the chat store with a task using the create() function
		if(type !== ProjectType.REPLAY)
			initialChatStore.getState().create();
		
		// Create new project with default chat store
		const newProject: Project = {
			id: targetProjectId,
			name,
			description,
			createdAt: now,
			updatedAt: now,
			chatStores: {
				[initialChatId]: initialChatStore
			},
			chatStoreTimestamps: {
				[initialChatId]: now
			},
			activeChatId: initialChatId,
			queuedMessages: [], // Initialize empty queued messages array
			metadata: {
				status: 'active',
				historyId: historyId
			}
		};
		
		console.log("[store] Creating a new project");
		set((state) => ({
			projects: {
				...state.projects,
				[targetProjectId]: newProject
			},
			activeProjectId: targetProjectId
		}));
		
		return targetProjectId;
	},
	
	setActiveProject: (projectId: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		set({ activeProjectId: projectId });
		
		// Update project's updatedAt
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					updatedAt: Date.now()
				}
			}
		}));
	},
	
	createChatStore: (projectId: string, chatName?: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return null;
		}
		
		const chatId = generateUniqueId();
		const newChatStore = useChatStore();
		const now = Date.now();
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					chatStores: {
						...state.projects[projectId].chatStores,
						[chatId]: newChatStore
					},
					chatStoreTimestamps: {
						...state.projects[projectId].chatStoreTimestamps,
						[chatId]: now
					},
					activeChatId: chatId,
					updatedAt: now
				}
			}
		}));
		
		return chatId;
	},

	/**
	 * 
	 * @param projectId project id to append a new chatStore to
	 * @param customTaskId the taskId that will be used to initialize the new taskId
	 * @param chatName [optional] used to give a chatName
	 * @returns {taskId, chatStore} | null
	 */
	appendInitChatStore: (projectId: string, customTaskId?:string, chatName?: string) => {
		const { projects, createChatStore, getChatStore, setActiveChatStore, getProjectTotalTokens } = get();

		if (!projectId) {
			console.warn("No active project found to appendNewChatStore");
			return null;
		}
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return null;
		}
		
		// Calculate total tokens across all chat stores in the project
		const totalProjectTokens = getProjectTotalTokens(projectId);
		
		// Create new chat store & append in the current project
		const newChatId = createChatStore(projectId, chatName);
		
		if (!newChatId) {
			console.error("Failed to create new chat store");
			return null;
		}

		// Get the new chat store instance
		const newChatStore = getChatStore(projectId, newChatId);
		
		if (!newChatStore) {
			console.error("Failed to get new chat store instance");
			return null;
		}

		// Create a new task in the new chat store with the queued content
		const newTaskId = newChatStore.getState().create(customTaskId);

		// Accumulate project tokens
		newChatStore.getState().addTokens(newTaskId, totalProjectTokens);

		//Set the initTask as the active taskId
		newChatStore.getState().setActiveTaskId(newTaskId);
		
		return {taskId: newTaskId, chatStore: newChatStore};
	},
	
	setActiveChatStore: (projectId: string, chatId: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		if (!projects[projectId].chatStores[chatId]) {
			console.warn(`Chat ${chatId} not found in project ${projectId}`);
			return;
		}
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					activeChatId: chatId,
					updatedAt: Date.now()
				}
			}
		}));
	},
	
	removeChatStore: (projectId: string, chatId: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		const project = projects[projectId];
		const chatStoreKeys = Object.keys(project.chatStores);
		
		// Don't allow removing the last chat store
		if (chatStoreKeys.length === 1) {
			console.warn('Cannot remove the last chat store from a project');
			return;
		}
		
		if (!project.chatStores[chatId]) {
			console.warn(`Chat ${chatId} not found in project ${projectId}`);
			return;
		}
		
		// If removing the active chat, switch to another one
		let newActiveChatId = project.activeChatId;
		if (project.activeChatId === chatId) {
			const remainingChats = chatStoreKeys.filter(id => id !== chatId);
			newActiveChatId = remainingChats[0];
		}
		
		set((state) => {
			const newChatStores = { ...state.projects[projectId].chatStores };
			delete newChatStores[chatId];
			
			return {
				projects: {
					...state.projects,
					[projectId]: {
						...state.projects[projectId],
						chatStores: newChatStores,
						activeChatId: newActiveChatId,
						updatedAt: Date.now()
					}
				}
			};
		});
	},
	
	removeProject: (projectId: string) => {
		const { activeProjectId, projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		// If removing the active project, switch to another project or set to null
		let newActiveId = activeProjectId;
		if (activeProjectId === projectId) {
			const remainingProjects = Object.keys(projects).filter(id => id !== projectId);
			newActiveId = remainingProjects.length > 0 ? remainingProjects[0] : null;
		}
		
		set((state) => {
			const newProjects = { ...state.projects };
			delete newProjects[projectId];
			
			return {
				projects: newProjects,
				activeProjectId: newActiveId
			};
		});
	},
	
	updateProject: (projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => {
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					...updates,
					updatedAt: Date.now()
				}
			}
		}));
	},

	/**
	 * Simplified replay functionality
	 * @param taskIds - array of taskIds to replay
	 * @param projectId - optional projectId to create/overwrite
	 * @param historyId - optional, used to init historyId to new project
	 * @returns the created project ID
	 */
	replayProject: (taskIds: string[], question: string="Replay task", projectId?: string, historyId?: string) => {
		const { projects, removeProject, createProject, createChatStore } = get();
		
		let replayProjectId: string;

		//TODO: For now handle the question as unique identifier to avoid duplicate
		if(!projectId) 
			projectId = "Replay: "+question;
		
		// If projectId is provided, reset that project
		if (projectId) {
			if (projects[projectId]) {
				console.log(`[ProjectStore] Overwriting existing project ${projectId}`);
				removeProject(projectId);
			}
			// Create project with the specific naming
			replayProjectId = createProject(
				`Replay Project ${question}`, 
				`Replayed project from ${question}`,
				projectId,
				ProjectType.REPLAY,
				historyId
			);
		} else {
			// Create a new project only once
			replayProjectId = createProject(
				`Replay Project ${question}`, 
				`Replayed project with ${taskIds.length} tasks`,
				projectId,
				ProjectType.REPLAY,
				historyId
			);
		}
		
		console.log(`[ProjectStore] Created replay project ${replayProjectId} for ${taskIds.length} tasks`);
		
		// For each taskId, create a chat store within the project and call replay
		taskIds.forEach(async (taskId, index) => {
			console.log(`[ProjectStore] Creating replay for task ${index + 1}/${taskIds.length}: ${taskId}`);
			
			// Create a new chat store for this task
			const chatId = createChatStore(replayProjectId, `Task ${taskId}`);
			
			if (chatId) {
				const project = get().projects[replayProjectId];
				const chatStore = project.chatStores[chatId];
				
				if (chatStore) {					
					// Call replay on the chat store with the taskId, question, and 0 delay
					await chatStore.getState().replay(taskId, question, 0.2);
					console.log(`[ProjectStore] Started replay for task ${taskId}`);
				}
			}
		});
		
		console.log(`[ProjectStore] Completed replay setup for ${taskIds.length} tasks`);
		return replayProjectId;
	},
	
	saveChatStore: (projectId: string, chatId: string, state: VanillaChatStore) => {
		const { projects } = get();
		
		if (projects[projectId] && projects[projectId].chatStores[chatId]) {
			set((currentState) => ({
				projects: {
					...currentState.projects,
					[projectId]: {
						...currentState.projects[projectId],
						chatStores: {
							...currentState.projects[projectId].chatStores,
							[chatId]: state
						},
						updatedAt: Date.now()
					}
				}
			}));
		}
	},
	
	getChatStore: (projectId?: string, chatId?: string) => {
		const { projects, activeProjectId, createProject } = get();
		
		// Use provided projectId or fall back to activeProjectId
		const targetProjectId = projectId || activeProjectId;
		
		if (targetProjectId && projects[targetProjectId]) {
			const project = projects[targetProjectId];
			
			// Use provided chatId or fall back to activeChatId
			const targetChatId = chatId || project.activeChatId;
			
			if (targetChatId && project.chatStores[targetChatId]) {
				return project.chatStores[targetChatId];
			}
			
			// If no active chat or chat not found, return the first available one
			const chatStoreKeys = Object.keys(project.chatStores);
			if (chatStoreKeys.length > 0) {
				return project.chatStores[chatStoreKeys[0]];
			}
		}
		
		// If no active project exists, create a new one
		if (!targetProjectId || !projects[targetProjectId]) {
			console.log('[ProjectStore] No project found, creating new project in getChatStore');
			const newProjectId = createProject("New Project", "Auto-created project");
			
			// Get updated state after project creation
			const updatedState = get();
			const newProject = updatedState.projects[newProjectId];
			if (newProject && newProject.activeChatId && newProject.chatStores[newProject.activeChatId]) {
				return newProject.chatStores[newProject.activeChatId];
			}
		}
		
		return null;
	},
	
	getActiveChatStore: (projectId?: string) => {
		const { projects, activeProjectId, createProject, createChatStore } = get();
		
		const targetProjectId = projectId || activeProjectId;
		
		if (targetProjectId && projects[targetProjectId]) {
			const project = projects[targetProjectId];
			
			if (project.activeChatId && project.chatStores[project.activeChatId]) {
				return project.chatStores[project.activeChatId];
			}
			
			// If project exists but has no chat stores, create one
			const chatStoreKeys = Object.keys(project.chatStores);
			if (chatStoreKeys.length === 0) {
				console.log('[ProjectStore] Project exists but no chat stores found, creating new chat store');
				const newChatId = createChatStore(targetProjectId);
				if (newChatId) {
					const updatedState = get();
					return updatedState.projects[targetProjectId].chatStores[newChatId];
				}
			}
			
			// If there are chat stores but no active one, return the first available
			if (chatStoreKeys.length > 0) {
				return project.chatStores[chatStoreKeys[0]];
			}
		}
		
		// If no active project exists or no targetProjectId, create a new project
		if (!targetProjectId || !projects[targetProjectId]) {
			console.log('[ProjectStore] No active project found, creating new project');
			const newProjectId = createProject("New Project", "Auto-created project");
			// Get updated state after project creation
			const updatedState = get();
			const newProject = updatedState.projects[newProjectId];
			if (newProject && newProject.activeChatId && newProject.chatStores[newProject.activeChatId]) {
				return newProject.chatStores[newProject.activeChatId];
			}
		}
		
		return null;
	},
	
	// Project-level queued messages management
	addQueuedMessage: (projectId: string, content: string, attaches: File[]) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return null;
		}

		const new_task_id = generateUniqueId();
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					queuedMessages: [
						...state.projects[projectId].queuedMessages,
						{
							task_id: new_task_id,
							content,
							timestamp: Date.now(),
							attaches: [...attaches]
						}
					],
					updatedAt: Date.now()
				}
			}
		}));

		return new_task_id;
	},
	
	removeQueuedMessage: (projectId: string, task_id: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					queuedMessages: state.projects[projectId].queuedMessages.filter(m => m.task_id !== task_id),
					updatedAt: Date.now()
				}
			}
		}));
	},
	
	// Method to restore a queued message (for error handling)
	restoreQueuedMessage: (projectId: string, messageData: { task_id: string; content: string; timestamp: number; attaches: File[] }) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		// Check if message already exists to avoid duplicates
		const existingMessage = projects[projectId].queuedMessages.find(m => m.task_id === messageData.task_id);
		if (existingMessage) {
			console.warn(`Message with task_id ${messageData.task_id} already exists`);
			return;
		}
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					queuedMessages: [
						...state.projects[projectId].queuedMessages,
						messageData
					],
					updatedAt: Date.now()
				}
			}
		}));
	},
	
	clearQueuedMessages: (projectId: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found`);
			return;
		}
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					queuedMessages: [],
					updatedAt: Date.now()
				}
			}
		}));
	},
	
	getAllChatStores: (projectId: string) => {
		const { projects } = get();
		
		if (projects[projectId]) {
			const project = projects[projectId];
			const chatStoreEntries = Object.entries(project.chatStores);
			
			// Sort by creation timestamp (oldest first)
			return chatStoreEntries
				.map(([chatId, chatStore]) => ({
					chatId,
					chatStore,
					createdAt: project.chatStoreTimestamps?.[chatId] || 0
				}))
				.sort((a, b) => a.createdAt - b.createdAt)
				.map(({ chatId, chatStore }) => ({
					chatId,
					chatStore
				}));
		}
		
		return [];
	},
	
	getAllProjects: () => {
		const { projects } = get();
		return Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);
	},
	
	getProjectById: (projectId: string) => {
		const { projects } = get();
		const project = projects[projectId] || null;
		
		// Ensure backwards compatibility - add queuedMessages if it doesn't exist
		if (project && !project.queuedMessages) {
			project.queuedMessages = [];
		}
		
		// Ensure backwards compatibility - add chatStoreTimestamps if it doesn't exist
		if (project && !project.chatStoreTimestamps) {
			project.chatStoreTimestamps = {};
			// Initialize timestamps for existing chat stores with project creation time
			Object.keys(project.chatStores).forEach(chatId => {
				project.chatStoreTimestamps[chatId] = project.createdAt;
			});
		}
		
		return project;
	},

	getProjectTotalTokens: (projectId: string) => {
		const { projects } = get();
		const project = projects[projectId];
		
		if (!project) {
			console.warn(`Project ${projectId} not found for token calculation`);
			return 0;
		}
		
		let totalTokens = 0;
		
		// Iterate through all chat stores in the project
		Object.values(project.chatStores).forEach(chatStore => {
			if (chatStore && chatStore.getState) {
				const chatState = chatStore.getState();
				// Iterate through all tasks in the chat store
				Object.values(chatState.tasks).forEach(task => {
					if (task && typeof task.tokens === 'number') {
						totalTokens += task.tokens;
					}
				});
			}
		});
		
		return totalTokens;
	},

	setHistoryId: (projectId: string, historyId: string) => {
		const { projects } = get();
		
		if (!projects[projectId]) {
			console.warn(`Project ${projectId} not found for setting history ID`);
			return;
		}
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					metadata: {
						...state.projects[projectId].metadata,
						historyId
					},
					updatedAt: Date.now()
				}
			}
		}));
	},

	getHistoryId: (projectId: string | null) => {
		if(!projectId) {
			console.warn(`Project id is null for getting history ID`);
			return null;	
		}

		const { projects } = get();
		const project = projects[projectId];
		
		if (!project) {
			console.warn(`Project ${projectId} not found for getting history ID`);
			return null;
		}
		
		return project.metadata?.historyId || null;
	}
}));

export const useProjectStore = projectStore;
export type { Project, ProjectStore };