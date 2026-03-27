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
import Folder from '@/components/Folder';
import ProjectPageSidebar from '@/components/ProjectPageSidebar';
import UpdateElectron from '@/components/update';
import Workflow from '@/components/WorkFlow';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useInitialChatPanelLayout } from '@/hooks/useInitialChatPanelLayout';
import { ChatTaskStatus } from '@/types/constants';
import { ReactFlowProvider } from '@xyflow/react';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImperativePanelHandle } from 'react-resizable-panels';

import { AddWorker } from '@/components/AddWorker';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';

import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useTriggerStore } from '@/store/triggerStore';
import {
  ArrowUpDown,
  Plus,
  SquareChevronRight,
  SquareCode,
} from 'lucide-react';
import Overview, {
  EXECUTION_LOGS_OPEN_STORAGE_KEY,
  sortTriggersList,
  type TriggerSortKey,
} from './Project/Triggers';

import BrowserAgentWorkspace from '@/components/BrowserAgentWorkSpace';
import TerminalAgentWorkspace from '@/components/TerminalAgentWorkspace';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';

import BottomBar from '@/components/BottomBar';

/** Keep in sync with ProjectPageSidebar PROJECT_SIDEBAR_SPRING */
const HOME_MAIN_LAYOUT_SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 38,
  mass: 0.85,
};

