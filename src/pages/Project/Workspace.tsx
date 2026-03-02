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

import BottomBar from '@/components/BottomBar';
import BrowserAgentWorkspace from '@/components/BrowserAgentWorkSpace';
import ChatBox from '@/components/ChatBox';
import Folder from '@/components/Folder';
import TerminalAgentWorkspace from '@/components/TerminalAgentWorkspace';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import Workflow from '@/components/WorkFlow';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';

export default function Tasks() {
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const [isChatBoxVisible, setIsChatBoxVisible] = useState(true);

  useEffect(() => {
    const activeTaskId = chatStore.activeTaskId;
    const activeTask = chatStore.tasks[activeTaskId as string];
    const taskAssigning = activeTask?.taskAssigning || [];

    let webviews: { id: string; agent_id: string; index: number }[] = [];
    taskAssigning.forEach((item) => {
      if (item.type === 'browser_agent') {
        item.activeWebviewIds?.forEach((webview, index) => {
          webviews.push({ ...webview, agent_id: item.agent_id, index });
        });
      }
    });

    if (taskAssigning.length === 0) {
      return;
    }

    if (webviews.length === 0) {
      const searchAgent = taskAssigning.find(
        (agent) => agent.type === 'browser_agent'
      );
      if (
        searchAgent &&
        searchAgent.activeWebviewIds &&
        searchAgent.activeWebviewIds.length > 0
      ) {
        searchAgent.activeWebviewIds.forEach((webview, index) => {
          webviews.push({ ...webview, agent_id: searchAgent.agent_id, index });
        });
      }
    }

    if (webviews.length === 0) {
      return;
    }

    // capture webview
    const captureWebview = async () => {
      if (!activeTask || activeTask.status === 'finished') {
        return;
      }
      webviews.forEach((webview) => {
        window.ipcRenderer
          .invoke('capture-webview', webview.id)
          .then((base64: string) => {
            const currentTask = chatStore.tasks[activeTaskId as string];
            if (!currentTask || currentTask.type) return;
            const currentTaskAssigning = [...currentTask.taskAssigning];
            const searchAgentIndex = currentTaskAssigning.findIndex(
              (agent) => agent.agent_id === webview.agent_id
            );

            if (
              searchAgentIndex !== -1 &&
              base64 !== 'data:image/jpeg;base64,'
            ) {
              currentTaskAssigning[searchAgentIndex].activeWebviewIds![
                webview.index
              ].img = base64;
              chatStore.setTaskAssigning(
                activeTaskId as string,
                currentTaskAssigning
              );
              const { processTaskId, url } =
                currentTaskAssigning[searchAgentIndex].activeWebviewIds![
                  webview.index
                ];
              chatStore.setSnapshotsTemp(activeTaskId as string, {
                api_task_id: activeTaskId,
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
  }, [chatStore]);

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
      console.log('setSize', rect);
    }
  }, []);

  useEffect(() => {
    if (!chatStore.activeTaskId) {
      projectStore.createProject('new project');
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
  }, [chatStore.activeTaskId, projectStore, getSize]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const toggleChatBox = () => {
    setIsChatBoxVisible((prev) => !prev);
  };

  return (
    <ReactFlowProvider>
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl border-solid border-border-tertiary bg-surface-secondary">
        <ResizablePanelGroup
          direction="horizontal"
          key={isChatBoxVisible ? 'with-chat' : 'without-chat'}
        >
          {isChatBoxVisible && (
            <>
              <ResizablePanel defaultSize={30} minSize={20}>
                <ChatBox />
              </ResizablePanel>
              <ResizableHandle
                withHandle={true}
                className="custom-resizable-handle"
              />
            </>
          )}
          <ResizablePanel>
            {chatStore.tasks[chatStore.activeTaskId as string]
              ?.activeWorkspace && (
              <div className="flex h-full w-full flex-1 flex-col duration-300 animate-in fade-in-0 slide-in-from-right-2">
                {chatStore.tasks[
                  chatStore.activeTaskId as string
                ]?.taskAssigning?.find(
                  (agent) =>
                    agent.agent_id ===
                    chatStore.tasks[chatStore.activeTaskId as string]
                      .activeWorkspace
                )?.type === 'browser_agent' && (
                  <div className="flex h-full w-full flex-1 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    <BrowserAgentWorkspace />
                  </div>
                )}
                {chatStore.tasks[chatStore.activeTaskId as string]
                  ?.activeWorkspace === 'workflow' && (
                  <div className="flex h-full w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    <div className="relative flex h-full w-full flex-col">
                      {/*filter blur */}
                      <div className="pointer-events-none absolute inset-0 bg-transparent"></div>
                      <div className="relative z-10 h-full w-full">
                        <Workflow
                          taskAssigning={
                            chatStore.tasks[chatStore.activeTaskId as string]
                              ?.taskAssigning || []
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
                {chatStore.tasks[
                  chatStore.activeTaskId as string
                ]?.taskAssigning?.find(
                  (agent) =>
                    agent.agent_id ===
                    chatStore.tasks[chatStore.activeTaskId as string]
                      .activeWorkspace
                )?.type === 'developer_agent' && (
                  <div className="flex h-full w-full flex-1 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    <TerminalAgentWorkspace />
                    {/* <Terminal content={[]} /> */}
                  </div>
                )}
                {chatStore.tasks[chatStore.activeTaskId as string]
                  .activeWorkspace === 'documentWorkSpace' && (
                  <div className="flex h-full w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    <div className="relative flex h-full w-full flex-col pb-2">
                      {/*filter blur */}
                      <div className="blur-bg pointer-events-none absolute inset-0 rounded-xl bg-surface-secondary"></div>
                      <div className="relative z-10 h-full w-full">
                        <Folder />
                      </div>
                    </div>
                  </div>
                )}
                {chatStore.tasks[
                  chatStore.activeTaskId as string
                ]?.taskAssigning?.find(
                  (agent) =>
                    agent.agent_id ===
                    chatStore.tasks[chatStore.activeTaskId as string]
                      .activeWorkspace
                )?.type === 'document_agent' && (
                  <div className="flex h-full w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    <div className="relative flex h-full w-full flex-col">
                      {/*filter blur */}
                      <div className="blur-bg pointer-events-none absolute inset-0 rounded-xl bg-surface-secondary"></div>
                      <div className="relative z-10 h-full w-full">
                        <Folder
                          data={chatStore.tasks[
                            chatStore.activeTaskId as string
                          ]?.taskAssigning?.find(
                            (agent) =>
                              agent.agent_id ===
                              chatStore.tasks[chatStore.activeTaskId as string]
                                .activeWorkspace
                          )}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {/* Inbox Workspace */}
                {chatStore.tasks[chatStore.activeTaskId as string]
                  .activeWorkspace === 'inbox' && (
                  <div className="flex h-full w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                    <div className="relative flex h-full w-full flex-col">
                      {/*filter blur */}
                      <div className="blur-bg pointer-events-none absolute inset-0 rounded-xl bg-surface-secondary"></div>
                      <div className="relative z-10 h-full w-full">
                        <Folder />
                      </div>
                    </div>
                  </div>
                )}
                <BottomBar
                  onToggleChatBox={toggleChatBox}
                  isChatBoxVisible={isChatBoxVisible}
                />
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </ReactFlowProvider>
  );
}
