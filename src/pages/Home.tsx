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

import { checkLocalServerStale } from '@/api/http';
import {
  DotPatternBackground,
  GridPatternBackground,
} from '@/components/Background';
import Folder from '@/components/Folder';
import ProjectPageSidebar from '@/components/ProjectPageSidebar';
import {
  PROJECT_SIDEBAR_FOLD_SPRING,
  PROJECT_SIDEBAR_RAIL_WIDTH_PX,
} from '@/components/ProjectPageSidebar/constants';
import SessionGroup from '@/components/Session/SessionGroup';
import TriggerPanel from '@/components/Trigger';
import UpdateElectron from '@/components/update';
import Workspace from '@/components/Workspace';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { ChatTaskStatus } from '@/types/constants';
import { ReactFlowProvider } from '@xyflow/react';
import { motion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  EXECUTION_LOGS_OPEN_STORAGE_KEY,
  type TriggerSortKey,
} from '../components/Trigger/Triggers';

import Session from '@/components/Session';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import type {
  ImperativePanelGroupHandle,
  ImperativePanelHandle,
} from 'react-resizable-panels';

/** Same spring as project sidebar fold animation. */
const HOME_MAIN_LAYOUT_SPRING = PROJECT_SIDEBAR_FOLD_SPRING;

/** Sidebar width bounds (react-resizable-panels uses %; derived from shell width). */
const SIDEBAR_MIN_PX = 240;
const SIDEBAR_MAX_PX = 400;
/** Default expanded sidebar width when nothing is stored (px). */
const DEFAULT_SIDEBAR_WIDTH_PX = 288;
const SIDEBAR_WIDTH_STORAGE_KEY = 'eigent-home-sidebar-width-px';

function clampPct(n: number): number {
  return Math.min(100, Math.max(1, n));
}

function readStoredSidebarWidthPx(): number {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_WIDTH_PX;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null) return DEFAULT_SIDEBAR_WIDTH_PX;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return DEFAULT_SIDEBAR_WIDTH_PX;
    return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, n));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }
}