export default function Home() {
  const { t } = useTranslation();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const {
    activeWorkspaceTab,
    chatPanelPosition,
    setChatPanelPosition,
    setHasTriggers,
    setHasAgentFiles,
    markTabAsUnviewed,
  } = usePageTabStore();
  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );

  const { wsConnectionStatus, triggers } = useTriggerStore();
  const authStore = useAuthStore.getState();

  const [activeWebviewId, setActiveWebviewId] = useState<string | null>(null);
  const [isChatBoxVisible, setIsChatBoxVisible] = useState(true);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
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

  const sortedTriggersForHeader = useMemo(
    () => sortTriggersList(triggers, triggerSortBy),
    [triggers, triggerSortBy]
  );

  const triggerSortLabel = useMemo(() => {
    switch (triggerSortBy) {
      case 'createdAt':
        return t('triggers.created-time');
      case 'lastExecutionTime':
        return t('triggers.last-execution-label');
      case 'tokens':
        return t('triggers.token-cost');
      default:
        return t('triggers.created-time');
    }
  }, [triggerSortBy, t]);

  useEffect(() => {
    window.localStorage.setItem(
      EXECUTION_LOGS_OPEN_STORAGE_KEY,
      String(triggerExecutionLogsOpen)
    );
  }, [triggerExecutionLogsOpen]);

  useEffect(() => {
    setTriggerSelectedId(null);
  }, [projectStore.activeProjectId]);

  useEffect(() => {
    if (workspaceChatFocusRequestId === 0) return;
    setIsChatBoxVisible(true);
  }, [workspaceChatFocusRequestId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  useInitialChatPanelLayout(
    'home-main-panel-group',
    chatPanelRef,
    isChatBoxVisible && activeWorkspaceTab === 'workforce',
    `${isChatBoxVisible}-${chatPanelPosition}-${activeWorkspaceTab}`
  );

  const toggleChatBox = () => {
    setIsChatBoxVisible((prev) => !prev);
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Get the active project's folder path
    const activeProjectId = projectStore.activeProjectId;
    if (!activeProjectId) return;

    // Upload files using electron API
    for (const file of Array.from(files)) {
      try {
        const reader = new FileReader();
        reader.onload = async () => {
          if (reader.result && window.ipcRenderer) {
            await window.ipcRenderer.invoke('save-file-to-agent-folder', {
              projectId: activeProjectId,
              fileName: file.name,
              content: reader.result,
            });
            // Mark the inbox tab as having new content
            setHasAgentFiles(true);
            if (activeWorkspaceTab !== 'inbox') {
              markTabAsUnviewed('inbox');
            }
          }
        };
        reader.readAsArrayBuffer(file);
      } catch (error) {
        console.error('Error uploading file:', error);
      }
    }

    // Reset input
    e.target.value = '';
  };

  // Detect files and triggers when project loads
  useEffect(() => {
    const detectAgentFiles = async () => {
      if (!projectStore.activeProjectId || !authStore.email) return;
      try {
        const files = await window.ipcRenderer?.invoke(
          'get-project-file-list',
          authStore.email,
          projectStore.activeProjectId
        );
        setHasAgentFiles(files && files.length > 0);
      } catch (error) {
        console.error('Error detecting agent files:', error);
      }
    };

    // For triggers, since we're using mock data, we set hasTriggers to true
    // When you have real trigger data, replace this with an API call
    setHasTriggers(true); // Mock data has triggers

    detectAgentFiles();
  }, [
    projectStore.activeProjectId,
    authStore.email,
    setHasAgentFiles,
    setHasTriggers,
  ]);

  // Add webview-show listener in useEffect with cleanup
  useEffect(() => {
    const handleWebviewShow = (_event: any, id: string) => {
      setActiveWebviewId(id);
    };

    window.ipcRenderer?.on('webview-show', handleWebviewShow);

    // Cleanup: remove listener on unmount
    return () => {
      window.ipcRenderer?.off('webview-show', handleWebviewShow);
    };
  }, []); // Empty dependency array means this only runs once

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
        window.ipcRenderer
          .invoke('capture-webview', webview.id)
          .then((base64: string) => {
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
  }, [chatStore, taskAssigning]);

  const getSize = useCallback(() => {
    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer) {
      const rect = webviewContainer.getBoundingClientRect();
      window.electronAPI.setSize({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }, []);

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

  if (!chatStore) {
    return <div>{t('triggers.loading')}</div>;
  }

  const renderWorkforceWorkspaceContent = () => {
    const activeTask = chatStore.activeTaskId
      ? chatStore.tasks[chatStore.activeTaskId]
      : null;
    const activeWorkSpace = activeTask?.activeWorkspace;

    if (!activeTask || !activeWorkSpace) {
      return (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="inset-0 rounded-xl pointer-events-none absolute bg-transparent"></div>
            <div className="relative z-10 h-full w-full">
              <Workflow taskAssigning={[]} />
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {activeTask.taskAssigning?.find(
          (agent) => agent.agent_id === activeWorkSpace
        )?.type === 'browser_agent' && (
          <div className="animate-in fade-in-0 slide-in-from-right-2 flex h-full w-full flex-1 duration-300">
            <BrowserAgentWorkspace />
          </div>
        )}
        {activeWorkSpace === 'workflow' && (
          <div className="flex h-full w-full flex-1 items-center justify-center">
            <div className="relative flex h-full w-full flex-col">
              <div className="inset-0 rounded-xl pointer-events-none absolute bg-transparent"></div>
              <div className="relative z-10 h-full w-full">
                <Workflow taskAssigning={activeTask.taskAssigning || []} />
              </div>
            </div>
          </div>
        )}
        {activeTask.taskAssigning?.find(
          (agent) => agent.agent_id === activeWorkSpace
        )?.type === 'developer_agent' && (
          <div className="flex h-full w-full flex-1">
            <TerminalAgentWorkspace />
          </div>
        )}
        {activeWorkSpace === 'documentWorkSpace' && (
          <div className="flex h-full w-full flex-1 items-center justify-center">
            <div className="relative flex h-full w-full flex-col">
              <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
              <div className="relative z-10 h-full w-full">
                <Folder />
              </div>
            </div>
          </div>
        )}
        {activeTask.taskAssigning?.find(
          (agent) => agent.agent_id === activeWorkSpace
        )?.type === 'document_agent' && (
          <div className="flex h-full w-full flex-1 items-center justify-center">
            <div className="relative flex h-full w-full flex-col">
              <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
              <div className="relative z-10 h-full w-full">
                <Folder
                  data={activeTask.taskAssigning?.find(
                    (agent) => agent.agent_id === activeWorkSpace
                  )}
                />
              </div>
            </div>
          </div>
        )}
        {activeWorkSpace === 'inbox' && (
          <div className="flex h-full w-full flex-1 items-center justify-center">
            <div className="relative flex h-full w-full flex-col">
              <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
              <div className="relative z-10 h-full w-full">
                <Folder />
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const workforcePanelKey = `${chatStore.activeTaskId ?? ''}-${chatStore.tasks[chatStore.activeTaskId ?? '']?.activeWorkspace ?? ''}`;

  return (
    <ReactFlowProvider>
      <div className="min-h-0 px-2 pb-2 pt-10 flex h-full flex-row overflow-hidden">
        <ProjectPageSidebar chatStore={chatStore} />
        <motion.div
          layout
          transition={{ layout: HOME_MAIN_LAYOUT_SPRING }}
          className="min-h-0 min-w-0 gap-4 relative flex h-full flex-1 items-center justify-center overflow-hidden"
        >
          <ResizablePanelGroup
            id="home-main-panel-group"
            direction="horizontal"
            key={`${isChatBoxVisible}-${chatPanelPosition}-${activeWorkspaceTab}`}
            className="gap-0.5 w-full items-center justify-center"
          >
            {activeWorkspaceTab === 'workforce' &&
              isChatBoxVisible &&
              chatPanelPosition === 'left' && (
                <>
                  <ResizablePanel
                    ref={chatPanelRef}
                    defaultSize={30}
                    minSize={10}
                    className="min-h-0 h-full min-w-[360px]"
                  >
                    <ChatBox />
                  </ResizablePanel>
                  <ResizableHandle
                    withHandle={true}
                    className="custom-resizable-handle"
                  />
                </>
              )}
            <ResizablePanel className="h-full w-full min-w-[600px]">
              {activeWorkspaceTab === 'workforce' && (
                <div className="rounded-2xl border-border-tertiary bg-surface-secondary relative flex h-full w-full flex-col border-solid">
                  <div className="gap-2 p-2 relative z-50 flex w-full shrink-0 items-center justify-between">
                    <div className="min-w-0 gap-3 flex flex-1 items-center overflow-hidden">
                      <span className="text-text-heading px-1 text-body-md font-semibold shrink-0">
                        {t('layout.aiWorkforce')}
                      </span>
                    </div>
                    <div className="gap-2 flex shrink-0 items-center">
                      <Button
                        variant="primary"
                        size="sm"
                        className="w-24 rounded-lg items-center justify-center"
                        onClick={() => setAddWorkerDialogOpen(true)}
                      >
                        <Plus />
                        {t('triggers.add')}
                      </Button>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        multiple
                        className="hidden"
                      />
                      <AddWorker
                        isOpen={addWorkerDialogOpen}
                        onOpenChange={setAddWorkerDialogOpen}
                      />
                    </div>
                  </div>
                  <div className="min-h-0 w-full flex-1">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={workforcePanelKey}
                        initial={{ opacity: 0, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(4px)' }}
                        transition={{ duration: 0.2 }}
                        className="h-full w-full"
                      >
                        {renderWorkforceWorkspaceContent()}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  <div className="inset-x-0 bottom-0 pointer-events-none absolute z-50">
                    <div className="pointer-events-auto">
                      <BottomBar />
                    </div>
                  </div>
                </div>
              )}
              {activeWorkspaceTab === 'inbox' && (
                <div className="rounded-2xl border-border-tertiary bg-surface-secondary flex h-full w-full flex-col overflow-hidden border-solid">
                  <div className="min-h-0 w-full flex-1">
                    <div className="flex h-full w-full flex-1 items-center justify-center">
                      <div className="relative z-10 h-full w-full">
                        <Folder />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {activeWorkspaceTab === 'triggers' && (
                <div className="rounded-2xl border-border-tertiary bg-surface-secondary flex h-full w-full flex-col border-solid">
                  <div className="gap-2 px-2 py-2 flex w-full shrink-0 items-center justify-between">
                    <div className="text-text-heading min-w-0 gap-2 px-1 text-body-md font-bold flex flex-1 items-center">
                      <span className="truncate">{t('triggers.title')}</span>
                    </div>
                    <div className="gap-2 flex shrink-0 items-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            buttonContent="text"
                            size="sm"
                            className="rounded-lg"
                          >
                            {triggerSortLabel}
                            <ArrowUpDown className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => setTriggerSortBy('createdAt')}
                          >
                            {t('triggers.created-time')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setTriggerSortBy('lastExecutionTime')
                            }
                          >
                            {t('triggers.last-execution-label')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="primary"
                        size="sm"
                        className="rounded-lg items-center justify-center"
                        onClick={() => setTriggerDialogOpen(true)}
                      >
                        <Plus />
                        {t('triggers.create')}
                      </Button>
                      <TooltipSimple
                        content={
                          triggerExecutionLogsOpen
                            ? t('triggers.fold-execution-logs')
                            : t('triggers.open-execution-logs')
                        }
                        delayDuration={300}
                        side="bottom"
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-70"
                          disabled={sortedTriggersForHeader.length === 0}
                          onClick={() => {
                            if (triggerExecutionLogsOpen) {
                              setTriggerExecutionLogsOpen(false);
                              return;
                            }
                            if (
                              !triggerSelectedId &&
                              sortedTriggersForHeader.length > 0
                            ) {
                              setTriggerSelectedId(
                                sortedTriggersForHeader[0].id
                              );
                            }
                            setTriggerExecutionLogsOpen(true);
                          }}
                        >
                          {triggerExecutionLogsOpen ? (
                            <SquareChevronRight className="h-4 w-4" />
                          ) : (
                            <SquareCode className="h-4 w-4" />
                          )}
                        </Button>
                      </TooltipSimple>
                      <TriggerDialog
                        selectedTrigger={null}
                        isOpen={triggerDialogOpen}
                        onOpenChange={setTriggerDialogOpen}
                      />
                    </div>
                  </div>
                  <div
                    className={`min-h-0 w-full flex-1 ${wsConnectionStatus === 'disconnected' ? 'pointer-events-none opacity-50 grayscale' : ''}`}
                  >
                    <Overview
                      sortBy={triggerSortBy}
                      selectedTriggerId={triggerSelectedId}
                      onSelectedTriggerIdChange={setTriggerSelectedId}
                      isExecutionLogsOpen={triggerExecutionLogsOpen}
                      onExecutionLogsOpenChange={setTriggerExecutionLogsOpen}
                    />
                  </div>
                </div>
              )}
            </ResizablePanel>
            {activeWorkspaceTab === 'workforce' &&
              isChatBoxVisible &&
              chatPanelPosition === 'right' && (
                <>
                  <ResizableHandle
                    withHandle={true}
                    className="custom-resizable-handle"
                  />
                  <ResizablePanel
                    ref={chatPanelRef}
                    defaultSize={30}
                    minSize={10}
                    className="min-h-0 h-full min-w-[360px]"
                  >
                    <ChatBox />
                  </ResizablePanel>
                </>
              )}
          </ResizablePanelGroup>
        </motion.div>
        <UpdateElectron />
      </div>
    </ReactFlowProvider>
  );
}
