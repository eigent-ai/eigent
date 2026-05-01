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

import {
  DEFAULT_COLOR_THEME_ID,
  getRecommendedContrast,
} from '@/lib/themeTokens/catalog';
import type { Mode, ThemeCatalog, ThemeSeed } from '@/lib/themeTokens/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// type definition
type InitState = 'carousel' | 'done';
type ModelType = 'cloud' | 'local' | 'custom';
type PreferredIDE = 'vscode' | 'cursor' | 'system';
type AppearanceMode = Mode | 'system';

/** Main workspace panel background (Workforce + Session tabs only). */
export type WorkspaceMainBackground =
  | 'empty'
  | 'dots'
  | 'blocks'
  | 'ruled'
  | 'dotted'
  | 'dashed';
export type CloudModelType =
  | 'gemini-3.1-pro-preview'
  | 'gemini-3-pro-preview'
  | 'gemini-3-flash-preview'
  | 'claude-haiku-4-5'
  | 'claude-sonnet-4-5'
  | 'claude-sonnet-4-6'
  | 'claude-opus-4-6'
  | 'claude-opus-4-7'
  | 'gpt-5.4'
  | 'gpt-5.5'
  | 'gpt-5-mini'
  | 'deepseek-v4-pro'
  | 'minimax_m2_7';

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
  appearance: Mode;
  appearanceMode: AppearanceMode;
  lightColorThemeId: string;
  darkColorThemeId: string;
  customThemeCatalog: ThemeCatalog;
  themeContrast: number;
  language: string;
  isFirstLaunch: boolean;
  modelType: ModelType;
  cloud_model_type: CloudModelType;
  initState: InitState;

  // IDE preference
  preferredIDE: PreferredIDE;

  /** Pattern behind the main workspace area (Workforce / Session). */
  workspaceMainBackground: WorkspaceMainBackground;

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
  setAppearanceMode: (mode: AppearanceMode) => void;
  setResolvedAppearance: (appearance: Mode) => void;
  setColorThemeForMode: (mode: Mode, colorThemeId: string) => void;
  upsertCustomThemeTemplate: (
    mode: Mode,
    themeId: string,
    seed: ThemeSeed
  ) => void;
  removeCustomThemeTemplate: (mode: Mode, themeId: string) => void;
  setThemeContrast: (contrast: number) => void;
  setLanguage: (language: string) => void;
  setInitState: (initState: InitState) => void;
  setModelType: (modelType: ModelType) => void;
  setCloudModelType: (cloud_model_type: CloudModelType) => void;
  setIsFirstLaunch: (isFirstLaunch: boolean) => void;
  setPreferredIDE: (ide: PreferredIDE) => void;
  setWorkspaceMainBackground: (value: WorkspaceMainBackground) => void;

  // worker related methods
  setWorkerList: (workerList: Agent[]) => void;
  checkAgentTool: (tool: string) => void;
}

