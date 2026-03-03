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
import UpdateElectron from '@/components/update';
import Workflow from '@/components/WorkFlow';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ChatTaskStatus } from '@/types/constants';
import { ReactFlowProvider } from '@xyflow/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AddWorker } from '@/components/AddWorker';
import {
  MenuToggleGroup,
  MenuToggleItem,
} from '@/components/MenuButton/MenuButton';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';

import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  useTriggerStore,
  WebSocketConnectionStatus,
} from '@/store/triggerStore';
import { Inbox, LayoutGrid, Plus, RefreshCw, Zap, ZapOff } from 'lucide-react';
import Overview from './Project/Triggers';

import BottomBar from '@/components/BottomBar';
import BrowserAgentWorkSpace from '@/components/BrowserAgentWorkSpace';
import TerminalAgentWorkspace from '@/components/TerminalAgentWorkspace';
import { Popover, PopoverContent } from '@/components/ui/popover';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import * as PopoverPrimitive from '@radix-ui/react-popover';

// Connection status icon component
function ConnectionStatusIcon({
  status,
}: {
  status: WebSocketConnectionStatus;
}) {
  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500 animate-pulse';
      case 'unhealthy':
        return 'text-orange-500';
      case 'disconnected':
      default:
        return 'text-icon-secondary';
    }
  };

  const getStatusTooltip = () => {
    switch (status) {
      case 'connected':
        return 'Connected to trigger listener';
      case 'connecting':
        return 'Connecting...';
      case 'unhealthy':
        return 'Connection unhealthy - click refresh to reconnect';
      case 'disconnected':
      default:
        return 'Disconnected from trigger listener';
    }
  };

  const isConnected = status === 'connected';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {isConnected ? (
            <Zap className={getStatusColor()} />
          ) : (
            <ZapOff className={getStatusColor()} />
          )}
        </TooltipTrigger>
        <TooltipContent>
          <p>{getStatusTooltip()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function Home() {
  const { t } = useTranslation();
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const {
    activeTab,
    activeWorkspaceTab,
    setActiveWorkspaceTab,
    chatPanelPosition,
    hasTriggers,
    setHasTriggers,
    hasAgentFiles,
    setHasAgentFiles,
    unviewedTabs,
    markTabAsUnviewed,
  } = usePageTabStore();

  const { wsConnectionStatus, triggerReconnect } = useTriggerStore();
  const authStore = useAuthStore.getState();

  const [activeWebviewId, setActiveWebviewId] = useState<string | null>(null);
  const [isChatBoxVisible, setIsChatBoxVisible] = useState(true);
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);
  const [triggerDialogOpen, setTriggerDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Render workspace content based on active workspace tab
  const renderWorkspaceContent = () => {
    const activeTask = chatStore.activeTaskId
      ? chatStore.tasks[chatStore.activeTaskId]
      : null;
    const activeWorkSpace = activeTask?.activeWorkspace;

    switch (activeWorkspaceTab) {
      case 'triggers':
        return (
          <div
            className={`h-full w-full ${wsConnectionStatus === 'disconnected' ? 'pointer-events-none opacity-50 grayscale' : ''}`}
          >
            <Overview />
          </div>
        );
      case 'inbox':
        return (
          <div className="flex h-full w-full flex-1 items-center justify-center">
            <div className="relative z-10 h-full w-full">
              <Folder />
            </div>
          </div>
        );
      case 'workforce':
      default:
        // If no active task, show default workflow view
        if (!activeTask || !activeWorkSpace) {
          return (
            <div className="flex h-full w-full flex-1 items-center justify-center">
              <div className="relative flex h-full w-full flex-col">
                <div className="pointer-events-none absolute inset-0 rounded-xl bg-transparent"></div>
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
              <div className="flex h-full w-full flex-1 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                <BrowserAgentWorkSpace />
              </div>
            )}
            {activeWorkSpace === 'workflow' && (
              <div className="flex h-full w-full flex-1 items-center justify-center">
                <div className="relative flex h-full w-full flex-col">
                  {/*filter blur */}
                  <div className="pointer-events-none absolute inset-0 rounded-xl bg-transparent"></div>
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
                {/* <Terminal content={[]} /> */}
              </div>
            )}
            {activeWorkSpace === 'documentWorkSpace' && (
              <div className="flex h-full w-full flex-1 items-center justify-center">
                <div className="relative flex h-full w-full flex-col">
                  {/*filter blur */}
                  <div className="blur-bg pointer-events-none absolute inset-0 rounded-xl bg-surface-secondary"></div>
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
                  {/*filter blur */}
                  <div className="blur-bg pointer-events-none absolute inset-0 rounded-xl bg-surface-secondary"></div>
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
            {/* Inbox Workspace - kept for backward compatibility */}
            {activeWorkSpace === 'inbox' && (
              <div className="flex h-full w-full flex-1 items-center justify-center">
                <div className="relative flex h-full w-full flex-col">
                  {/*filter blur */}
                  <div className="blur-bg pointer-events-none absolute inset-0 rounded-xl bg-surface-secondary"></div>
                  <div className="relative z-10 h-full w-full">
                    <Folder />
                  </div>
                </div>
              </div>
            )}
          </>
        );
    }
  };

  // Render Tasks tab content (default)
  return (
    <ReactFlowProvider>
      <div className="flex h-full min-h-0 flex-row overflow-hidden px-2 pb-2 pt-10">
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 items-center justify-center gap-4 overflow-hidden">
          <ResizablePanelGroup
            direction="horizontal"
            key={`${isChatBoxVisible}-${chatPanelPosition}`}
            className="w-full items-center justify-center gap-0.5"
          >
            {/* ChatBox Panel - Left side */}
            {isChatBoxVisible && chatPanelPosition === 'left' && (
              <>
                <ResizablePanel
                  defaultSize={30}
                  minSize={20}
                  className="h-full"
                >
                  <ChatBox />
                </ResizablePanel>
                <ResizableHandle
                  withHandle={true}
                  className="custom-resizable-handle"
                />
              </>
            )}
            <ResizablePanel className="h-full w-full">
              {chatStore.activeTaskId &&
              chatStore.tasks[chatStore.activeTaskId]?.activeWorkspace ? (
                <div className="flex h-full w-full flex-col rounded-2xl border-solid border-border-tertiary bg-surface-secondary">
                  {/* Header with workspace tabs */}
                  <div className="flex w-full items-center justify-between px-2 py-2">
                    <div className="flex w-full flex-row items-center justify-start gap-4">
                      <MenuToggleGroup
                        type="single"
                        variant="info"
                        size="xs"
                        orientation="horizontal"
                        value={activeWorkspaceTab}
                        onValueChange={(val) =>
                          val &&
                          setActiveWorkspaceTab(
                            val as 'triggers' | 'workforce' | 'inbox'
                          )
                        }
                        className="rounded-lg bg-surface-primary"
                      >
                        <MenuToggleItem
                          value="workforce"
                          variant="info"
                          size="xs"
                          icon={<LayoutGrid />}
                          className="w-32"
                        >
                          {t('triggers.workspace')}
                        </MenuToggleItem>
                        <MenuToggleItem
                          value="inbox"
                          variant="info"
                          size="xs"
                          icon={<Inbox />}
                          showSubIcon={unviewedTabs.has('inbox')}
                          subIcon={
                            <span className="h-2 w-2 rounded-full bg-red-500" />
                          }
                          className="w-32"
                        >
                          {t('triggers.agent-folder')}
                        </MenuToggleItem>
                        <MenuToggleItem
                          value="triggers"
                          variant="info"
                          size="xs"
                          icon={
                            <ConnectionStatusIcon status={wsConnectionStatus} />
                          }
                          showSubIcon={unviewedTabs.has('triggers')}
                          subIcon={
                            <span className="h-2 w-2 rounded-full bg-text-error" />
                          }
                          className="w-32"
                          rightElement={
                            wsConnectionStatus !== 'connected' && (
                              <Popover>
                                <PopoverPrimitive.Trigger asChild>
                                  <div className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-surface-tertiary">
                                    <RefreshCw
                                      className={`h-3 w-3 ${wsConnectionStatus === 'connecting' ? 'animate-spin' : ''}`}
                                    />
                                  </div>
                                </PopoverPrimitive.Trigger>
                                <PopoverContent
                                  className="w-64 p-4"
                                  side="bottom"
                                  align="end"
                                >
                                  <div className="flex flex-col gap-3">
                                    <p className="text-body-sm text-text-body">
                                      Reconnect to trigger listener
                                    </p>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      className="w-full items-center justify-center"
                                      onClick={triggerReconnect}
                                    >
                                      <RefreshCw
                                        className={`mr-2 h-4 w-4 ${wsConnectionStatus === 'connecting' ? 'animate-spin' : ''}`}
                                      />
                                      Reconnect
                                    </Button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )
                          }
                        >
                          {t('triggers.title')}
                        </MenuToggleItem>
                      </MenuToggleGroup>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeWorkspaceTab !== 'inbox' && (
                        <Button
                          variant="primary"
                          size="sm"
                          className="w-24 items-center justify-center rounded-lg"
                          onClick={() => {
                            if (activeWorkspaceTab === 'workforce') {
                              setAddWorkerDialogOpen(true);
                            } else if (activeWorkspaceTab === 'triggers') {
                              setTriggerDialogOpen(true);
                            }
                          }}
                        >
                          <Plus />
                          {activeWorkspaceTab === 'workforce' &&
                            t('triggers.add')}
                          {activeWorkspaceTab === 'triggers' &&
                            t('triggers.create')}
                        </Button>
                      )}
                    </div>

                    {/* Hidden file input for upload */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      multiple
                      className="hidden"
                    />

                    {/* AddWorker Dialog */}
                    <AddWorker
                      isOpen={addWorkerDialogOpen}
                      onOpenChange={setAddWorkerDialogOpen}
                    />

                    {/* TriggerDialog */}
                    <TriggerDialog
                      selectedTrigger={null}
                      isOpen={triggerDialogOpen}
                      onOpenChange={setTriggerDialogOpen}
                    />
                  </div>
                  <div className="min-h-0 w-full flex-1">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeWorkspaceTab}
                        initial={{ opacity: 0, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(4px)' }}
                        transition={{ duration: 0.2 }}
                        className="h-full w-full"
                      >
                        {renderWorkspaceContent()}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  {activeWorkspaceTab === 'workforce' && (
                    <BottomBar
                      onToggleChatBox={toggleChatBox}
                      isChatBoxVisible={isChatBoxVisible}
                    />
                  )}
                </div>
              ) : (
                // Show default workspace when activeTaskId is null or task doesn't exist
                <div className="flex h-full w-full flex-col rounded-2xl border-solid border-border-tertiary bg-surface-secondary">
                  {/* Header with workspace tabs */}
                  <div className="flex w-full items-center justify-between px-2 py-2">
                    <div className="flex w-full flex-row items-center justify-start gap-4">
                      <MenuToggleGroup
                        type="single"
                        variant="info"
                        size="xs"
                        orientation="horizontal"
                        value={activeWorkspaceTab}
                        onValueChange={(val) =>
                          val &&
                          setActiveWorkspaceTab(
                            val as 'triggers' | 'workforce' | 'inbox'
                          )
                        }
                        className="rounded-lg bg-surface-primary"
                      >
                        <MenuToggleItem
                          value="workforce"
                          variant="info"
                          size="xs"
                          icon={<LayoutGrid />}
                          className="w-32"
                        >
                          {t('triggers.workspace')}
                        </MenuToggleItem>
                        <MenuToggleItem
                          value="inbox"
                          variant="info"
                          size="xs"
                          icon={<Inbox />}
                          showSubIcon={unviewedTabs.has('inbox')}
                          subIcon={
                            <span className="h-2 w-2 rounded-full bg-red-500" />
                          }
                          className="w-32"
                        >
                          {t('triggers.agent-folder')}
                        </MenuToggleItem>
                        <MenuToggleItem
                          value="triggers"
                          variant="info"
                          size="xs"
                          icon={
                            <ConnectionStatusIcon status={wsConnectionStatus} />
                          }
                          showSubIcon={unviewedTabs.has('triggers')}
                          subIcon={
                            <span className="h-2 w-2 rounded-full bg-red-500" />
                          }
                          className="w-32"
                          rightElement={
                            wsConnectionStatus !== 'connected' && (
                              <Popover>
                                <PopoverPrimitive.Trigger asChild>
                                  <div className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-surface-tertiary">
                                    <RefreshCw
                                      className={`h-3 w-3 ${wsConnectionStatus === 'connecting' ? 'animate-spin' : ''}`}
                                    />
                                  </div>
                                </PopoverPrimitive.Trigger>
                                <PopoverContent
                                  className="w-64 p-4"
                                  side="bottom"
                                  align="end"
                                >
                                  <div className="flex flex-col gap-3">
                                    <p className="text-sm text-text-body">
                                      Reconnect to trigger listener
                                    </p>
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      className="w-full"
                                      onClick={triggerReconnect}
                                    >
                                      <RefreshCw
                                        className={`mr-2 h-4 w-4 ${wsConnectionStatus === 'connecting' ? 'animate-spin' : ''}`}
                                      />
                                      Reconnect
                                    </Button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )
                          }
                        >
                          {t('triggers.triggers')}
                        </MenuToggleItem>
                      </MenuToggleGroup>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeWorkspaceTab !== 'inbox' && (
                        <Button
                          variant="primary"
                          size="sm"
                          className="rounded-lg"
                          onClick={() => {
                            if (activeWorkspaceTab === 'workforce') {
                              setAddWorkerDialogOpen(true);
                            } else if (activeWorkspaceTab === 'triggers') {
                              setTriggerDialogOpen(true);
                            }
                          }}
                        >
                          <Plus />
                          {activeWorkspaceTab === 'workforce' &&
                            t('triggers.add')}
                          {activeWorkspaceTab === 'triggers' &&
                            t('triggers.create')}
                        </Button>
                      )}
                    </div>
                    {/* Hidden file input for upload */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      multiple
                      className="hidden"
                    />

                    {/* AddWorker Dialog */}
                    <AddWorker
                      isOpen={addWorkerDialogOpen}
                      onOpenChange={setAddWorkerDialogOpen}
                    />

                    {/* TriggerDialog */}
                    <TriggerDialog
                      selectedTrigger={null}
                      isOpen={triggerDialogOpen}
                      onOpenChange={setTriggerDialogOpen}
                    />
                  </div>
                  <div className="min-h-0 w-full flex-1">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={activeWorkspaceTab}
                        initial={{ opacity: 0, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, filter: 'blur(4px)' }}
                        transition={{ duration: 0.2 }}
                        className="h-full w-full"
                      >
                        {renderWorkspaceContent()}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                  {activeWorkspaceTab === 'workforce' && (
                    <BottomBar
                      onToggleChatBox={toggleChatBox}
                      isChatBoxVisible={isChatBoxVisible}
                    />
                  )}
                </div>
              )}
            </ResizablePanel>
            {/* ChatBox Panel - Right side */}
            {isChatBoxVisible && chatPanelPosition === 'right' && (
              <>
                <ResizableHandle
                  withHandle={true}
                  className="custom-resizable-handle"
                />
                <ResizablePanel
                  defaultSize={30}
                  minSize={20}
                  className="h-full"
                >
                  <ChatBox />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
        <UpdateElectron />
      </div>
    </ReactFlowProvider>
  );
}
