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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  const [, setChatRevision] = useState(0);

  // Get all chat stores for the active project
  const activeProjectId = projectStore.activeProjectId;
  const chatStores = useMemo(
    () =>
      activeProjectId ? projectStore.getAllChatStores(activeProjectId) : [],
    [activeProjectId, projectStore]
  );
  // Defensive dedup: if the same taskId surfaces through more than one
  // chatStore (which can happen during the multi-chatStore -> single-chatStore
  // transition, see PR-X4 in space-frontend-refactor-consolidated-review.md),
  // render it exactly once. The earliest chatStore (sorted by createdAt in
  // getAllChatStores) wins, matching insertion order.
  const taskSections: Array<{
    chatId: string;
    chatStore: (typeof chatStores)[number]['chatStore'];
    taskId: string;
  }> = [];
  const seenTaskIds = new Set<string>();
  for (const { chatId, chatStore } of chatStores) {
    const chatState = chatStore.getState();
    for (const [taskId, task] of Object.entries(chatState.tasks)) {
      if (seenTaskIds.has(taskId)) continue;
      const hasUserMessage = (task.messages || []).some(
        (msg: any) => msg.role === 'user' && msg.content
      );
      if (!hasUserMessage) continue;
      seenTaskIds.add(taskId);
      taskSections.push({ chatId, chatStore, taskId });
    }
  }
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    const scheduleRefresh = () => {
      if (timeoutId) return;
      timeoutId = setTimeout(() => {
        setChatRevision((value) => value + 1);
        timeoutId = null;
      }, 100);
    };
    const unsubscribe = chatStores.map(({ chatStore }) =>
      chatStore.subscribe(scheduleRefresh)
    );
    return () => {
      unsubscribe.forEach((fn) => fn());
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [chatStores]);

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

  // Turn viewport observer — updates which turn is visible in the side panel tabs
  const setSidePanelViewedTurn = usePageTabStore(
    (s) => s.setSidePanelViewedTurn
  );
  const turnObserverRef = useRef<IntersectionObserver | null>(null);
  const visibleTurnScoresRef = useRef(new Map<string, number>());
  const turnIdsKey = taskSections.map(({ taskId }) => taskId).join('|');

  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !activeProjectId) return;

    turnObserverRef.current?.disconnect();
    visibleTurnScoresRef.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const taskId = entry.target.getAttribute('data-turn-id');
          if (!taskId) continue;
          if (!entry.isIntersecting) {
            visibleTurnScoresRef.current.delete(taskId);
            continue;
          }
          const visibleHeight = entry.intersectionRect.height;
          const availableHeight = Math.min(
            entry.boundingClientRect.height,
            root.clientHeight
          );
          visibleTurnScoresRef.current.set(
            taskId,
            availableHeight > 0 ? visibleHeight / availableHeight : 0
          );
        }
        let bestTaskId: string | null = null;
        let bestScore = 0;
        for (const [taskId, score] of visibleTurnScoresRef.current) {
          if (score > bestScore) {
            bestTaskId = taskId;
            bestScore = score;
          }
        }
        if (bestTaskId) {
          setSidePanelViewedTurn(activeProjectId, bestTaskId);
        }
      },
      { root, threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] }
    );

    turnObserverRef.current = observer;
    root
      .querySelectorAll('[data-turn-id]')
      .forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [turnIdsKey, scrollContainerRef, activeProjectId, setSidePanelViewedTurn]);

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
  }, [scrollToQueryId, setScrollToQueryId, scrollContainerRef]);

  // Scroll to a specific turn when triggered from TurnTabs
  const scrollToTurnRequest = usePageTabStore((s) => s.scrollToTurnRequest);
  const setScrollToTurnRequest = usePageTabStore(
    (s) => s.setScrollToTurnRequest
  );

  useEffect(() => {
    if (
      !scrollToTurnRequest ||
      scrollToTurnRequest.projectId !== activeProjectId ||
      !scrollContainerRef.current
    ) {
      return;
    }

    const el = scrollContainerRef.current.querySelector(
      `[data-turn-id="${scrollToTurnRequest.taskId}"]`
    );
    if (el) {
      const container = scrollContainerRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollOffset = elRect.top - containerRect.top + container.scrollTop;
      container.scrollTo({ top: scrollOffset, behavior: 'smooth' });
    }

    setScrollToTurnRequest(null);
  }, [
    activeProjectId,
    scrollToTurnRequest,
    setScrollToTurnRequest,
    scrollContainerRef,
  ]);

  // Surface the task box when the side-panel Progress section asks for it.
  // TaskCard listens to the same counter to expand itself; we own the
  // scroll. The `data-task-card="true"` attribute is set on a query
  // group's outer wrapper only when its TaskCard is currently visible.
  const taskBoxFocusRequestId = usePageTabStore((s) => s.taskBoxFocusRequestId);
  const taskBoxFocusProjectId = usePageTabStore((s) => s.taskBoxFocusProjectId);
  const taskBoxFocusTaskId = usePageTabStore((s) => s.taskBoxFocusTaskId);
  useEffect(() => {
    if (
      !taskBoxFocusRequestId ||
      (taskBoxFocusProjectId && taskBoxFocusProjectId !== activeProjectId)
    ) {
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const target = taskBoxFocusTaskId
      ? container.querySelector<HTMLElement>(
          `[data-turn-id="${taskBoxFocusTaskId}"] [data-task-card="true"]`
        )
      : Array.from(
          container.querySelectorAll<HTMLElement>('[data-task-card="true"]')
        ).at(-1);
    if (!target) return;
    // TaskCard's expand transition is ~300ms; do the scroll after a tick
    // so the card has started animating, but anchor on its top edge so
    // the final position is stable regardless of how tall it grows.
    const containerRect = container.getBoundingClientRect();
    const elRect = target.getBoundingClientRect();
    const scrollOffset = elRect.top - containerRect.top + container.scrollTop;
    container.scrollTo({ top: scrollOffset, behavior: 'smooth' });
  }, [
    activeProjectId,
    taskBoxFocusProjectId,
    taskBoxFocusRequestId,
    taskBoxFocusTaskId,
    scrollContainerRef,
  ]);

  return (
    <div className={`relative z-10 w-full ${className}`}>
      <div
        className="pt-0 mx-auto w-full max-w-[600px]"
        style={{ paddingBottom: scrollBottomInsetPx }}
      >
        <AnimatePresence mode="popLayout">
          {taskSections.map(({ chatId, chatStore, taskId }) => {
            return (
              <ProjectSection
                key={`${chatId}-${taskId}`}
                chatId={chatId}
                chatStore={chatStore}
                taskId={taskId}
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