export default function Home() {
  const { t } = useTranslation();
  const host = useHost();
  const ipc = host?.ipcRenderer;
  const electronAPI = host?.electronAPI;
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const { activeWorkspaceTab, setHasAgentFiles, setActiveWorkspaceTab } =
    usePageTabStore();
  const triggerAddDialogRequestId = usePageTabStore(
    (s) => s.triggerAddDialogRequestId
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const setProjectSidebarFolded = usePageTabStore(
    (s) => s.setProjectSidebarFolded
  );

  const email = useAuthStore((s) => s.email);
  const workspaceMainBackground = useAuthStore(
    (s) => s.workspaceMainBackground
  );

  const [, setActiveWebviewId] = useState<string | null>(null);
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const [triggerSortBy, setTriggerSortBy] =
    useState<TriggerSortKey>('createdAt');
  const [triggerSelectedId, setTriggerSelectedId] = useState<number | null>(
    null
  );
  const [triggerExecutionLogsOpen, setTriggerExecutionLogsOpen] = useState(
    () => {
      if (typeof window === 'undefined') return false;
      return (
        window.localStorage.getItem(EXECUTION_LOGS_OPEN_STORAGE_KEY) === 'true'
      );
    }
  );

  const shellPanelGroupRef = useRef<HTMLDivElement>(null);
  const shellWidthRef = useRef(0);
  const shellPanelGroupImperativeRef = useRef<ImperativePanelGroupHandle>(null);
  const projectSidebarPanelRef = useRef<ImperativePanelHandle>(null);
  const applyingSidebarLayoutRef = useRef(false);
  const sidebarLayoutAnimationFrameRef = useRef<number | null>(null);
  const hasInitializedSidebarLayoutRef = useRef(false);
  /** Expanded sidebar width in px; only user drag (or stored value) changes this — window resize adjusts % to keep this width. */
  const sidebarWidthPxRef = useRef(readStoredSidebarWidthPx());
  const persistSidebarWidthTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  /** Percent constraints for the sidebar panel (1–100). `rail` = folded rail width. */
  const [sidebarPct, setSidebarPct] = useState({
    min: 18,
    max: 35,
    rail: 4,
  });

  const mainPanelPct = useMemo(() => {
    const min = Math.max(1, 100 - sidebarPct.max);
    const max = Math.max(min, Math.min(99, 100 - sidebarPct.min));
    return { min, max };
  }, [sidebarPct.min, sidebarPct.max]);

  /** When folded, main must be allowed to reach `100 - rail` (~98%); else max ~82% blocks a 40px sidebar. */
  const mainPanelMaxSize = useMemo(() => {
    if (projectSidebarFolded) {
      return Math.min(99, 100 - sidebarPct.rail);
    }
    return mainPanelPct.max;
  }, [projectSidebarFolded, sidebarPct.rail, mainPanelPct.max]);

  const schedulePersistSidebarWidth = useCallback((px: number) => {
    if (persistSidebarWidthTimeoutRef.current) {
      clearTimeout(persistSidebarWidthTimeoutRef.current);
    }
    persistSidebarWidthTimeoutRef.current = setTimeout(() => {
      persistSidebarWidthTimeoutRef.current = null;
      try {
        window.localStorage.setItem(
          SIDEBAR_WIDTH_STORAGE_KEY,
          String(Math.round(px))
        );
      } catch {
        /* ignore */
      }
    }, 250);
  }, []);

  const setShellPanelLayout = useCallback(
    (layout: number[], animate: boolean) => {
      const group = shellPanelGroupImperativeRef.current;
      if (!group) return;

      const target = layout.map(clampPct);

      if (sidebarLayoutAnimationFrameRef.current != null) {
        cancelAnimationFrame(sidebarLayoutAnimationFrameRef.current);
        sidebarLayoutAnimationFrameRef.current = null;
      }

      const applyFinalLayout = () => {
        group.setLayout(target);
        requestAnimationFrame(() => {
          applyingSidebarLayoutRef.current = false;
        });
      };

      const current = group.getLayout();
      const shouldAnimate =
        animate &&
        current.length === target.length &&
        current.some((value, index) => Math.abs(value - target[index]) > 0.1);

      applyingSidebarLayoutRef.current = true;

      if (!shouldAnimate) {
        applyFinalLayout();
        return;
      }

      const from = [...current];
      const durationMs = 260;
      const start = performance.now();

      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        group.setLayout(
          from.map((value, index) => value + (target[index] - value) * eased)
        );

        if (progress < 1) {
          sidebarLayoutAnimationFrameRef.current = requestAnimationFrame(tick);
          return;
        }

        sidebarLayoutAnimationFrameRef.current = null;
        applyFinalLayout();
      };

      sidebarLayoutAnimationFrameRef.current = requestAnimationFrame(tick);
    },
    []
  );

  /** Recompute sidebar % from fixed px so the rail does not grow/shrink when the window resizes. */
  const applyExpandedSidebarLayout = useCallback(
    (animate: boolean = false) => {
      const shell = shellPanelGroupRef.current;
      if (!shell) return;
      if (usePageTabStore.getState().projectSidebarFolded) return;
      const w = shell.getBoundingClientRect().width;
      if (w <= 0) return;
      const minPct = clampPct((SIDEBAR_MIN_PX / w) * 100);
      const maxPct = clampPct((SIDEBAR_MAX_PX / w) * 100);
      const px = Math.min(
        SIDEBAR_MAX_PX,
        Math.max(SIDEBAR_MIN_PX, sidebarWidthPxRef.current)
      );
      let pct = (px / w) * 100;
      pct = Math.min(maxPct, Math.max(minPct, pct));
      setShellPanelLayout([pct, 100 - pct], animate);
    },
    [setShellPanelLayout]
  );

  const handleShellPanelLayout = useCallback(
    (sizes: number[]) => {
      if (applyingSidebarLayoutRef.current) return;
      const shell = shellPanelGroupRef.current;
      if (!shell) return;
      const shellW = shell.getBoundingClientRect().width;
      if (shellW <= 0) return;

      const sidebarPx = (sizes[0] / 100) * shellW;
      const folded = usePageTabStore.getState().projectSidebarFolded;

      if (!folded && sidebarPx < SIDEBAR_MIN_PX - 0.5) {
        applyingSidebarLayoutRef.current = true;
        setProjectSidebarFolded(true);
        const rail = clampPct((PROJECT_SIDEBAR_RAIL_WIDTH_PX / shellW) * 100);
        const main = Math.min(99, Math.max(0, 100 - rail));
        shellPanelGroupImperativeRef.current?.setLayout([rail, main]);
        requestAnimationFrame(() => {
          applyingSidebarLayoutRef.current = false;
        });
        return;
      }

      if (folded && sidebarPx > PROJECT_SIDEBAR_RAIL_WIDTH_PX + 1.5) {
        applyingSidebarLayoutRef.current = true;
        setProjectSidebarFolded(false);
        requestAnimationFrame(() => {
          applyingSidebarLayoutRef.current = false;
        });
        return;
      }

      if (!folded) {
        sidebarWidthPxRef.current = Math.min(
          SIDEBAR_MAX_PX,
          Math.max(SIDEBAR_MIN_PX, sidebarPx)
        );
        schedulePersistSidebarWidth(sidebarWidthPxRef.current);
      }
    },
    [schedulePersistSidebarWidth, setProjectSidebarFolded]
  );

  /** Expanded: apply stored px width when leaving folded or on first paint. */
  useLayoutEffect(() => {
    if (projectSidebarFolded) return;
    applyExpandedSidebarLayout(hasInitializedSidebarLayoutRef.current);
    hasInitializedSidebarLayoutRef.current = true;
  }, [projectSidebarFolded, applyExpandedSidebarLayout]);

  /** Folded: exact rail + main split (`setLayout`); update when shell width changes rail %. */
  useLayoutEffect(() => {
    if (!projectSidebarFolded) return;
    const rail = sidebarPct.rail;
    const main = Math.min(99, Math.max(0, 100 - rail));
    setShellPanelLayout(
      [rail, main],
      hasInitializedSidebarLayoutRef.current && sidebarWidthPxRef.current > 0
    );
    hasInitializedSidebarLayoutRef.current = true;
  }, [projectSidebarFolded, sidebarPct.rail, setShellPanelLayout]);

  useEffect(() => {
    const el = shellPanelGroupRef.current;
    if (!el) return;

    const update = () => {
      const w = el.getBoundingClientRect().width;
      if (w <= 0) return;
      const prevW = shellWidthRef.current;
      shellWidthRef.current = w;
      const minPct = clampPct((SIDEBAR_MIN_PX / w) * 100);
      const maxPct = clampPct((SIDEBAR_MAX_PX / w) * 100);
      const railPct = clampPct((PROJECT_SIDEBAR_RAIL_WIDTH_PX / w) * 100);
      setSidebarPct({
        min: minPct,
        max: Math.max(minPct, maxPct),
        rail: railPct,
      });

      if (
        !usePageTabStore.getState().projectSidebarFolded &&
        prevW > 0 &&
        Math.abs(w - prevW) > 0.5
      ) {
        applyExpandedSidebarLayout();
      }
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyExpandedSidebarLayout]);

  useEffect(() => {
    return () => {
      if (sidebarLayoutAnimationFrameRef.current != null) {
        cancelAnimationFrame(sidebarLayoutAnimationFrameRef.current);
      }
      if (persistSidebarWidthTimeoutRef.current) {
        clearTimeout(persistSidebarWidthTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      EXECUTION_LOGS_OPEN_STORAGE_KEY,
      String(triggerExecutionLogsOpen)
    );
  }, [triggerExecutionLogsOpen]);

  useEffect(() => {
    if (triggerAddDialogRequestId === 0) return;
    setTriggerDialogOpen(true);
  }, [triggerAddDialogRequestId]);

  useEffect(() => {
    setTriggerSelectedId(null);
  }, [projectStore.activeProjectId]);

  useEffect(() => {
    checkLocalServerStale();
  }, []);

  // Detect files and triggers when project loads
  useEffect(() => {
    const detectAgentFiles = async () => {
      if (!projectStore.activeProjectId || !email) return;
      try {
        const files = await ipc?.invoke(
          'get-project-file-list',
          email,
          projectStore.activeProjectId
        );
        setHasAgentFiles(files && files.length > 0);
      } catch (error) {
        console.error('Error detecting agent files:', error);
      }
    };

    detectAgentFiles();
  }, [projectStore.activeProjectId, email, setHasAgentFiles, ipc]);

  // Add webview-show listener in useEffect with cleanup
  useEffect(() => {
    const handleWebviewShow = (_event: any, id: string) => {
      setActiveWebviewId(id);
    };

    ipc?.on('webview-show', handleWebviewShow);

    // Cleanup: remove listener on unmount
    return () => {
      ipc?.off('webview-show', handleWebviewShow);
    };
  }, [ipc]);

  // Extract complex dependency to a variable
  const taskAssigning =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.taskAssigning;

  useEffect(() => {
    if (!chatStore) return;

    let taskAssigningArray = [...(taskAssigning || [])];
    let webviews: { id: string; agent_id: string; index: number }[] = [];
    taskAssigningArray.map((item) => {
      if (item.type === 'browser_agent') {
        item.activeWebviewIds?.map((webview, index) => {
          webviews.push({ ...webview, agent_id: item.agent_id, index });
        });
      }
    });

    if (taskAssigningArray.length === 0) {
      return;
    }

    if (webviews.length === 0) {
      const browserAgent = taskAssigningArray.find(
        (agent) => agent.type === 'browser_agent'
      );
      if (
        browserAgent &&
        browserAgent.activeWebviewIds &&
        browserAgent.activeWebviewIds.length > 0
      ) {
        browserAgent.activeWebviewIds.forEach((webview, index) => {
          webviews.push({ ...webview, agent_id: browserAgent.agent_id, index });
        });
      }
    }

    if (webviews.length === 0) {
      return;
    }

    // capture webview
    const captureWebview = async () => {
      const activeTask = chatStore.tasks[chatStore.activeTaskId as string];
      if (!activeTask || activeTask.status === ChatTaskStatus.FINISHED) {
        return;
      }
      webviews.map((webview) => {
        void ipc
          ?.invoke('capture-webview', webview.id)
          ?.then((base64: string) => {
            const currentTask =
              chatStore.tasks[chatStore.activeTaskId as string];
            if (!currentTask || currentTask.type) return;
            let taskAssigning = [...currentTask.taskAssigning];
            const browserAgentIndex = taskAssigning.findIndex(
              (agent) => agent.agent_id === webview.agent_id
            );

            if (
              browserAgentIndex !== -1 &&
              base64 !== 'data:image/jpeg;base64,'
            ) {
              taskAssigning[browserAgentIndex].activeWebviewIds![
                webview.index
              ].img = base64;
              chatStore.setTaskAssigning(
                chatStore.activeTaskId as string,
                taskAssigning
              );
              const { processTaskId, url } =
                taskAssigning[browserAgentIndex].activeWebviewIds![
                  webview.index
                ];
              chatStore.setSnapshotsTemp(chatStore.activeTaskId as string, {
                api_task_id: chatStore.activeTaskId,
                camel_task_id: processTaskId,
                browser_url: url,
                image_base64: base64,
              });
            }
          })
          .catch((error: unknown) => {
            console.error('capture webview error:', error);
          });
      });
    };

    let intervalTimer: NodeJS.Timeout | null = null;

    const initialTimer = setTimeout(() => {
      captureWebview();
      intervalTimer = setInterval(captureWebview, 2000);
    }, 2000);

    // cleanup function
    return () => {
      clearTimeout(initialTimer);
      if (intervalTimer) {
        clearInterval(intervalTimer);
      }
    };
  }, [chatStore, taskAssigning, ipc]);

  const getSize = useCallback(() => {
    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer) {
      const rect = webviewContainer.getBoundingClientRect();
      electronAPI?.setSize({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [electronAPI]);

  useEffect(() => {
    if (!chatStore) return;

    if (!chatStore.activeTaskId) {
      projectStore?.createProject('new project');
    }

    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer) {
      const resizeObserver = new ResizeObserver(() => {
        getSize();
      });
      resizeObserver.observe(webviewContainer);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [chatStore, projectStore, getSize]);

  const mainPanelSurfaceClass =
    'rounded-2xl bg-ds-bg-neutral-subtle-default min-w-0 flex h-full w-full flex-col overflow-hidden';
  const mainPanelContentClass = 'min-h-0 min-w-0 flex h-full w-full flex-col';
  const mainPanelShellClass = cn(mainPanelSurfaceClass);

  const useWorkspacePatternBg =
    activeWorkspaceTab === 'workforce' || activeWorkspaceTab === 'session';
  const workspacePatternMode = useMemo((): 'dots' | 'blocks' | null => {
    if (!useWorkspacePatternBg) return null;
    const mode = (workspaceMainBackground ?? 'none') as WorkspaceMainBackground;
    if (mode === 'none') return null;
    if (mode === 'dots') return 'dots';
    return 'blocks';
  }, [useWorkspacePatternBg, workspaceMainBackground]);

  const workspaceMainContentClass = cn(
    mainPanelContentClass,
    workspacePatternMode != null && 'relative'
  );

  const workspacePatternOverlayEl =
    workspacePatternMode === 'dots' ? (
      <DotPatternBackground />
    ) : workspacePatternMode === 'blocks' ? (
      <GridPatternBackground />
    ) : null;

  const renderActiveWorkspaceTab = () => {
    switch (activeWorkspaceTab) {
      case 'workforce':
        return (
          <div className={workspaceMainContentClass}>
            {workspacePatternOverlayEl}
            <Workspace />
          </div>
        );
      case 'session':
        return (
          <div className={workspaceMainContentClass}>
            {workspacePatternOverlayEl}
            <Session />
          </div>
        );
      case 'inbox':
        return (
          <div className={mainPanelContentClass}>
            <Folder />
          </div>
        );
      case 'triggers':
        return (
          <TriggerPanel
            className={mainPanelContentClass}
            sortBy={triggerSortBy}
            onSortByChange={setTriggerSortBy}
            selectedTriggerId={triggerSelectedId}
            onSelectedTriggerIdChange={setTriggerSelectedId}
            isExecutionLogsOpen={triggerExecutionLogsOpen}
            onExecutionLogsOpenChange={setTriggerExecutionLogsOpen}
            isDialogOpen={triggerDialogOpen}
            onDialogOpenChange={setTriggerDialogOpen}
          />
        );
      case 'sessions':
        return (
          <SessionGroup
            className={mainPanelContentClass}
            tasks={chatStore.tasks}
            activeSessionId={chatStore.activeTaskId}
            onSelectSession={(sessionId) => {
              chatStore.setActiveTaskId(sessionId);
              setActiveWorkspaceTab('session');
            }}
          />
        );
      default:
        return null;
    }
  };

  if (!chatStore) {
    return <div>{t('triggers.loading')}</div>;
  }

  return (
    <ReactFlowProvider>
      <div className="min-h-0 px-1 pb-1 pt-10 flex h-full flex-row overflow-hidden">
        <div
          ref={shellPanelGroupRef}
          className="min-h-0 min-w-0 rounded-2xl bg-ds-bg-neutral-default-default h-full w-full flex-1"
        >
          <ResizablePanelGroup
            ref={shellPanelGroupImperativeRef}
            id="home-shell-panel-group"
            direction="horizontal"
            className="min-h-0 gap-0 h-full w-full"
            onLayout={handleShellPanelLayout}
          >
            <ResizablePanel
              ref={projectSidebarPanelRef}
              defaultSize={24}
              minSize={sidebarPct.rail}
              maxSize={sidebarPct.max}
              className="min-h-0 min-w-0 pl-1"
            >
              <ProjectPageSidebar chatStore={chatStore} />
            </ResizablePanel>
            <ResizableHandle
              className={cn(
                'w-1 after:bg-ds-bg-neutral-default-default shrink-0 bg-transparent after:transition-colors',
                'hover:after:bg-ds-bg-brand-default-focus transition-colors',
                'data-[resize-handle-state=drag]:after:bg-ds-bg-brand-default-focus'
              )}
            />
            <ResizablePanel
              defaultSize={76}
              minSize={mainPanelPct.min}
              maxSize={mainPanelMaxSize}
              className="min-h-0 min-w-[300px]"
            >
              <motion.div
                layout
                transition={{ layout: HOME_MAIN_LAYOUT_SPRING }}
                className="min-h-0 min-w-0 gap-4 relative flex h-full w-full flex-col overflow-hidden"
              >
                <div className={mainPanelShellClass}>
                  {renderActiveWorkspaceTab()}
                </div>
              </motion.div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <UpdateElectron />
      </div>
    </ReactFlowProvider>
  );
}
