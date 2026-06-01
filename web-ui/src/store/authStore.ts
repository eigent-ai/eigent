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
  DEFAULT_CONTRAST,
} from '@/lib/themeTokens/catalog';
import type {
  Mode,
  ThemeCatalogV2,
  ThemeSeedV2,
} from '@/lib/themeTokens/types';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppearanceMode = Mode | 'system';
export type ModelType = 'cloud' | 'local' | 'custom';
export type WorkspaceMainBackground =
  | 'empty'
  | 'dots'
  | 'blocks'
  | 'ruled'
  | 'dotted'
  | 'dashed';

export type WebAgent = {
  agent_id: string;
  name: string;
  type: string;
  tasks?: unknown[];
  tools?: unknown[];
  log?: unknown[];
  activeWebviewIds?: string[];
};

type AuthInfo = {
  token: string;
  username: string;
  email: string;
  user_id: number;
};

export type AuthState = {
  token: string | null;
  username: string | null;
  email: string | null;
  user_id: number | null;
  appearance: Mode;
  appearanceMode: AppearanceMode;
  lightColorThemeId: string;
  darkColorThemeId: string;
  customThemeCatalog: ThemeCatalogV2;
  themeContrast: number;
  language: string;
  modelType: ModelType;
  hasModelConfigured: boolean;
  initState: 'carousel' | 'done';
  isFirstLaunch: boolean;
  workspaceMainBackground: WorkspaceMainBackground;
  workerListData: Record<string, WebAgent[]>;
  setAuth: (auth: AuthInfo) => void;
  logout: () => void;
  setAppearanceMode: (mode: AppearanceMode) => void;
  setResolvedAppearance: (appearance: Mode) => void;
  setColorThemeForMode: (mode: Mode, colorThemeId: string) => void;
  upsertCustomThemeTemplate: (
    mode: Mode,
    themeId: string,
    seed: ThemeSeedV2
  ) => void;
  removeCustomThemeTemplate: (mode: Mode, themeId: string) => void;
  setThemeContrast: (contrast: number) => void;
  setLanguage: (language: string) => void;
  setModelType: (modelType: ModelType) => void;
  setHasModelConfigured: (hasModelConfigured: boolean) => void;
  setInitState: (initState: AuthState['initState']) => void;
  setIsFirstLaunch: (isFirstLaunch: boolean) => void;
  setWorkspaceMainBackground: (value: WorkspaceMainBackground) => void;
  setWorkerList: (workerList: WebAgent[]) => void;
};

const emptyCatalog: ThemeCatalogV2 = { light: {}, dark: {} };

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      username: null,
      email: null,
      user_id: null,
      appearance: 'light',
      appearanceMode: 'system',
      lightColorThemeId: DEFAULT_COLOR_THEME_ID,
      darkColorThemeId: DEFAULT_COLOR_THEME_ID,
      customThemeCatalog: emptyCatalog,
      themeContrast: DEFAULT_CONTRAST,
      language: 'system',
      modelType: 'cloud',
      hasModelConfigured: true,
      initState: 'done',
      isFirstLaunch: false,
      workspaceMainBackground: 'empty',
      workerListData: {},
      setAuth: (auth) => set(auth),
      logout: () =>
        set({
          token: null,
          username: null,
          email: null,
          user_id: null,
        }),
      setAppearanceMode: (appearanceMode) =>
        set((state) => ({
          appearanceMode,
          appearance:
            appearanceMode === 'system' ? state.appearance : appearanceMode,
        })),
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
              [themeId]: { id: themeId, mode, seed },
            },
          },
        })),
      removeCustomThemeTemplate: (mode, themeId) =>
        set((state) => {
          const next = { ...(state.customThemeCatalog[mode] ?? {}) };
          delete next[themeId];
          return {
            customThemeCatalog: {
              ...state.customThemeCatalog,
              [mode]: next,
            },
          };
        }),
      setThemeContrast: (themeContrast) =>
        set({
          themeContrast: Math.min(100, Math.max(0, Math.round(themeContrast))),
        }),
      setLanguage: (language) => set({ language }),
      setModelType: (modelType) => set({ modelType }),
      setHasModelConfigured: (hasModelConfigured) =>
        set({ hasModelConfigured }),
      setInitState: (initState) => set({ initState }),
      setIsFirstLaunch: (isFirstLaunch) => set({ isFirstLaunch }),
      setWorkspaceMainBackground: (workspaceMainBackground) =>
        set({ workspaceMainBackground }),
      setWorkerList: (workerList) => {
        const email = get().email ?? '';
        set((state) => ({
          workerListData: {
            ...state.workerListData,
            [email]: workerList,
          },
        }));
      },
    }),
    {
      name: 'eigent-web-ui-auth',
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
        workspaceMainBackground: state.workspaceMainBackground,
      }),
    }
  )
);

export function getAuthStore() {
  return useAuthStore.getState();
}
