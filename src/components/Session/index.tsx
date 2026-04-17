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

import ChatBox from '@/components/ChatBox';
import {
  CHAT_TIMELINE_BREAKPOINT_PX,
  CHAT_TIMELINE_DEFAULT_COLLAPSED,
  ChatTimeline,
} from '@/components/ChatBox/ChatTimeline';
import { HeaderBox } from '@/components/Session/HeaderBox';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useProjectTaskTimelineEntries } from '@/hooks/useProjectTaskTimelineEntries';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { ChatTaskStatus, SessionMode } from '@/types/constants';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { SessionSidePanel } from './SessionSidePanel';

/** Matches prior workforce rail width; keeps chat + header from collapsing in the row. */
const SESSION_SIDE_PANEL_WIDTH_CLASS = 'w-[min(360px,40vw)] max-w-[400px]';

/**
 * Active session: header + chat (left) and a mode-dependent side panel (right).
 * The side panel is selected by `sessionSidePanelMode` in the page tab store
 * (Workspace toggle: Single Agent vs Workforce).
 */
export default function Session() {
  const { t } = useTranslation();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const setScrollToQueryId = usePageTabStore((s) => s.setScrollToQueryId);
  const sessionMode = usePageTabStore(
    (s) => s.sessionSidePanelMode ?? SessionMode.WORKFORCE
  );

  const sessionChatColumnRef = useRef<HTMLDivElement>(null);
  const [chatColumnWidth, setChatColumnWidth] = useState<number | null>(null);
  const [chatTimelineCollapsed, setChatTimelineCollapsed] = useState(
    CHAT_TIMELINE_DEFAULT_COLLAPSED
  );
  const [timelineDropdownOpen, setTimelineDropdownOpen] = useState(false);

  const [isSidePanelVisible, setIsSidePanelVisible] = useState(true);
  const [isExpandedOverlayOpen, setIsExpandedOverlayOpen] = useState(false);

  const taskTimelineEntries = useProjectTaskTimelineEntries(
    projectStore,
    chatStore
  );

  const isNarrowTimelineLayout = useMemo(
    () =>
      chatColumnWidth !== null && chatColumnWidth < CHAT_TIMELINE_BREAKPOINT_PX,
    [chatColumnWidth]
  );

  useLayoutEffect(() => {
    const el = sessionChatColumnRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && Number.isFinite(w)) setChatColumnWidth(w);
    });
    ro.observe(el);
    setChatColumnWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!isNarrowTimelineLayout) setTimelineDropdownOpen(false);
  }, [isNarrowTimelineLayout]);

  const handleScrollToQueryForTimeline = useCallback(
    (id: string) => {
      setScrollToQueryId(id);
      if (isNarrowTimelineLayout) setTimelineDropdownOpen(false);
    },
    [setScrollToQueryId, isNarrowTimelineLayout]
  );

  const toggleChatTimeline = useCallback(() => {
    setChatTimelineCollapsed((c) => !c);
  }, []);

  const getAllChatStoresMemoized = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return projectStore.getAllChatStores(projectStore.activeProjectId);
  }, [projectStore]);

  const hasAnyMessages = useMemo(() => {
    if (!chatStore) return false;
    if (chatStore.activeTaskId && chatStore.tasks[chatStore.activeTaskId]) {
      const activeTask = chatStore.tasks[chatStore.activeTaskId];
      if (
        (activeTask.messages && activeTask.messages.length > 0) ||
        activeTask.hasMessages
      ) {
        return true;
      }
    }
    return getAllChatStoresMemoized.some(({ chatStore: store }) => {
      const state = store.getState();
      return (
        state.activeTaskId &&
        state.tasks[state.activeTaskId] &&
        (state.tasks[state.activeTaskId].messages.length > 0 ||
          state.tasks[state.activeTaskId].hasMessages)
      );
    });
  }, [chatStore, getAllChatStoresMemoized]);

  const workforcePanelKey = chatStore?.activeTaskId ?? '';

  const hasSessionStarted = useMemo(() => {
    if (!chatStore) return false;
    return Object.values(chatStore.tasks).some((task) => {
      const started =
        (task.messages?.length || 0) > 0 ||
        task.hasMessages ||
        task.status !== ChatTaskStatus.PENDING;
      return started;
    });
  }, [chatStore]);

  useEffect(() => {
    if (!hasSessionStarted) {
      setActiveWorkspaceTab('workforce');
    }
  }, [hasSessionStarted, setActiveWorkspaceTab]);

  useEffect(() => {
    setIsExpandedOverlayOpen(false);
  }, [projectStore.activeProjectId]);

  useEffect(() => {
    if (activeWorkspaceTab !== 'session') {
      setIsExpandedOverlayOpen(false);
    }
  }, [activeWorkspaceTab]);

  const toggleSidePanel = useCallback(() => {
    setIsSidePanelVisible((prev) => !prev);
  }, []);

  const toggleExpandedOverlay = useCallback(() => {
    setIsExpandedOverlayOpen((prev) => !prev);
  }, []);

  const closeExpandedOverlay = useCallback(() => {
    setIsExpandedOverlayOpen(false);
  }, []);

  if (!chatStore) {
    return null;
  }

  return (
    <div className="min-h-0 min-w-0 flex h-full w-full flex-1 flex-row overflow-hidden">
      <div
        ref={sessionChatColumnRef}
        className="min-h-0 min-w-0 flex flex-1 flex-col overflow-hidden"
      >
        {chatStore.activeTaskId && hasAnyMessages && (
          <HeaderBox
            totalTokens={chatStore.tasks[chatStore.activeTaskId]?.tokens || 0}
            sessionSidePanelMode={sessionMode}
            narrowTimelineLayout={isNarrowTimelineLayout}
            timelineDropdownOpen={timelineDropdownOpen}
            onTimelineDropdownOpenChange={setTimelineDropdownOpen}
            timelineDropdownContent={
              isNarrowTimelineLayout ? (
                <ChatTimeline
                  collapsed={false}
                  entries={taskTimelineEntries}
                  activeTaskId={chatStore.activeTaskId}
                  setScrollToQueryId={handleScrollToQueryForTimeline}
                  title={t('layout.chat-history-title', {
                    defaultValue: 'Chat history',
                  })}
                  emptyLabel={t('layout.no-tasks', {
                    defaultValue: 'No tasks',
                  })}
                />
              ) : null
            }
            chatTimelineCollapsed={chatTimelineCollapsed}
            onToggleChatTimeline={toggleChatTimeline}
            isSessionSidePanelVisible={isSidePanelVisible}
            onToggleSessionSidePanel={toggleSidePanel}
          />
        )}
        <ChatBox
          isNarrowTimelineLayout={isNarrowTimelineLayout}
          chatTimelineCollapsed={chatTimelineCollapsed}
          onToggleChatTimeline={toggleChatTimeline}
          taskTimelineEntries={taskTimelineEntries}
        />
      </div>

      <div
        id="session-side-panel"
        className={cn(
          'min-h-0 ease-out flex shrink-0 flex-col overflow-hidden transition-[width] duration-200',
          isSidePanelVisible
            ? SESSION_SIDE_PANEL_WIDTH_CLASS
            : 'w-0 max-w-0 border-l-0'
        )}
      >
        <SessionSidePanel
          mode={sessionMode}
          workforcePanelKey={workforcePanelKey}
          hasAnyMessages={hasAnyMessages}
          isSidePanelVisible={isSidePanelVisible}
          onToggleSidePanel={toggleSidePanel}
          isExpandedOverlayOpen={isExpandedOverlayOpen}
          onToggleExpandedOverlay={toggleExpandedOverlay}
          onCloseExpandedOverlay={closeExpandedOverlay}
        />
      </div>
    </div>
  );
}
