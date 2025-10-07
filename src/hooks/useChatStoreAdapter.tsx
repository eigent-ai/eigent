import { ChatStore } from '@/store/chatStore';
import { ProjectStore, useProjectStore } from '@/store/projectStore';
import React, { useEffect, useMemo, useState } from 'react'

const useChatStoreAdapter = ():{
  projectStore: ProjectStore, 
  chatStore: ChatStore
} => {
  const projectStore = useProjectStore();
    
  // Get the active chat store from project store
  // This creates a hook-like interface for the vanilla store
  const activeChatStore = projectStore.getActiveChatStore();
  
  // Create a state subscription to make the component reactive
  const [chatState, setChatState] = useState(() => 
    activeChatStore ? activeChatStore.getState() : null
  );
  
  useEffect(() => {
    if (!activeChatStore) {
      setChatState(null);
      return;
    }

    // Subscribe to store changes
    const unsubscribe = activeChatStore.subscribe((state) => {
      setChatState(state);
    });
    // Set initial state
    setChatState(activeChatStore.getState());
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
      }, {} as any)
    };
  }, [activeChatStore, chatState]);

  return {
    projectStore,
    chatStore
  }
}

export default useChatStoreAdapter
