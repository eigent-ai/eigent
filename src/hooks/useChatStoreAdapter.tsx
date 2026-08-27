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

import { ChatStore } from '@/store/chatStore';
import {
  type ProjectRuntimeStore,
  useProjectRuntimeStore,
} from '@/store/projectRuntimeStore';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

const useChatStoreAdapter = (): {
  projectStore: ProjectRuntimeStore;
  // TODO(PR-X3): This can be null while a Space is selected but no Project
  // runtime is active. Existing legacy consumers still assume a ChatStore;
  // finish nullable typing when projectRuntimeStore is fully split.
  chatStore: ChatStore;
} => {
  const projectStore = useProjectRuntimeStore();

  // Get the active chat store from project store
  // This creates a hook-like interface for the vanilla store
  const activeChatStore = projectStore.getActiveChatStore();

  // Read the newly selected store synchronously. The previous effect-based
  // bridge rendered one frame with the new Project id but the old Project's
  // large chat state, then rendered the new state again after the effect ran.
  // Besides being observably inconsistent, that doubled the expensive
  // markdown/work-log render on every Project switch.
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      activeChatStore?.subscribe(onStoreChange) ?? (() => undefined),
    [activeChatStore]
  );
  const getSnapshot = useCallback(
    () => activeChatStore?.getState() ?? null,
    [activeChatStore]
  );
  const chatState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Create a chatStore-like object that mimics the original interface
  const chatStore = useMemo(() => {
    if (!activeChatStore || !chatState) return null;

    // Get the store methods (actions) from the vanilla store
    const storeMethods = activeChatStore.getState();

    return {
      ...chatState,
      // Bind store methods to maintain proper context
      ...Object.keys(storeMethods).reduce((acc, key) => {
        const value = (storeMethods as any)[key];
        if (typeof value === 'function') {
          (acc as any)[key] = value.bind(storeMethods);
        }
        return acc;
      }, {} as any),
    };
  }, [activeChatStore, chatState]);

  return {
    projectStore,
    chatStore,
  };
};

export default useChatStoreAdapter;
