// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// type definition
type InitState = 'permissions' | 'carousel' | 'done';
type ModelType = 'cloud' | 'local' | 'custom';
type PreferredIDE = 'vscode' | 'cursor' | 'system';
type CloudModelType =
  | 'gemini-3-pro-preview'
  | 'gemini-3-flash-preview'
  | 'gpt-4.1-mini'
  | 'gpt-4.1'
  | 'claude-sonnet-4-5'
  | 'gpt-5'
  | 'gpt-5.1'
  | 'gpt-5.2'
  | 'gpt-5-mini'
  | 'minimax_m2_5';

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
  // Subscription models always route through cloud models
  use_image_analysis: boolean;

  // IDE preference
  preferredIDE: PreferredIDE;

  // shared token
  share_token?: string | null;

  // local proxy value recorded at login
  localProxyValue?: string | null;

  // worker list data
  workerListData: { [key: string]: Agent[] };

  // auth related methods
  setAuth: (auth: AuthInfo) => void;
  logout: () => void;
  setLocalProxyValue: (value: string | null) => void;

  // set related methods
  setAppearance: (appearance: string) => void;
  setLanguage: (language: string) => void;
  setInitState: (initState: InitState) => void;
  setModelType: (modelType: ModelType) => void;
  setCloudModelType: (cloud_model_type: CloudModelType) => void;
  setIsFirstLaunch: (isFirstLaunch: boolean) => void;
  setPreferredIDE: (ide: PreferredIDE) => void;
  setUseImageAnalysis: (use_image_analysis: boolean) => void;

  // worker related methods
  setWorkerList: (workerList: Agent[]) => void;
  checkAgentTool: (tool: string) => void;
}

// random default model selection
const getRandomDefaultModel = (): CloudModelType => {
  const models: CloudModelType[] = ['gpt-5.2', 'gpt-5.1', 'gpt-4.1'];
  return models[Math.floor(Math.random() * models.length)];
};

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
      cloud_model_type: getRandomDefaultModel(),
      preferredIDE: 'system',
      initState: 'permissions',
      use_image_analysis: false,
      share_token: null,
      localProxyValue: null,
      workerListData: {},

      // auth related methods
      setAuth: ({ token, username, email, user_id }) =>
        set({ token, username, email, user_id }),

      logout: () =>
        set({
          token: null,
          username: null,
          email: null,
          user_id: null,
          initState: 'carousel',
          localProxyValue: null,
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

      setPreferredIDE: (preferredIDE) => set({ preferredIDE }),

      setUseImageAnalysis: (use_image_analysis) => set({ use_image_analysis }),

      setLocalProxyValue: (value) => set({ localProxyValue: value }),

      // worker related methods
      setWorkerList: (workerList) => {
        const { email } = get();
        set((state) => ({
          ...state,
          workerListData: {
            ...state.workerListData,
            [email as string]: workerList,
          },
        }));
      },

      checkAgentTool: (tool) => {
        const { email } = get();
        set((state) => {
          const currentEmail = email as string;
          const originalList = state.workerListData[currentEmail] ?? [];

          console.log('tool!!!', tool);

          const updatedList = originalList
            .map((worker) => {
              const filteredTools =
                worker.tools?.filter((t) => t !== tool) ?? [];
              console.log('filteredTools', filteredTools);
              return { ...worker, tools: filteredTools };
            })
            .filter((worker) => worker.tools.length > 0);

          console.log('updatedList', updatedList);

          return {
            ...state,
            workerListData: {
              ...state.workerListData,
              [currentEmail]: updatedList,
            },
          };
        });
      },
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
        preferredIDE: state.preferredIDE,
        localProxyValue: state.localProxyValue,
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

// worker list - use in React components
export const useWorkerList = (): Agent[] => {
  const { email, workerListData } = getAuthStore();
  const workerList = workerListData[email as string];
  return workerList ?? EMPTY_LIST;
};

// worker list - use outside React (e.g. in store actions)
export const getWorkerList = (): Agent[] => {
  const { email, workerListData } = getAuthStore();
  return workerListData[email as string] ?? EMPTY_LIST;
};
