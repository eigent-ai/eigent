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
import { ProjectStore, useProjectStore } from '@/store/projectStore';
import { useEffect, useMemo, useReducer } from 'react';

type ChatStateAction =
  | { type: 'SET_STORE'; payload: ChatStore | null }
  | { type: 'UPDATE_STATE'; payload: ChatStore };

const chatStateReducer = (
  state: ChatStore | null,
  action: ChatStateAction
): ChatStore | null => {
  switch (action.type) {
    case 'SET_STORE':
      return action.payload;
    case 'UPDATE_STATE':
      // Only update if the state actually changed
      if (state === action.payload) return state;
      return action.payload;
    default:
      return state;
  }
};

const useChatStoreAdapter = (): {
  projectStore: ProjectStore;
  chatStore: ChatStore;
} => {
  const projectStore = useProjectStore();

  // Get the active chat store from project store
  // This creates a hook-like interface for the vanilla store
  const activeChatStore = projectStore.getActiveChatStore();

  // Create a state subscription to make the component reactive
  const [chatState, dispatch] = useReducer(
    chatStateReducer,
    activeChatStore ? activeChatStore.getState() : null
  );

  useEffect(() => {
    if (!activeChatStore) {
      dispatch({ type: 'SET_STORE', payload: null });
      return;
    }

    // Subscribe to store changes
    const unsubscribe = activeChatStore.subscribe((state: ChatStore) => {
      dispatch({ type: 'UPDATE_STATE', payload: state });
    });

    // Set initial state
    const initialState = activeChatStore.getState();
    dispatch({ type: 'UPDATE_STATE', payload: initialState });

    return unsubscribe;
  }, [activeChatStore]);

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
