import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// type definition
type InitState = 'permissions' | 'carousel' | 'done';
type ModelType = 'cloud' | 'local' | 'custom';
type CloudModelType = 'gemini/gemini-2.5-pro' | 'gemini-2.5-flash' | 'gpt-4.1-mini' | 'gpt-4.1' | 'claude-sonnet-4-5' | 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022' | 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano';

// auth info interface
interface AuthInfo {
	token: string;
	username: string;
	email: string;
	user_id: number;
}

// auth state interface
interface AuthState {
	// user auth info
	token: string | null;
	username: string | null;
	email: string | null;
	user_id: number | null;
	
	// application settings
	appearance: string;
	language: string;
	isFirstLaunch: boolean;
	modelType: ModelType;
	cloud_model_type: CloudModelType;
	initState: InitState;
	
	// shared token
	share_token?: string | null;
	
	// worker list data
	workerListData: { [key: string]: Agent[] };
	
	// auth related methods
	setAuth: (auth: AuthInfo) => void;
	logout: () => void;
	
	// set related methods
	setAppearance: (appearance: string) => void;
	setLanguage: (language: string) => void;
	setInitState: (initState: InitState) => void;
	setModelType: (modelType: ModelType) => void;
	setCloudModelType: (cloud_model_type: CloudModelType) => void;
	setIsFirstLaunch: (isFirstLaunch: boolean) => void;
	
	// worker related methods
	setWorkerList: (workerList: Agent[]) => void;
	checkAgentTool: (tool: string) => void;
}

// create store
const authStore = create<AuthState>()(
	persist(
		(set, get) => ({
			// initial state
			token: null,
			username: null,
			email: null,
			user_id: null,
			appearance: 'light',
			language: 'system',
			isFirstLaunch: true,
			modelType: 'cloud',
			cloud_model_type: 'gpt-4.1',
			initState: 'permissions',
			share_token: null,
			workerListData: {},
			
			// auth related methods
			setAuth: ({ token, username, email, user_id }) =>
				set({ token, username, email, user_id }),
			
			logout: () => 
				set({ 
					token: null, 
					username: null, 
					email: null, 
					user_id: null 
				}),
			
			// set related methods
			setAppearance: (appearance) => set({ appearance }),
			
			setLanguage: (language) => set({ language }),
			
			setInitState: (initState) => {
				console.log('set({ initState })', initState);
				set({ initState });
			},
			
			setModelType: (modelType) => set({ modelType }),
			
			setCloudModelType: (cloud_model_type) => set({ cloud_model_type }),
			
			setIsFirstLaunch: (isFirstLaunch) => set({ isFirstLaunch }),
			
			// worker related methods
			setWorkerList: (workerList) => {
				const { email } = get();
				set((state) => ({
					...state,
					workerListData: {
						...state.workerListData,
						[email as string]: workerList
					}
				}));
			},
			
			checkAgentTool: (tool) => {
				const { email } = get();
				set((state) => {
					const currentEmail = email as string;
					const originalList = state.workerListData[currentEmail] ?? [];
					
					console.log("tool!!!", tool);
					
					const updatedList = originalList
						.map((worker) => {
							const filteredTools = worker.tools?.filter((t) => t !== tool) ?? [];
							console.log("filteredTools", filteredTools);
							return { ...worker, tools: filteredTools };
						})
						.filter((worker) => worker.tools.length > 0);
					
					console.log("updatedList", updatedList);
					
					return {
						...state,
						workerListData: {
							...state.workerListData,
							[currentEmail]: updatedList
						}
					};
				});
			}
		}),
		{
			name: 'auth-storage',
			partialize: (state) => ({
				token: state.token,
				username: state.username,
				email: state.email,
				user_id: state.user_id,
				appearance: state.appearance,
				language: state.language,
				modelType: state.modelType,
				cloud_model_type: state.cloud_model_type,
				initState: state.initState,
				isFirstLaunch: state.isFirstLaunch,
				workerListData: state.workerListData,
			}),
		}
	)
);

// export Hook version for components
export const useAuthStore = authStore;

// export non-Hook version for non-components
export const getAuthStore = () => authStore.getState();

// constant definition
const EMPTY_LIST: Agent[] = [];

// worker list Hook
export const useWorkerList = (): Agent[] => {
	const { email, workerListData } = getAuthStore();
	const workerList = workerListData[email as string];
	return workerList ?? EMPTY_LIST;
};