// random default model selection
const getRandomDefaultModel = (): CloudModelType => {
  const models: CloudModelType[] = ['gpt-5.5', 'gpt-5.4', 'gpt-5-mini'];
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
      appearanceMode: 'light',
      lightColorThemeId: DEFAULT_COLOR_THEME_ID,
      darkColorThemeId: DEFAULT_COLOR_THEME_ID,
      customThemeCatalog: {
        light: {},
        dark: {},
      },
      themeContrast: getRecommendedContrast(),
      language: 'system',
      isFirstLaunch: true,
      modelType: 'cloud',
      cloud_model_type: getRandomDefaultModel(),
      preferredIDE: 'system',
      workspaceMainBackground: 'empty',
      initState: 'carousel',
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
      setAppearance: (appearance) =>
        set(() => {
          if (appearance === 'transparent') {
            return { appearance: 'light', appearanceMode: 'light' };
          }

          if (appearance === 'system') {
            return { appearanceMode: 'system' };
          }

          const normalized: Mode = appearance === 'dark' ? 'dark' : 'light';
          return { appearance: normalized, appearanceMode: normalized };
        }),

      setAppearanceMode: (appearanceMode) => set({ appearanceMode }),

      setResolvedAppearance: (appearance) => set({ appearance }),

      setColorThemeForMode: (mode, colorThemeId) =>
        set(
          mode === 'dark'
            ? { darkColorThemeId: colorThemeId }
            : { lightColorThemeId: colorThemeId }
        ),

      upsertCustomThemeTemplate: (mode, themeId, seed) =>
        set((state) => ({
          customThemeCatalog: {
            ...state.customThemeCatalog,
            [mode]: {
              ...state.customThemeCatalog[mode],
              [themeId]: {
                id: themeId,
                mode,
                seed,
              },
            },
          },
        })),

      removeCustomThemeTemplate: (mode, themeId) =>
        set((state) => {
          const modeCatalog = state.customThemeCatalog[mode] ?? {};
          if (!modeCatalog[themeId]) return {};

          const { [themeId]: _removed, ...rest } = modeCatalog;
          return {
            customThemeCatalog: {
              ...state.customThemeCatalog,
              [mode]: rest,
            },
          };
        }),

      setThemeContrast: (contrast) =>
        set({
          themeContrast: Math.min(100, Math.max(0, Math.round(contrast))),
        }),

      setLanguage: (language) => set({ language }),

      setInitState: (initState) => {
        console.log('set({ initState })', initState);
        set({ initState });
      },

      setModelType: (modelType) => set({ modelType }),

      setCloudModelType: (cloud_model_type) => set({ cloud_model_type }),

      setIsFirstLaunch: (isFirstLaunch) => set({ isFirstLaunch }),

      setPreferredIDE: (preferredIDE) => set({ preferredIDE }),

      setWorkspaceMainBackground: (workspaceMainBackground) =>
        set({ workspaceMainBackground }),

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
      version: 6,
      migrate: (persistedState, _version) => {
        const s = persistedState as
          | {
              appearance?: string;
              appearanceMode?: AppearanceMode;
              customThemeCatalog?: Partial<ThemeCatalog>;
              workspaceMainBackground?: string;
            }
          | undefined;
        if (!s) return persistedState as typeof persistedState;

        const rawWmb = s.workspaceMainBackground;
        let workspaceMainBackground: WorkspaceMainBackground = 'empty';
        if (
          rawWmb === 'dots' ||
          rawWmb === 'blocks' ||
          rawWmb === 'ruled' ||
          rawWmb === 'dotted' ||
          rawWmb === 'dashed'
        ) {
          workspaceMainBackground = rawWmb;
        } else if (rawWmb === 'margin-ruled') {
          workspaceMainBackground = 'ruled';
        } else if (rawWmb === 'empty' || rawWmb === 'none') {
          workspaceMainBackground = 'empty';
        }

        const normalizedAppearance: Mode =
          s.appearance === 'dark' ? 'dark' : 'light';
        const normalizedAppearanceMode: AppearanceMode =
          s.appearanceMode === 'system' || s.appearanceMode === 'dark'
            ? s.appearanceMode
            : normalizedAppearance;
        const normalizedCustomCatalog: ThemeCatalog = {
          light: s.customThemeCatalog?.light ?? {},
          dark: s.customThemeCatalog?.dark ?? {},
        };

        if (s.appearance === 'transparent') {
          return {
            ...s,
            appearance: 'light',
            appearanceMode: 'light',
            customThemeCatalog: normalizedCustomCatalog,
            workspaceMainBackground,
          };
        }
        return {
          ...s,
          appearance: normalizedAppearance,
          appearanceMode: normalizedAppearanceMode,
          customThemeCatalog: normalizedCustomCatalog,
          workspaceMainBackground,
        } as typeof persistedState;
      },
      partialize: (state) => ({
        token: state.token,
        username: state.username,
        email: state.email,
        user_id: state.user_id,
        appearance: state.appearance,
        appearanceMode: state.appearanceMode,
        lightColorThemeId: state.lightColorThemeId,
        darkColorThemeId: state.darkColorThemeId,
        customThemeCatalog: state.customThemeCatalog,
        themeContrast: state.themeContrast,
        language: state.language,
        modelType: state.modelType,
        cloud_model_type: state.cloud_model_type,
        initState: state.initState,
        isFirstLaunch: state.isFirstLaunch,
        preferredIDE: state.preferredIDE,
        workspaceMainBackground: state.workspaceMainBackground,
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
