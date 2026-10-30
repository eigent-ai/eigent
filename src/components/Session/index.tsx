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
import { SessionArtifactPreview } from '@/components/ChatBox/SessionArtifactPreview';
import { HeaderBox } from '@/components/Session/HeaderBox';
import { PreviewPanel } from '@/components/Session/PreviewPanel';
import Workspace from '@/components/Workspace';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ProjectEventRuntimeProvider } from '@/hooks/useProjectEventRuntime';
import { useSessionExecution } from '@/hooks/useSessionExecution';
import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import { SessionPaneProvider } from '@/hooks/useSessionPane';
import {
  useIsFocusedSessionPane,
  useSessionProjectId,
} from '@/hooks/useSessionProjectId';
import { isProjectAchieved } from '@/lib/projectAchievement';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { getSessionMetaDisplayName } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import {
  getSessionPreviewSlice,
  NEW_SESSION_DRAFT_SCOPE,
  usePageTabStore,
  WorkspaceTab,
} from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ChatTaskStatus,
  SessionMode,
  type SessionModeType,
} from '@/types/constants';
import { useReducedMotion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { PreviewColumn } from './layout/PreviewColumn';
import { getSessionColumnLayout, SUMMARY_WIDTH } from './layout/sessionColumns';
import { usePreviewEntrance } from './layout/usePreviewEntrance';
import {
  CHAT_SIDE_WIDTH_VAR,
  usePreviewResize,
} from './layout/usePreviewResize';
import { SessionSidePanel } from './SidePanel';

/**
 * Session layout: header and chat with optional Summary (left group) beside an
 * optional Preview column. The New session page uses the same layout with a
 * centered composer; its Preview and Summary state live in a draft scope that
 * moves to the Session created by the first task.
 */
interface SessionProps {
  /** New session page: no Project until the first task creates one. */
  isNewProject?: boolean;
  /** Pane-owned Session; omitted for the existing active-Session route. */
  projectId?: string | null;
  /** Extra controls at the right end of the Session header (split panes). */
  headerActions?: ReactNode;
}

export default function Session({
  projectId,
  isNewProject = false,
  headerActions,
}: SessionProps) {
  const inheritedProjectId = useSessionProjectId();
  const id = projectId === undefined ? inheritedProjectId : projectId;
  const focus = () => {
    if (id !== useProjectRuntimeStore.getState().activeProjectId)
      useProjectRuntimeStore.getState().setActiveProject(id);
    usePageTabStore
      .getState()
      .setSessionPreviewProject(isNewProject ? NEW_SESSION_DRAFT_SCOPE : id);
  };
  return (
    <SessionPaneProvider
      projectId={id}
      previewScopeId={isNewProject ? NEW_SESSION_DRAFT_SCOPE : id}
      retain={projectId !== undefined}
    >
      <div
        data-session-pane={id ?? ''}
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
        onPointerDownCapture={focus}
        onFocusCapture={focus}
      >
        <SessionContent
          isNewProject={isNewProject}
          headerActions={headerActions}
        />
      </div>
    </SessionPaneProvider>
  );
}

function SessionContent({ isNewProject = false, headerActions }: SessionProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const { chatStore, projectStore } = useChatStoreAdapter();
  const sessionProjectId = useSessionProjectId();
  const isFocused = useIsFocusedSessionPane();
  const activeWorkspaceTab = useSessionPageTabStore(
    (s) => s.activeWorkspaceTab
  );
  const setActiveWorkspaceTab = useSessionPageTabStore(
    (s) => s.setActiveWorkspaceTab
  );
  const closeSessionPreview = useSessionPageTabStore(
    (s) => s.closeSessionPreview
  );
  const setSessionPreviewProject = useSessionPageTabStore(
    (s) => s.setSessionPreviewProject
  );
  const sessionPreviewProjectId = useSessionPageTabStore(
    (s) => s.sessionPreviewProjectId
  );
  const activeProjectId = sessionProjectId;
  // The New session page keeps the last active Project selected until its
  // first task creates a replacement, so its columns use a draft scope.
  const scopeId = isNewProject
    ? NEW_SESSION_DRAFT_SCOPE
    : (activeProjectId ?? null);
  // Only trust the preview slice once the scope points at this Session — on
  // switch the scope effect below lags the first render by one frame, and
  // rendering the stale slice would flash the previous Session's browser.
  const previewOpen =
    useSessionPageTabStore((s) => getSessionPreviewSlice(s).open) &&
    sessionPreviewProjectId === scopeId;
  const previewOpening = useSessionPageTabStore((s) => s.sessionPreviewOpening);
  const sessionExecution = useSessionExecution(activeProjectId);
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

  // `undefined` = no saved choice yet; the first task start may open it.
  const summaryPreference = useSessionPageTabStore((s) =>
    scopeId ? s.sessionSummaryOpenByProject[scopeId] : undefined
  );
  const summaryOpen = summaryPreference ?? false;
  const setSessionSummaryOpen = useSessionPageTabStore(
    (s) => s.setSessionSummaryOpen
  );
  const taskStarted = useSessionPageTabStore((s) =>
    scopeId ? Boolean(s.sessionTaskStartedProjectIds[scopeId]) : false
  );
  const clearSessionTaskStarted = useSessionPageTabStore(
    (s) => s.clearSessionTaskStarted
  );
  const [summaryPopoverOpen, setSummaryPopoverOpen] = useState(false);
  const [chatSideElement, setChatSideElement] = useState<HTMLDivElement | null>(
    null
  );
  const [isExpandedOverlayOpen, setIsExpandedOverlayOpen] = useState(false);
  const sessionSidePanelToggleRequestId = useSessionPageTabStore(
    (s) => s.sessionSidePanelToggleRequestId
  );
  const sessionSidePanelToggleProjectId = useSessionPageTabStore(
    (s) => s.sessionSidePanelToggleProjectId
  );
  const handledSidePanelToggleRequestId = useRef(
    sessionSidePanelToggleRequestId
  );

  useEffect(() => {
    if (isNewProject) setIsExpandedOverlayOpen(false);
  }, [isNewProject, activeProjectId]);

  const getAllChatStoresMemoized = useMemo(() => {
    if (!sessionProjectId) return [];
    return projectStore.getAllChatStores(sessionProjectId);
  }, [projectStore, sessionProjectId]);

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
    // pattern as the project-wide store lookup above) to avoid that race.
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
    if (isNewProject || !isFocused) return;
    // Only redirect while the live project tab is active; ignore files/triggers/etc.
    if (activeWorkspaceTab !== 'project') return;
    // Wait until the project chat store is ready (selectSession still loading).
    if (!chatStore) return;
    // While history is still replaying, the chat store exists but messages
    // haven't been written yet. Don't bounce away — selectSession will pick
    // the correct shell ('project' vs 'new-project') once loading settles.
    if (isHistoryLoadingActiveProject) return;
    // A history-loaded project is known to have content. The hasSessionStarted
    // memo below cross-checks the live chatStore state, but if the project
    // store transiently rebuilds the project's chatStores (loadProjectFromHistory
    // does remove+create), there is a render where the live state is also
    // empty. Trust the project type tag here to avoid the bounce.
    if (activeIsReplayProject) return;
    if (
      sessionExecution.state.managed ||
      !sessionExecution.state.route ||
      sessionExecution.state.error
    )
      return;
    if (!hasSessionStarted) {
      setActiveWorkspaceTab('workforce');
    }
  }, [
    isFocused,
    activeIsReplayProject,
    activeWorkspaceTab,
    chatStore,
    hasSessionStarted,
    sessionExecution.state,
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
  }, [sessionProjectId]);

  const isSessionTab =
    activeWorkspaceTab === WorkspaceTab.Project ||
    activeWorkspaceTab === WorkspaceTab.NewProject;
  useEffect(() => {
    if (!isSessionTab) setIsExpandedOverlayOpen(false);
  }, [isSessionTab]);

  // Measured column geometry uses the registered split-pane-geometry exception.
  const chatRowRef = useRef<HTMLDivElement>(null);
  const hasChatStore = Boolean(chatStore);
  const [chatSideWidth, setChatSideWidth] = useState<number | null>(null);
  const [paneWidth, setPaneWidth] = useState<number | null>(null);
  const {
    showPreview,
    maxChatSideWidth,
    visibleChatSideWidth,
    canDockSummary,
  } = getSessionColumnLayout({
    paneWidth,
    fallbackPaneWidth: window.innerWidth,
    previewOpen,
    summaryOpen,
    chatSideWidth,
  });
  const showSummary = summaryOpen && canDockSummary;

  const toggleSidePanel = useCallback(() => {
    if (!canDockSummary) setSummaryPopoverOpen((open) => !open);
    else if (scopeId) {
      if (showPreview) setChatSideWidth(visibleChatSideWidth);
      setSessionSummaryOpen(scopeId, !summaryOpen);
    }
  }, [
    canDockSummary,
    scopeId,
    summaryOpen,
    setSessionSummaryOpen,
    showPreview,
    visibleChatSideWidth,
  ]);

  useEffect(() => {
    if (
      handledSidePanelToggleRequestId.current ===
      sessionSidePanelToggleRequestId
    )
      return;
    handledSidePanelToggleRequestId.current = sessionSidePanelToggleRequestId;
    if (
      isSessionTab &&
      (sessionSidePanelToggleProjectId
        ? sessionSidePanelToggleProjectId === scopeId
        : isFocused)
    )
      toggleSidePanel();
  }, [
    isSessionTab,
    isFocused,
    sessionSidePanelToggleRequestId,
    sessionSidePanelToggleProjectId,
    scopeId,
    toggleSidePanel,
  ]);

  useEffect(() => {
    setSummaryPopoverOpen(false);
  }, [scopeId, canDockSummary, showPreview, activeWorkspaceTab]);

  useLayoutEffect(() => {
    const row = chatRowRef.current;
    if (!row) return;
    const updateWidth = () => {
      const width = row.getBoundingClientRect().width;
      // Hidden routes have zero bounds; don't erase saved column preferences.
      if (width > 0) setPaneWidth(width);
    };
    updateWidth();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateWidth);
    observer?.observe(row);
    return () => observer?.disconnect();
  }, [scopeId, hasChatStore]);

  // Narrow widths hide Summary but keep its saved choice, so widening the pane
  // docks it again. Preview has no hidden state and closes instead.
  useLayoutEffect(() => {
    if (paneWidth === null) return;
    if (summaryOpen && !showSummary) setIsExpandedOverlayOpen(false);
    if (previewOpen && !showPreview) closeSessionPreview();
  }, [
    paneWidth,
    summaryOpen,
    showSummary,
    previewOpen,
    showPreview,
    closeSessionPreview,
  ]);

  // A started task opens Summary by default when the Session has room for it
  // and the user has not chosen a state for this Session yet.
  useLayoutEffect(() => {
    if (isNewProject || !taskStarted || !activeProjectId || paneWidth === null)
      return;
    clearSessionTaskStarted(activeProjectId);
    if (summaryPreference !== undefined) return;
    const { canDockSummary: fitsWhenOpen } = getSessionColumnLayout({
      paneWidth,
      fallbackPaneWidth: window.innerWidth,
      previewOpen,
      summaryOpen: true,
      chatSideWidth,
    });
    if (fitsWhenOpen) setSessionSummaryOpen(activeProjectId, true);
  }, [
    isNewProject,
    taskStarted,
    activeProjectId,
    paneWidth,
    clearSessionTaskStarted,
    summaryPreference,
    previewOpen,
    chatSideWidth,
    setSessionSummaryOpen,
  ]);

  // Scope the preview store before the first interactive paint. Review/file
  // buttons already exist in the chat at that point; doing this in a passive
  // effect leaves a window where their mutations are silently dropped because
  // setSessionPreviewSlice has no project to own them yet.
  useLayoutEffect(() => {
    if (isFocused) setSessionPreviewProject(scopeId);
  }, [scopeId, isFocused, setSessionPreviewProject]);

  const previewResize = usePreviewResize({
    rowRef: chatRowRef,
    visibleChatSideWidth,
    maxChatSideWidth,
    setChatSideWidth,
    resetKey: `${showPreview}:${paneWidth}:${scopeId}:${activeWorkspaceTab}`,
  });

  const previewEntrance = usePreviewEntrance({
    showPreview,
    scopeId,
    activeWorkspaceTab,
    previewOpening,
    shouldReduceMotion,
  });

  // "Files" breadcrumb / empty-state action: open the Files tab for this file.
  const handleJumpToFiles = useCallback(
    (file: FileInfo | null) => {
      // The New session page has no Session files; never select into the
      // previously active Session's chat store.
      if (!isNewProject && file && chatStore?.activeTaskId) {
        chatStore.setSelectedFile(chatStore.activeTaskId, file);
      }
      setActiveWorkspaceTab('files', {
        clearFilesForProjectId: isNewProject ? null : (activeProjectId ?? null),
      });
      closeSessionPreview();
    },
    [
      isNewProject,
      chatStore,
      setActiveWorkspaceTab,
      activeProjectId,
      closeSessionPreview,
    ]
  );

  const toggleExpandedOverlay = useCallback(() => {
    setIsExpandedOverlayOpen((prev) => !prev);
  }, []);

  const closeExpandedOverlay = useCallback(() => {
    setIsExpandedOverlayOpen(false);
  }, []);

  if (
    !isNewProject &&
    !chatStore &&
    sessionExecution.state.route?.route === 'legacy'
  ) {
    return null;
  }

  const sessionSidePanel =
    displaySessionMode &&
    (isNewProject ||
      (sessionExecution.state.route && !sessionExecution.state.error)) ? (
      <SessionSidePanel
        key={displaySessionMode}
        mode={displaySessionMode}
        workforcePanelKey={workforcePanelKey}
        isSidePanelVisible={summaryOpen || summaryPopoverOpen}
        onToggleSidePanel={toggleSidePanel}
        isExpandedOverlayOpen={isExpandedOverlayOpen}
        onToggleExpandedOverlay={toggleExpandedOverlay}
        onCloseExpandedOverlay={closeExpandedOverlay}
      />
    ) : null;

  const layout = (
    <div
      ref={chatRowRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden"
    >
      {previewResize.isResizing ? (
        <div
          data-preview-resize-shield
          aria-hidden="true"
          className="fixed inset-0 z-40 cursor-col-resize"
        />
      ) : null}
      <div
        ref={setChatSideElement}
        style={
          showPreview
            ? {
                width: `var(${CHAT_SIDE_WIDTH_VAR}, ${visibleChatSideWidth}px)`,
              }
            : undefined
        }
        className={cn(
          'flex min-h-0 min-w-0 flex-col overflow-hidden',
          showPreview ? 'shrink-0' : 'flex-1'
        )}
      >
        <HeaderBox
          projectName={
            isNewProject
              ? t('layout.new-project', { defaultValue: 'New session' })
              : activeProjectMeta
                ? getSessionMetaDisplayName(activeProjectMeta, t)
                : undefined
          }
          projectId={isNewProject ? null : activeProjectId}
          projectAchieved={
            !isNewProject && isProjectAchieved(activeProjectMeta?.metadata)
          }
          totalTokens={isNewProject ? 0 : (activeTask?.tokens ?? 0)}
          showTimelineStyle={!isNewProject}
          showBack={!isNewProject}
          summary={{
            open: showSummary,
            onToggle: toggleSidePanel,
            popover: canDockSummary ? undefined : sessionSidePanel,
            popoverOpen: summaryPopoverOpen,
            onPopoverOpenChange: setSummaryPopoverOpen,
            popoverBoundary: chatSideElement,
          }}
          className={showPreview ? 'pr-ds-4' : undefined}
          trailingActions={headerActions}
        />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {isNewProject ? (
              <Workspace
                variant="new-project"
                embedded
                sessionMode={displaySessionMode ?? SessionMode.SINGLE_AGENT}
                onSessionModeChange={handleNewProjectSessionModeChange}
              />
            ) : (
              <ChatBox />
            )}
          </div>
          {showSummary ? (
            <div
              data-session-side-panel
              style={{ width: SUMMARY_WIDTH }}
              className="flex min-h-0 shrink-0 flex-col overflow-hidden"
            >
              {sessionSidePanel}
            </div>
          ) : null}
        </div>
      </div>
      {showPreview ? (
        <PreviewColumn
          key={`${scopeId}:${previewOpening?.requestId ?? 0}`}
          immediateOpening={previewEntrance.immediateOpening}
          immediateGeometry={previewEntrance.immediateGeometry}
          onEntranceComplete={previewEntrance.finishEntrance}
          resizeHandle={{
            isResizing: previewResize.isResizing,
            value: visibleChatSideWidth,
            max: maxChatSideWidth,
            onPointerDown: previewResize.onPointerDown,
            onKeyDown: previewResize.onKeyDown,
          }}
        >
          {scopeId ? (
            <PreviewPanel
              displaySettled={previewEntrance.displaySettled}
              onJumpToFiles={handleJumpToFiles}
            />
          ) : null}
        </PreviewColumn>
      ) : null}
    </div>
  );

  if (isNewProject) {
    return (
      // The New session page deliberately preserves the last active Project in
      // ProjectStore until the first message creates its replacement. Do not
      // let that navigation convenience scope the SidePanel to the old Run.
      <ProjectEventRuntimeProvider projectId={null}>
        {layout}
      </ProjectEventRuntimeProvider>
    );
  }

  return (
    <ProjectEventRuntimeProvider
      key={`${sessionExecution.scope.accountKey}:${activeProjectId}`}
      projectId={activeProjectId}
      expectedAccountKey={sessionExecution.scope.accountKey}
      enabled={
        Boolean(sessionExecution.state.route) && !sessionExecution.state.error
      }
    >
      <SessionArtifactPreview
        scope={sessionExecution.scope}
        enabled={sessionExecution.state.managed}
      >
        {layout}
      </SessionArtifactPreview>
    </ProjectEventRuntimeProvider>
  );
}
