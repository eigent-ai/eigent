import { create } from 'zustand';
import { generateUniqueId } from "@/lib";
import { useChatStore, VanillaChatStore } from './chatStore';

interface Project {
	id: string;
	name: string;
	description?: string;
	createdAt: number;
	updatedAt: number;
	chatStore: VanillaChatStore | null; // Serialized state of the chatStore for this project
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
	createProject: (name: string, description?: string) => string;
	setActiveProject: (projectId: string) => void;
	removeProject: (projectId: string) => void;
	updateProject: (projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void;
	
	// Chat store state management
	saveChatStore: (projectId: string, state: VanillaChatStore) => void;
	getChatStore: (projectId: string) => VanillaChatStore | null;
	
	// Utility methods
	getAllProjects: () => Project[];
	getProjectById: (projectId: string) => Project | null;
}


const projectStore = create<ProjectStore>()((set, get) => ({
	activeProjectId: null,
	projects: {},
	
	createProject: (name: string, description?: string) => {
		const projectId = generateUniqueId();
		const now = Date.now();
		
		// Create new project with default chat store state
		const newProject: Project = {
			id: projectId,
			name,
			description,
			createdAt: now,
			updatedAt: now,
			chatStore: useChatStore(),
			metadata: {
				status: 'active'
			}
		};
		
		set((state) => ({
			projects: {
				...state.projects,
				[projectId]: newProject
			},
			activeProjectId: projectId
		}));
		
		return projectId;
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
	
	saveChatStore: (projectId: string, state: VanillaChatStore) => {
		const { projects } = get();
		
		if (projects[projectId]) {
			set((currentState) => ({
				projects: {
					...currentState.projects,
					[projectId]: {
						...currentState.projects[projectId],
						chatStore: state
					}
				}
			}));
		}
	},
	
	getChatStore: (projectId: string) => {
		const { projects } = get();
		const project = projects[projectId];
		return project?.chatStore || null;
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