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

import type { SessionWindowTarget } from '@/lib/sessionWindows';
import { useAuthStore } from '@/store/authStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useGlobalStore } from '@/store/globalStore';
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';
import { useSkillsStore } from '@/store/skillsStore';
import { useSpaceOverviewStore } from '@/store/spaceOverviewStore';
import { useSpaceStore } from '@/store/spaceStore';

interface PersistedStore {
  persist: {
    getOptions: () => {
      name?: string;
      storage?: {
        getItem: (name: string) => unknown;
        setItem: (name: string, value: never) => unknown;
        removeItem: (name: string) => unknown;
      };
    };
    setOptions: (options: { storage: unknown }) => void;
    rehydrate: () => Promise<void> | void;
  };
}

const PERSISTED_STORES = [
  useAuthStore,
  useCloudModelStore,
  useGlobalStore,
  useModelVisibilityStore,
  usePageTabStore,
  useSessionSplitViewStore,
  useSkillsStore,
  useSpaceOverviewStore,
  useSpaceStore,
] as unknown as PersistedStore[];

// Window-local view state that must not follow the main window.
const NOT_FOLLOWED = new Set<unknown>([
  usePageTabStore,
  useSessionSplitViewStore,
]);

/**
 * A Session window reads saved state when it opens and never writes it: the
 * main window is the only writer, so a Session window cannot overwrite the
 * main window's Space, tabs or settings. Changes the main window saves later
 * (sign-in, theme, Space and Session names) are read again as they land.
 */
export function applySessionWindowStoragePolicy(target: SessionWindowTarget) {
  const followed = new Map<string, PersistedStore>();
  for (const store of PERSISTED_STORES) {
    const { name, storage } = store.persist.getOptions();
    if (!storage) continue;
    store.persist.setOptions({
      storage: {
        getItem: storage.getItem,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    });
    if (name && !NOT_FOLLOWED.has(store)) followed.set(name, store);
  }

  window.addEventListener('storage', (event) => {
    if (!event.key) return;
    const store = followed.get(event.key);
    if (!store) return;
    void Promise.resolve(store.persist.rehydrate()).then(() => {
      // The saved Space is the main window's; this window keeps its own.
      if (
        (store as unknown) === useSpaceStore &&
        useSpaceStore.getState().activeSpaceId !== target.spaceId
      )
        useSpaceStore.setState({ activeSpaceId: target.spaceId });
    });
  });
}
