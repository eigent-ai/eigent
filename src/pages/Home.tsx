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
import Folder from '@/components/Folder';
import { AppResizableShell } from '@/components/Layout/AppResizableShell';
import PageSidebar from '@/components/PageSidebar';
import { PROJECT_SIDEBAR_FOLD_SPRING } from '@/components/PageSidebar/constants';
import SessionGroup from '@/components/Session/SessionGroup';
import TriggerPanel from '@/components/Trigger';
import UpdateElectron from '@/components/update';
import Workspace from '@/components/Workspace';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { ChatTaskStatus } from '@/types/constants';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore, type WorkspaceMainBackground } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  EXECUTION_LOGS_OPEN_STORAGE_KEY,
  type TriggerSortKey,
} from '../components/Trigger/Triggers';

import Session from '@/components/Session';

/** Same spring as project sidebar fold animation. */
const HOME_MAIN_LAYOUT_SPRING = PROJECT_SIDEBAR_FOLD_SPRING;

const HOME_SIDEBAR_WIDTH_STORAGE_KEY = 'eigent-home-sidebar-width-px';

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
  const workspacePatternKey = useMemo((): WorkspaceMainBackground => {
    if (!useWorkspacePatternBg) return 'empty';
    return (workspaceMainBackground ?? 'empty') as WorkspaceMainBackground;
  }, [useWorkspacePatternBg, workspaceMainBackground]);

  const workspaceMainContentClass = cn(
    mainPanelContentClass,
    workspacePatternKey !== 'empty' && 'relative'
  );

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
            onDeleteSession={handleSessionGroupDeleteSession}
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
      <div className="min-h-0 px-1 pb-1 pt-12 flex h-full flex-row overflow-hidden">
        <AppResizableShell
          sidebarWidthStorageKey={HOME_SIDEBAR_WIDTH_STORAGE_KEY}
          panelGroupId="home-shell-panel-group"
          sidebar={<PageSidebar variant="project" chatStore={chatStore} />}
          layoutSpring={HOME_MAIN_LAYOUT_SPRING}
          sidebarDefaultSize={24}
          main={
            <div className={mainPanelShellClass}>
              {renderActiveWorkspaceTab()}
            </div>
          }
          mainMotionClassName="min-h-0 min-w-0 gap-4 relative flex h-full w-full flex-col overflow-hidden"
        />
        <UpdateElectron />
      </div>
    </ReactFlowProvider>
  );
}
