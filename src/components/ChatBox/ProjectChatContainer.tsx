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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { usePageTabStore } from '@/store/pageTabStore';
import { AnimatePresence } from 'framer-motion';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ProjectSection } from './ProjectSection';

interface ProjectChatContainerProps {
  className?: string;
  /** Scroll viewport lives in ChatBox (full width) so the scrollbar sits on the panel edge. */
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Bottom padding so scrolled content clears the fixed BottomBox overlay (px); measured in ChatBox. */
  scrollBottomInsetPx: number;
  onSkip: () => void;
  isPauseResumeLoading: boolean;
}

export const ProjectChatContainer: React.FC<ProjectChatContainerProps> = ({
  className = '',
  scrollContainerRef,
  scrollBottomInsetPx,
  onSkip,
  isPauseResumeLoading,
}) => {
  const { projectStore, chatStore } = useChatStoreAdapter();
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);
  const [lastMessageCount, setLastMessageCount] = useState(0);

  // Get all chat stores for the active project
  const activeProjectId = projectStore.activeProjectId;
  const chatStores = useMemo(
    () =>
      activeProjectId ? projectStore.getAllChatStores(activeProjectId) : [],
    [activeProjectId, projectStore]
  );

  // Extract messages array to avoid complex expression in dependency array
  const activeTaskId = chatStore?.activeTaskId as string;
  const messages = useMemo(
    () => chatStore?.tasks[activeTaskId]?.messages || [],
    [chatStore, activeTaskId]
  );

  // Scroll to bottom function
  const scrollToBottom = useCallback(() => {
    if (!scrollContainerRef.current) return;
    setTimeout(() => {
      const root = scrollContainerRef.current;
      if (!root) return;
      root.scrollTo({
        top: root.scrollHeight,
        behavior: 'smooth',
      });
    }, 100);
  }, [scrollContainerRef]);

  // Monitor for new user messages and auto-scroll
  useEffect(() => {
    if (!chatStore || !activeProjectId) return;

    if (!activeTaskId) return;

    const task = chatStore.tasks[activeTaskId];
    if (!task) return;

    const currentMessageCount = messages.length;

    // Check if a new user message was added
    if (currentMessageCount > lastMessageCount) {
      const lastMessage = messages[messages.length - 1];

      // If the last message is from user, scroll to bottom
      if (lastMessage && lastMessage.role === 'user') {
        scrollToBottom();
      }
    }

    // Use setTimeout to defer state update and avoid cascading renders
    setTimeout(() => {
      setLastMessageCount(currentMessageCount);
    }, 0);
  }, [
    messages,
    lastMessageCount,
    scrollToBottom,
    activeProjectId,
    chatStore,
    activeTaskId,
  ]);

  // Reset message count when active task changes
  useEffect(() => {
    // Use setTimeout to defer state update and avoid cascading renders
    setTimeout(() => {
      setLastMessageCount(0);
    }, 0);
  }, [chatStore?.activeTaskId]);

  // Intersection Observer for scroll-based animations
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const queryId = entry.target.getAttribute('data-query-id');
            if (queryId) {
              setActiveQueryId(queryId);
            }
          }
        });
      },
      {
        root,
        rootMargin: '-20% 0px -60% 0px', // Trigger when query is in upper portion
        threshold: 0.1,
      }
    );

    const queryGroups = root.querySelectorAll('[data-query-id]');
    queryGroups.forEach((group) => observer.observe(group));

    return () => {
      queryGroups.forEach((group) => observer.unobserve(group));
    };
  }, [chatStores, scrollContainerRef]);

  // Scroll to a specific query group when triggered from the sidebar
  const scrollToQueryId = usePageTabStore((s) => s.scrollToQueryId);
  const setScrollToQueryId = usePageTabStore((s) => s.setScrollToQueryId);

  useEffect(() => {
    if (!scrollToQueryId || !scrollContainerRef.current) return;

    const el = scrollContainerRef.current.querySelector(
      `[data-query-id="${scrollToQueryId}"]`
    );
    if (el) {
      const container = scrollContainerRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollOffset = elRect.top - containerRect.top + container.scrollTop;
      container.scrollTo({ top: scrollOffset, behavior: 'smooth' });
    }

    setScrollToQueryId(null);
  }, [scrollToQueryId, setScrollToQueryId]);

  return (
    <div className={`relative z-10 w-full ${className}`}>
      <div
        className="pl-3 pr-1 pt-0 mx-auto w-full max-w-[600px]"
        style={{ paddingBottom: scrollBottomInsetPx }}
      >
        <AnimatePresence mode="popLayout">
          {chatStores.map(({ chatId, chatStore }) => {
            const chatState = chatStore.getState();
            const activeTaskId = chatState.activeTaskId;

            if (!activeTaskId || !chatState.tasks[activeTaskId]) {
              return null;
            }

            const task = chatState.tasks[activeTaskId];
            const messages = task.messages || [];

            // Only render if there are actual user messages (not just empty or system messages)
            const hasUserMessages = messages.some(
              (msg: any) => msg.role === 'user' && msg.content
            );

            if (!hasUserMessages) {
              return null;
            }

            return (
              <ProjectSection
                key={chatId}
                chatId={chatId}
                chatStore={chatStore}
                activeQueryId={activeQueryId}
                onQueryActive={setActiveQueryId}
                onSkip={onSkip}
                isPauseResumeLoading={isPauseResumeLoading}
              />
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};
