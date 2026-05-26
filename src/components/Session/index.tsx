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
import { HeaderBox } from '@/components/Session/HeaderBox';
import Workspace from '@/components/Workspace';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ChatTaskStatus,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SessionSidePanel } from './SessionSidePanel';
import {
  SESSION_SIDE_PANEL_EXPANDED_OUTER_CLASS,
  SESSION_SIDE_PANEL_FOLDED_OUTER_CLASS,
} from './sessionSidePanelLayout';

/**
 * Active Project: header + chat (left) and a mode-dependent side panel (right).
 * The side panel is selected from Project.mode. Task/session mode fields are
 * retained only to render legacy runs that do not have a Project mode yet.
 */
interface SessionProps {
  /** New Project shell: empty Project that promotes to a live Project on send. */
  isNewProject?: boolean;
}

export default function Session({ isNewProject = false }: SessionProps) {
  const { chatStore, projectStore } = useChatStoreAdapter();
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const activeProjectId = projectStore.activeProjectId;
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;
  // `null` = mode not yet determined (session still loading its events).
  const inferredSessionMode = inferSessionModeFromTask(activeTask, null);

  const [isSidePanelVisible, setIsSidePanelVisible] = useState(true);
  const [isExpandedOverlayOpen, setIsExpandedOverlayOpen] = useState(false);

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
    // The New Project shell stays selected on its own tab — never redirect
    // away from it (it is empty until the user sends the first message).
    if (isNewProject) return;
    if (!hasSessionStarted) {
      setActiveWorkspaceTab('workforce');
    }
  }, [isNewProject, hasSessionStarted, setActiveWorkspaceTab]);

  // Nullable "display" form of the Project mode. `null` while a saved Project
  // is still loading — the side panel renders empty rather than defaulting and
  // flickering once the real mode resolves. Fresh Projects default to single
  // agent until the Project mode toggle writes a value.
  const displaySessionMode: SessionModeType | null =
    activeProjectMeta?.mode ??
    inferredSessionMode ??
    (hasSessionStarted ? null : SessionMode.SINGLE_AGENT);

  useEffect(() => {
    setIsExpandedOverlayOpen(false);
  }, [projectStore.activeProjectId]);

  useEffect(() => {
    if (activeWorkspaceTab !== 'project') {
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
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {chatStore.activeTaskId && hasAnyMessages && (
          <HeaderBox
            totalTokens={chatStore.tasks[chatStore.activeTaskId]?.tokens || 0}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {isNewProject ? <Workspace variant="new-project" /> : <ChatBox />}
        </div>
      </div>

      <div
        id="session-side-panel"
        className={cn(
          'flex min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out',
          isSidePanelVisible
            ? SESSION_SIDE_PANEL_EXPANDED_OUTER_CLASS
            : cn(SESSION_SIDE_PANEL_FOLDED_OUTER_CLASS, 'rounded-l-xl')
        )}
      >
        {displaySessionMode ? (
          <SessionSidePanel
            mode={displaySessionMode}
            workforcePanelKey={workforcePanelKey}
            hasAnyMessages={hasAnyMessages}
            isSidePanelVisible={isSidePanelVisible}
            onToggleSidePanel={toggleSidePanel}
            isExpandedOverlayOpen={isExpandedOverlayOpen}
            onToggleExpandedOverlay={toggleExpandedOverlay}
            onCloseExpandedOverlay={closeExpandedOverlay}
          />
        ) : null}
      </div>
    </div>
  );
}
