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
	activeChatId: string | null; // ID of the currently active chat store
	metadata?: {
		tags?: string[];
		priority?: 'low' | 'medium' | 'high';
		status?: 'active' | 'completed' | 'archived';
	};
}

interface ProjectStore {
	activeProjectId: string | null;
	projects: { [projectId: string]: Project };
	
	// Project management
	createProject: (name: string, description?: string, projectId?:string, type?:ProjectType) => string;
	setActiveProject: (projectId: string) => void;
	removeProject: (projectId: string) => void;
	updateProject: (projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void;
	replayProject: (taskIds: string[], question?: string, projectId?: string) => string;
	
	// Chat store state management
	createChatStore: (projectId: string, chatName?: string) => string | null;
	setActiveChatStore: (projectId: string, chatId: string) => void;
	removeChatStore: (projectId: string, chatId: string) => void;
	saveChatStore: (projectId: string, chatId: string, state: VanillaChatStore) => void;
	getChatStore: (projectId?: string, chatId?: string) => VanillaChatStore | null;
	getActiveChatStore: (projectId?: string) => VanillaChatStore | null;
	getAllChatStores: (projectId: string) => { [chatId: string]: VanillaChatStore };
	
	// Utility methods
	getAllProjects: () => Project[];
	getProjectById: (projectId: string) => Project | null;
}


const projectStore = create<ProjectStore>()((set, get) => ({
	activeProjectId: null,
	projects: {},
	
	createProject: (name: string, description?: string, projectId?: string, type?:ProjectType) => {
		const targetProjectId = projectId ?? generateUniqueId();
		const now = Date.now();
		
		// Create initial chat store for the project
		const initialChatId = generateUniqueId();
		const initialChatStore = useChatStore();
		
		// Initialize the chat store with a task using the create() function
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
			activeChatId: initialChatId,
			metadata: {
				status: 'active'
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
		
		// Initialize the chat store with a task using the create() function
		newChatStore.getState().create();
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: {
					...state.projects[projectId],
					chatStores: {
						...state.projects[projectId].chatStores,
						[chatId]: newChatStore
					},
					activeChatId: chatId,
					updatedAt: Date.now()
				}
			}
		}));
		
		return chatId;
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
	 * @returns the created project ID
	 */
	replayProject: (taskIds: string[], question: string="Replay task", projectId?: string) => {
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
				projectId
			);
		} else {
			// Create a new project only once
			replayProjectId = createProject(
				`Replay Project ${question}`, 
				`Replayed project with ${taskIds.length} tasks`,
				projectId
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
					await chatStore.getState().replay(taskId, question, 0);
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
		const { projects, activeProjectId, createProject, createChatStore } = get();
		
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
	
	getAllChatStores: (projectId: string) => {
		const { projects } = get();
		
		if (projects[projectId]) {
			return projects[projectId].chatStores;
		}
		
		return {};
	},
	
	getAllProjects: () => {
		const { projects } = get();
		return Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);
	},
	
	getProjectById: (projectId: string) => {
		const { projects } = get();
		return projects[projectId] || null;
	}
}));

export const useProjectStore = projectStore;
export type { Project, ProjectStore };