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
  DashedLinesBackground,
  DotPatternBackground,
  DottedLinesBackground,
  GridPatternBackground,
  RuledLinesBackground,
} from '@/components/Background';
import { WorkspaceDispatch } from '@/components/Dispatch';
import Folder from '@/components/Folder';
import AppShellLayout, {
  APP_SHELL_CONTENT_CLASS,
} from '@/components/Layout/AppShellLayout';
import SessionGroup from '@/components/Session/SidePanel/components/SessionGroup';
import SpaceSidebar from '@/components/SpaceSidebar';
import TriggerPanel from '@/components/Trigger';
import Workspace from '@/components/Workspace';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';
import { cn } from '@/lib/utils';
import { ChatTaskStatus } from '@/types/constants';
import { ReactFlowProvider } from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  EXECUTION_LOGS_OPEN_STORAGE_KEY,
  type TriggerSortKey,
} from '../components/Trigger/Triggers';

import Session from '@/components/Session';
import { PreviewBrowserLayer } from '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer';

export default function WorkspacePage() {
  const { t } = useTranslation();
  const host = useHost();
  const ipc = host?.ipcRenderer;
  const electronAPI = host?.electronAPI;
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeProjectId = projectStore.activeProjectId;
  const activeProjectMeta = useSpaceStore((state) =>
    activeProjectId ? state.getProjectMeta(activeProjectId) : null
  );

  const { activeWorkspaceTab, setHasAgentFiles, setActiveWorkspaceTab } =
    usePageTabStore();
  const workspaceSidebarHidden = usePageTabStore(
    (s) => s.workspaceSidebarHidden
  );
  const triggerAddDialogRequestId = usePageTabStore(
    (s) => s.triggerAddDialogRequestId
  );
  const triggerSelectRequestId = usePageTabStore(
    (s) => s.triggerSelectRequestId
  );
  const pendingTriggerSelectId = usePageTabStore(
    (s) => s.pendingTriggerSelectId
  );

  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
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
    if (triggerSelectRequestId === 0) return;
    if (pendingTriggerSelectId != null) {
      setTriggerSelectedId(pendingTriggerSelectId);
    }
  }, [pendingTriggerSelectId, triggerSelectRequestId]);

  useEffect(() => {
    checkLocalServerStale();
  }, []);

  // Project-scoped tabs (except new-project shell) require an active project.
  // When opening files/runs/project from the workspace tab without a selection,
  // fall back to the last visited (or first) project in the space instead of
  // bouncing back to workforce.
  useLayoutEffect(() => {
    const isProjectScopedTab =
      activeWorkspaceTab === 'project' ||
      activeWorkspaceTab === 'files' ||
      activeWorkspaceTab === 'runs';

    if (!isProjectScopedTab || activeProjectId) return;

    const spaceStore = useSpaceStore.getState();
    const spaceId = activeSpaceId ?? spaceStore.activeSpaceId;
    if (!spaceId) {
      setActiveWorkspaceTab('workforce');
      return;
    }

    const projectsInSpace = spaceStore.getProjectsForSpace(spaceId);
    if (projectsInSpace.length > 0) {
      const lastVisitedProjectId =
        spaceStore.lastVisitedProjectBySpace[spaceId];
      const targetProject =
        projectsInSpace.find(
          (project) => project.id === lastVisitedProjectId
        ) ?? projectsInSpace[0];
      projectStore.setActiveProject(targetProject.id);
      return;
    }

    setActiveWorkspaceTab('workforce');
  }, [
    activeProjectId,
    activeSpaceId,
    activeWorkspaceTab,
    projectStore,
    setActiveWorkspaceTab,
  ]);

  // Detect files and triggers when project loads
  useEffect(() => {
    const detectAgentFiles = async () => {
      if (!projectStore.activeProjectId || !email) return;
      try {
        const files = await ipc?.invoke(
          'get-project-file-list',
          email,
          projectStore.activeProjectId,
          userId
        );
        setHasAgentFiles(
          Array.isArray(files) && filterVisibleAgentFiles(files).length > 0
        );
      } catch (error) {
        console.error('Error detecting agent files:', error);
      }
    };

    detectAgentFiles();
  }, [projectStore.activeProjectId, email, userId, setHasAgentFiles, ipc]);

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
              const projectId = activeProjectId || undefined;
              chatStore.setSnapshotsTemp(chatStore.activeTaskId as string, {
                api_task_id: chatStore.activeTaskId,
                run_id: chatStore.activeTaskId,
                space_id:
                  activeProjectMeta?.spaceId || activeSpaceId || undefined,
                project_id: projectId,
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
  }, [
    activeProjectId,
    activeProjectMeta,
    activeSpaceId,
    chatStore,
    taskAssigning,
    ipc,
  ]);

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
  }, [chatStore, getSize]);

  const mainPanelContentClass = APP_SHELL_CONTENT_CLASS;

  const useWorkspacePatternBg =
    activeWorkspaceTab === 'workforce' ||
    activeWorkspaceTab === 'project' ||
    activeWorkspaceTab === 'new-project';
  const workspacePatternKey = useMemo((): WorkspaceMainBackground => {
    if (!useWorkspacePatternBg) return 'empty';
    return (workspaceMainBackground ?? 'empty') as WorkspaceMainBackground;
  }, [useWorkspacePatternBg, workspaceMainBackground]);

  const workspaceMainContentClass = cn(
    mainPanelContentClass,
    workspacePatternKey !== 'empty' && 'relative isolate'
  );

  const workspaceMainForegroundClass =
    'relative z-[1] flex min-h-0 min-w-0 flex-1 flex-col';

  const workspacePatternOverlayEl = useMemo(() => {
    switch (workspacePatternKey) {
      case 'dots':
        return <DotPatternBackground />;
      case 'blocks':
        return <GridPatternBackground />;
      case 'ruled':
        return <RuledLinesBackground />;
      case 'dotted':
        return <DottedLinesBackground />;
      case 'dashed':
        return <DashedLinesBackground />;
      default:
        return null;
    }
  }, [workspacePatternKey]);

  const handleSessionGroupDeleteSession = useCallback(
    (sessionId: string) => {
      if (!chatStore) return;
      if (!window.confirm(t('layout.delete-task-confirmation'))) return;
      const wasActive = chatStore.activeTaskId === sessionId;
      chatStore.removeTask(sessionId);
      if (wasActive) {
        setActiveWorkspaceTab('workforce');
      }
    },
    [chatStore, setActiveWorkspaceTab, t]
  );

  const renderActiveWorkspaceTab = () => {
    switch (activeWorkspaceTab) {
      case 'workforce':
        return (
          <div className={workspaceMainContentClass}>
            {workspacePatternOverlayEl}
            <div className={workspaceMainForegroundClass}>
              <Workspace />
            </div>
          </div>
        );
      case 'project':
        return (
          <div className={workspaceMainContentClass}>
            {workspacePatternOverlayEl}
            <div className={workspaceMainForegroundClass}>
              <Session />
            </div>
          </div>
        );
      case 'new-project':
        return (
          <div className={workspaceMainContentClass}>
            {workspacePatternOverlayEl}
            <div className={workspaceMainForegroundClass}>
              <Session isNewProject />
            </div>
          </div>
        );
      case 'dispatch':
        return (
          <div className={mainPanelContentClass}>
            <WorkspaceDispatch />
          </div>
        );
      case 'files':
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
      case 'runs':
        return (
          <SessionGroup
            className={mainPanelContentClass}
            tasks={chatStore?.tasks ?? {}}
            activeSessionId={chatStore?.activeTaskId ?? undefined}
            onSelectSession={(sessionId) => {
              if (!chatStore) return;
              chatStore.setActiveTaskId(sessionId);
              setActiveWorkspaceTab('project');
            }}
            onDeleteSession={handleSessionGroupDeleteSession}
          />
        );
      default:
        return null;
    }
  };

  return (
    <ReactFlowProvider>
      <AppShellLayout
        sidebar={<SpaceSidebar chatStore={chatStore} />}
        sidebarHidden={workspaceSidebarHidden}
        /* Always mounted: hosts preview <webview> guests so their pages and
           history survive panel close, workspace-tab hops, and project
           switches. Renders nothing on the web host. */
        overlay={<PreviewBrowserLayer />}
      >
        {renderActiveWorkspaceTab()}
      </AppShellLayout>
    </ReactFlowProvider>
  );
}
