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
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
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
  const isHistoryLoadingActiveProject = useProjectRuntimeStore((s) =>
    activeProjectId
      ? Boolean(s.historyLoadingProjectIds[activeProjectId])
      : false
  );
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const updateProjectMeta = useSpaceStore((s) => s.updateProjectMeta);
  const [draftSessionMode, setDraftSessionMode] = useState<SessionModeType>(
    SessionMode.SINGLE_AGENT
  );
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;
  // `null` = mode not yet determined (session still loading its events).
  const inferredSessionMode = inferSessionModeFromTask(activeTask, null);

  const [isSidePanelVisible, setIsSidePanelVisible] = useState(!isNewProject);
  const [isExpandedOverlayOpen, setIsExpandedOverlayOpen] = useState(false);

  // Default fold state is tab-specific. React reuses this component when switching
  // between `project` and `new-project`, so reset when the shell or project changes.
  useEffect(() => {
    setIsSidePanelVisible(!isNewProject);
    if (isNewProject) {
      setIsExpandedOverlayOpen(false);
    }
  }, [isNewProject, activeProjectId]);

  const getAllChatStoresMemoized = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return projectStore.getAllChatStores(projectStore.activeProjectId);
  }, [projectStore]);

  const hasAnyMessages = useMemo(() => {
    const hasMessages = (store: typeof chatStore) =>
      !!store &&
      Object.values(store.tasks).some(
        (task) => (task.messages?.length || 0) > 0 || task.hasMessages
      );
    if (hasMessages(chatStore)) return true;
    return getAllChatStoresMemoized.some(({ chatStore: store }) => {
      const state = store.getState();
      return Object.values(state.tasks).some(
        (task) => (task.messages?.length || 0) > 0 || task.hasMessages
      );
    });
  }, [chatStore, getAllChatStoresMemoized]);

  const workforcePanelKey = chatStore?.activeTaskId ?? '';

  const hasSessionStarted = useMemo(() => {
    // The React-mirrored `chatStore` (via useChatStoreAdapter) lags the
    // underlying vanilla store by one effect flush. When
    // `loadProjectFromHistory` finishes, `isHistoryLoadingActiveProject`
    // flips to false synchronously in the project runtime store, but the
    // chatStore mirror has not yet flushed the replayed tasks into React
    // state. Without the live-state fallback below, the redirect effect
    // in this component would observe an empty `chatStore.tasks` here,
    // assume the project never started, and bounce the user back to the
    // workforce shell — even though the project chatStore already has
    // task content. Cross-check live state via `getAllChatStores` (same
    // pattern as `hasAnyMessages` above) to avoid that race.
    const checkTasks = (tasksRecord: Record<string, unknown> | undefined) => {
      if (!tasksRecord) return false;
      return Object.values(tasksRecord).some((task) => {
        const t = task as {
          messages?: unknown[];
          hasMessages?: boolean;
          status?: unknown;
        };
        return (
          (t.messages?.length || 0) > 0 ||
          t.hasMessages ||
          t.status !== ChatTaskStatus.PENDING
        );
      });
    };
    if (checkTasks(chatStore?.tasks)) return true;
    return getAllChatStoresMemoized.some(({ chatStore: store }) =>
      checkTasks(store.getState().tasks)
    );
  }, [chatStore, getAllChatStoresMemoized]);

  // Projects loaded from history carry the `replay` tag and are known to
  // have task content (or we wouldn't be loading them from history at all).
  // Used as a belt-and-suspenders signal for the redirect effect below so
  // it can't bounce a freshly-hydrated project back to the workforce shell
  // even if the chatStore subscription mirror is still catching up.
  const activeIsReplayProject = useMemo(
    () => Boolean(activeProjectMeta?.metadata?.tags?.includes('replay')),
    [activeProjectMeta?.metadata?.tags]
  );

  useEffect(() => {
    // The New Project shell stays selected on its own tab — never redirect
    // away from it (it is empty until the user sends the first message).
    if (isNewProject) return;
    // Only redirect while the live project tab is active; ignore inbox/triggers/etc.
    if (activeWorkspaceTab !== 'project') return;
    // Wait until the project chat store is ready (selectProject still loading).
    if (!chatStore) return;
    // While history is still replaying, the chat store exists but messages
    // haven't been written yet. Don't bounce away — selectProject will pick
    // the correct shell ('project' vs 'new-project') once loading settles.
    if (isHistoryLoadingActiveProject) return;
    // A history-loaded project is known to have content. The hasSessionStarted
    // memo below cross-checks the live chatStore state, but if the project
    // store transiently rebuilds the project's chatStores (loadProjectFromHistory
    // does remove+create), there is a render where the live state is also
    // empty. Trust the project type tag here to avoid the bounce.
    if (activeIsReplayProject) return;
    if (!hasSessionStarted) {
      setActiveWorkspaceTab('workforce');
    }
  }, [
    activeIsReplayProject,
    activeWorkspaceTab,
    chatStore,
    hasSessionStarted,
    isHistoryLoadingActiveProject,
    isNewProject,
    setActiveWorkspaceTab,
  ]);

  useEffect(() => {
    if (!isNewProject) return;
    setDraftSessionMode(activeProjectMeta?.mode ?? SessionMode.SINGLE_AGENT);
  }, [activeProjectId, activeProjectMeta?.mode, isNewProject]);

  const handleNewProjectSessionModeChange = useCallback(
    (mode: SessionModeType) => {
      setDraftSessionMode(mode);
      if (activeProjectId) {
        updateProjectMeta(activeProjectId, { mode });
      }
    },
    [activeProjectId, updateProjectMeta]
  );

  // Nullable "display" form of the Project mode. `null` while a saved Project
  // is still loading — the side panel renders empty rather than defaulting and
  // flickering once the real mode resolves. Fresh Projects default to single
  // agent until the Project mode toggle writes a value.
  const displaySessionMode: SessionModeType | null = isNewProject
    ? (activeProjectMeta?.mode ?? draftSessionMode)
    : (activeProjectMeta?.mode ??
      inferredSessionMode ??
      (hasSessionStarted ? null : SessionMode.SINGLE_AGENT));

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

  if (!isNewProject && !chatStore) {
    return null;
  }

  const sessionSidePanel = displaySessionMode ? (
    <SessionSidePanel
      key={displaySessionMode}
      mode={displaySessionMode}
      workforcePanelKey={workforcePanelKey}
      hasAnyMessages={hasAnyMessages}
      isSidePanelVisible={isSidePanelVisible}
      onToggleSidePanel={toggleSidePanel}
      isExpandedOverlayOpen={isExpandedOverlayOpen}
      onToggleExpandedOverlay={toggleExpandedOverlay}
      onCloseExpandedOverlay={closeExpandedOverlay}
    />
  ) : null;

  if (isNewProject) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <HeaderBox empty />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Workspace
              variant="new-project"
              embedded
              sessionMode={displaySessionMode ?? SessionMode.SINGLE_AGENT}
              onSessionModeChange={handleNewProjectSessionModeChange}
            />
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
          {sessionSidePanel}
        </div>
      </div>
    );
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
          <ChatBox />
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
        {sessionSidePanel}
      </div>
    </div>
  );
}
