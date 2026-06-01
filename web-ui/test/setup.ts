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

import '@testing-library/jest-dom';
import { vi } from 'vitest';

const authStoreMock = vi.hoisted(() => {
  type AuthState = Record<string, unknown> & {
    setAuth: (auth: Record<string, unknown>) => void;
    logout: () => void;
    setAppearance: (appearance: string) => void;
    setAppearanceMode: (appearanceMode: string) => void;
    setColorThemeForMode: (mode: string, colorThemeId: string) => void;
    setWorkspaceMainBackground: (background: string) => void;
    setLanguage: (language: string) => void;
    setModelType: (modelType: string) => void;
    setHasModelConfigured: (hasModelConfigured: boolean) => void;
    setInitState: (initState: string) => void;
    setIsFirstLaunch: (isFirstLaunch: boolean) => void;
  };

  const state: AuthState = {
    token: null,
    username: null,
    email: null,
    user_id: null,
    modelType: 'cloud',
    hasModelConfigured: true,
    initState: 'done',
    isFirstLaunch: false,
    appearance: 'light',
    appearanceMode: 'light',
    lightColorThemeId: 'eigent',
    darkColorThemeId: 'eigent',
    customThemeCatalog: { light: {}, dark: {} },
    language: 'en-US',
    workspaceMainBackground: 'empty',
    workerListData: [],
    setAuth: (auth) => {
      Object.assign(state, auth);
    },
    logout: () => {
      Object.assign(state, {
        token: null,
        username: null,
        email: null,
        user_id: null,
      });
    },
    setAppearance: (appearance) => {
      state.appearance = appearance;
      state.appearanceMode = appearance;
    },
    setAppearanceMode: (appearanceMode) => {
      state.appearanceMode = appearanceMode;
      if (appearanceMode !== 'system') {
        state.appearance = appearanceMode;
      }
    },
    setColorThemeForMode: (mode, colorThemeId) => {
      if (mode === 'dark') {
        state.darkColorThemeId = colorThemeId;
      } else {
        state.lightColorThemeId = colorThemeId;
      }
    },
    setWorkspaceMainBackground: (workspaceMainBackground) => {
      state.workspaceMainBackground = workspaceMainBackground;
    },
    setLanguage: (language) => {
      state.language = language;
    },
    setModelType: (modelType) => {
      state.modelType = modelType;
    },
    setHasModelConfigured: (hasModelConfigured) => {
      state.hasModelConfigured = hasModelConfigured;
    },
    setInitState: (initState) => {
      state.initState = initState;
    },
    setIsFirstLaunch: (isFirstLaunch) => {
      state.isFirstLaunch = isFirstLaunch;
    },
  };

  const useAuthStore = (selector?: (state: AuthState) => unknown) =>
    selector ? selector(state) : state;

  useAuthStore.getState = () => state;
  useAuthStore.setState = (
    partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>)
  ) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    Object.assign(state, patch);
  };
  useAuthStore.subscribe = () => () => {};

  return { state, useAuthStore };
});

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => authStoreMock.state,
  useAuthStore: authStoreMock.useAuthStore,
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
