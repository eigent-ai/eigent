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

import i18next from 'i18next';
import { create } from 'zustand';

export type DesktopUpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  progress: number;
  newVersion: string | null;
  errorMessage: string | null;
  setChecking: () => void;
  setAvailable: (newVersion?: string | null) => void;
  setIdle: () => void;
  setDownloading: () => void;
  setProgress: (progress: number) => void;
  setDownloaded: () => void;
  setInstalling: () => void;
  setError: (message?: string | null) => void;
}

const initialState = {
  phase: 'idle' as DesktopUpdatePhase,
  progress: 0,
  newVersion: null,
  errorMessage: null,
};

export const useDesktopUpdateStore = create<DesktopUpdateState>((set) => ({
  ...initialState,
  setChecking: () =>
    set((state) => (state.phase === 'idle' ? { phase: 'checking' } : state)),
  setAvailable: (newVersion) =>
    set((state) => {
      if (state.phase === 'downloaded' || state.phase === 'installing') {
        return state;
      }
      return {
        phase: 'available',
        progress: 0,
        newVersion: newVersion ?? state.newVersion,
        errorMessage: null,
      };
    }),
  setIdle: () => set(initialState),
  setDownloading: () =>
    set({ phase: 'downloading', progress: 0, errorMessage: null }),
  setProgress: (progress) =>
    set((state) => ({
      phase: state.phase === 'downloaded' ? 'downloaded' : 'downloading',
      progress: Math.min(100, Math.max(0, progress)),
      errorMessage: null,
    })),
  setDownloaded: () =>
    set({ phase: 'downloaded', progress: 100, errorMessage: null }),
  setInstalling: () => set({ phase: 'installing', errorMessage: null }),
  setError: (message) =>
    set({
      phase: 'error',
      errorMessage:
        message ??
        i18next.t('layout.update-failed', { defaultValue: 'Update failed' }),
    }),
}));

export function resetDesktopUpdateStore() {
  useDesktopUpdateStore.setState(initialState);
}
