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
  RIGHT_RAIL_EXPANDED_OUTER_CLASS,
  RIGHT_RAIL_FOLDED_OUTER_CLASS,
} from '@/components/Layout/rightRail';
import { HeaderBox } from '@/components/Session/HeaderBox';
import { PreviewPanel } from '@/components/Session/PreviewPanel';
import Workspace from '@/components/Workspace';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ProjectEventRuntimeProvider } from '@/hooks/useProjectEventRuntime';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { cn } from '@/lib/utils';
import {
  getSessionPreviewSlice,
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
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SessionSidePanel } from './SidePanel';

/** Maximum width the resizable chat column can reclaim while display is open. */
const CHAT_PRIORITY_WIDTH = 680;
/** Smallest the chat column may be dragged to. */
const CHAT_MIN_WIDTH = 360;
/** Keep at least this much room for the preview when the chat is widened. */
const PREVIEW_MIN_WIDTH = 320;
const DISPLAY_PANEL_SPRING = {
  type: 'spring' as const,
  duration: 0.5,
  bounce: 0.2,
};
const DISPLAY_PANEL_FADE = {
  duration: 0.2,
  ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
};
/** Display panel open/close animation duration (framer transition below). */
const DISPLAY_PANEL_ANIMATION_MS = 500;

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
  const shouldReduceMotion = Boolean(useReducedMotion());
  const { chatStore, projectStore } = useChatStoreAdapter();
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const closeSessionPreview = usePageTabStore((s) => s.closeSessionPreview);
  const setSessionPreviewProject = usePageTabStore(
    (s) => s.setSessionPreviewProject
  );
  const sessionPreviewProjectId = usePageTabStore(
    (s) => s.sessionPreviewProjectId
  );
  // Only trust the preview slice once the scope points at this project — on
  // switch the scope effect below lags the first render by one frame, and
  // rendering the stale slice would flash the previous project's browser.
  const previewOpen =
    usePageTabStore((s) => getSessionPreviewSlice(s).open) &&
    sessionPreviewProjectId === (projectStore.activeProjectId ?? null);
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
  const sessionSidePanelToggleRequestId = usePageTabStore(
    (s) => s.sessionSidePanelToggleRequestId
  );
  const handledSidePanelToggleRequestId = useRef(
    sessionSidePanelToggleRequestId
  );

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
    if (isNewProject) return;
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

  useEffect(() => {
    if (
      handledSidePanelToggleRequestId.current ===
      sessionSidePanelToggleRequestId
    ) {
      return;
    }
    handledSidePanelToggleRequestId.current = sessionSidePanelToggleRequestId;
    if (activeWorkspaceTab === WorkspaceTab.Project) toggleSidePanel();
  }, [activeWorkspaceTab, sessionSidePanelToggleRequestId, toggleSidePanel]);

  // Chat/display sizing. When display opens the chat collapses to its minimum;
  // display takes the remaining room before the independently folded side panel.
  const chatRowRef = useRef<HTMLDivElement>(null);
  const [chatWidth, setChatWidth] = useState(CHAT_PRIORITY_WIDTH);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const previewResizeCleanupRef = useRef<
    ((commitWidth?: boolean) => void) | null
  >(null);

  // Scope the preview store before the first interactive paint. Review/file
  // buttons already exist in the chat at that point; doing this in a passive
  // effect leaves a window where their mutations are silently dropped because
  // setSessionPreviewSlice has no project to own them yet.
  useLayoutEffect(() => {
    setSessionPreviewProject(activeProjectId ?? null);
  }, [activeProjectId, setSessionPreviewProject]);

  // Last chat width the user dragged to; reopening display restores it instead
  // of resetting to the minimum.
  const userChatWidthRef = useRef<number | null>(null);

  // Opening display auto-folds the session side panel and collapses chat
  // (to the user's remembered width, if they resized before).
  useEffect(() => {
    if (previewOpen) {
      setIsSidePanelVisible(false);
      const restoredWidth = userChatWidthRef.current ?? CHAT_MIN_WIDTH;
      chatRowRef.current?.style.setProperty(
        '--session-chat-width',
        `${restoredWidth}px`
      );
      setChatWidth(restoredWidth);
    } else {
      previewResizeCleanupRef.current?.();
    }
  }, [previewOpen]);

  // A drag can outlive the Session when the user switches Project or route.
  // Remove every native listener without scheduling state on an unmounted tree.
  useEffect(
    () => () => {
      previewResizeCleanupRef.current?.(false);
    },
    []
  );

  // Embedded browser guests are `position: fixed` in a separate layer, so the
  // panel's animated bounds can't clip them. Hold the guest parked until
  // the entrance finishes (then it fades in over the settled rect) instead of
  // letting the page pop in full-size over the chat mid-animation.
  const [displaySettled, setDisplaySettled] = useState(false);
  useEffect(() => {
    if (!previewOpen) {
      setDisplaySettled(false);
      return;
    }
    const timer = window.setTimeout(
      () => setDisplaySettled(true),
      DISPLAY_PANEL_ANIMATION_MS + 20
    );
    return () => window.clearTimeout(timer);
  }, [previewOpen]);

  const handlePreviewResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      previewResizeCleanupRef.current?.();
      const rowWidth =
        chatRowRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const sidePanelWidth =
        document.getElementById('session-side-panel')?.getBoundingClientRect()
          .width ?? 0;
      // Chat never exceeds its priority max width, and always leaves room for
      // display's minimum width plus the independent session panel.
      const maxChat = Math.max(
        CHAT_MIN_WIDTH,
        Math.min(
          CHAT_PRIORITY_WIDTH,
          rowWidth - sidePanelWidth - PREVIEW_MIN_WIDTH
        )
      );
      const startX = e.clientX;
      const startWidth = chatWidth;
      const pointerId = e.pointerId;
      const handle = e.currentTarget;
      const body = document.body;
      const previousCursor = body.style.cursor;
      const previousUserSelect = body.style.userSelect;
      let pendingWidth = startWidth;
      let frameId: number | null = null;
      let finished = false;

      setIsResizingPreview(true);
      body.style.cursor = 'col-resize';
      body.style.userSelect = 'none';

      const applyPendingWidth = () => {
        frameId = null;
        chatRowRef.current?.style.setProperty(
          '--session-chat-width',
          `${pendingWidth}px`
        );
      };

      const finishResize = (commitWidth = true) => {
        if (finished) return;
        finished = true;
        previewResizeCleanupRef.current = null;
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
          applyPendingWidth();
        }

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
        window.removeEventListener('blur', onWindowBlur);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        handle.removeEventListener('lostpointercapture', onLostPointerCapture);
        try {
          if (handle.hasPointerCapture?.(pointerId)) {
            handle.releasePointerCapture(pointerId);
          }
        } catch {
          // The browser may already have released capture during cancellation.
        }

        if (body.style.cursor === 'col-resize') {
          body.style.cursor = previousCursor;
        }
        if (body.style.userSelect === 'none') {
          body.style.userSelect = previousUserSelect;
        }
        if (commitWidth) {
          userChatWidthRef.current = pendingWidth;
          setChatWidth(pendingWidth);
          setIsResizingPreview(false);
        }
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        // Cross-origin iframes and Electron webviews can consume pointerup.
        // A later move with no pressed button is an equivalent end signal.
        if (ev.buttons === 0) {
          finishResize();
          return;
        }
        ev.preventDefault();
        // Dragging right (larger clientX) widens the chat, shrinking the preview.
        pendingWidth = Math.min(
          maxChat,
          Math.max(CHAT_MIN_WIDTH, startWidth + (ev.clientX - startX))
        );
        userChatWidthRef.current = pendingWidth;
        if (frameId === null) {
          frameId = window.requestAnimationFrame(applyPendingWidth);
        }
      };
      const onPointerEnd = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) finishResize();
      };
      const onWindowBlur = () => finishResize();
      const onVisibilityChange = () => {
        if (document.visibilityState !== 'visible') finishResize();
      };
      const onLostPointerCapture = () => finishResize();

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onPointerEnd);
      window.addEventListener('pointercancel', onPointerEnd);
      window.addEventListener('blur', onWindowBlur);
      document.addEventListener('visibilitychange', onVisibilityChange);
      handle.addEventListener('lostpointercapture', onLostPointerCapture);
      previewResizeCleanupRef.current = finishResize;
      try {
        handle.setPointerCapture?.(pointerId);
      } catch {
        // The fixed drag shield below remains the fallback for older hosts.
      }
    },
    [chatWidth]
  );

  // "Files" breadcrumb / empty-state action: open the Files tab for this file.
  const handleJumpToFiles = useCallback(
    (file: FileInfo | null) => {
      if (file && chatStore?.activeTaskId) {
        chatStore.setSelectedFile(chatStore.activeTaskId, file);
      }
      setActiveWorkspaceTab('files', {
        clearFilesForProjectId: activeProjectId ?? null,
      });
      closeSessionPreview();
    },
    [chatStore, setActiveWorkspaceTab, activeProjectId, closeSessionPreview]
  );

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
      isSidePanelVisible={isSidePanelVisible}
      onToggleSidePanel={toggleSidePanel}
      isExpandedOverlayOpen={isExpandedOverlayOpen}
      onToggleExpandedOverlay={toggleExpandedOverlay}
      onCloseExpandedOverlay={closeExpandedOverlay}
    />
  ) : null;
  if (isNewProject) {
    return (
      // The new-project tab deliberately preserves the last active Project in
      // ProjectStore until the first message creates its replacement. Do not
      // let that navigation convenience scope the SidePanel to the old Run.
      <ProjectEventRuntimeProvider projectId={null}>
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
                ? RIGHT_RAIL_EXPANDED_OUTER_CLASS
                : cn(RIGHT_RAIL_FOLDED_OUTER_CLASS, 'rounded-l-xl')
            )}
          >
            {sessionSidePanel}
          </div>
        </div>
      </ProjectEventRuntimeProvider>
    );
  }

  return (
    <ProjectEventRuntimeProvider projectId={activeProjectId}>
      <div
        ref={chatRowRef}
        className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-row overflow-hidden"
      >
        {isResizingPreview ? (
          <div
            data-preview-resize-shield
            aria-hidden="true"
            className="fixed inset-0 z-40 cursor-col-resize"
          />
        ) : null}
        {/* Chat content: owns the project header and folds when display opens. */}
        <div
          style={
            previewOpen
              ? {
                  width: `var(--session-chat-width, ${chatWidth}px)`,
                }
              : undefined
          }
          className={cn(
            'flex min-h-0 min-w-0 flex-col overflow-hidden',
            previewOpen ? 'shrink-0' : 'flex-1',
            !isResizingPreview && 'transition-[width] duration-200 ease-out'
          )}
        >
          <HeaderBox
            projectName={activeProjectMeta?.name}
            totalTokens={
              chatStore.activeTaskId
                ? chatStore.tasks[chatStore.activeTaskId]?.tokens || 0
                : 0
            }
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <ChatBox />
          </div>
        </div>

        <AnimatePresence initial={false}>
          {previewOpen && (
            <motion.div
              key="session-display-content"
              initial={
                shouldReduceMotion
                  ? { flexGrow: 1, opacity: 0, transform: 'translateX(0%)' }
                  : { flexGrow: 0, opacity: 0, transform: 'translateX(3%)' }
              }
              animate={{
                flexGrow: 1,
                opacity: 1,
                transform: 'translateX(0%)',
              }}
              exit={
                shouldReduceMotion
                  ? { flexGrow: 0, opacity: 0, transform: 'translateX(0%)' }
                  : { flexGrow: 0, opacity: 0, transform: 'translateX(3%)' }
              }
              transition={
                shouldReduceMotion
                  ? {
                      flexGrow: { duration: 0 },
                      transform: { duration: 0 },
                      opacity: DISPLAY_PANEL_FADE,
                    }
                  : {
                      flexGrow: DISPLAY_PANEL_SPRING,
                      transform: DISPLAY_PANEL_SPRING,
                      opacity: DISPLAY_PANEL_FADE,
                    }
              }
              className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              <div
                onPointerDown={handlePreviewResizeStart}
                role="separator"
                aria-orientation="vertical"
                data-resize-handle-state={
                  isResizingPreview ? 'drag' : 'inactive'
                }
                // Transparent 2px rail with a centered line and wider hit area.
                className="relative z-10 flex w-[2px] shrink-0 cursor-col-resize items-center justify-center bg-transparent before:absolute before:inset-y-0 before:-right-1 before:-left-1 before:content-[''] after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 after:bg-ds-neutral-default-default after:opacity-0 after:transition-opacity hover:after:opacity-100"
              />

              {/* Display content: middle column between chat and session. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {activeProjectId ? (
                  <PreviewPanel
                    displaySettled={displaySettled}
                    onJumpToFiles={handleJumpToFiles}
                  />
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div
          id="session-side-panel"
          className={cn(
            'flex min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out',
            isSidePanelVisible
              ? RIGHT_RAIL_EXPANDED_OUTER_CLASS
              : cn(RIGHT_RAIL_FOLDED_OUTER_CLASS, 'rounded-l-xl')
          )}
        >
          {sessionSidePanel}
        </div>
      </div>
    </ProjectEventRuntimeProvider>
  );
}
