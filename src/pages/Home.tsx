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
import BrowserAgentWorkSpace from '@/components/BrowserAgentWorkSpace';
import ChatBox from '@/components/ChatBox';
import Folder from '@/components/Folder';
import TerminalAgentWrokSpace from '@/components/TerminalAgentWrokSpace';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import UpdateElectron from '@/components/update';
import Workflow from '@/components/WorkFlow';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { ChatTaskStatus } from '@/types/constants';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';

export default function Home() {
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const [_activeWebviewId, setActiveWebviewId] = useState<string | null>(null);

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
            // let list: any = [];
            // taskAssigning.forEach((item: any) => {
            // 	item.activeWebviewIds.forEach((item2: any) => {
            // 		if (item2.img && item2.url && item2.processTaskId) {
            // 			list.push({
            // 				api_task_id: chatStore.activeTaskId,
            // 				camel_task_id: item2.processTaskId,
            // 				browser_url: item2.url,
            // 				image_base64: item2.img,
            // 			});
            // 		}
            // 	});
            // });
            // chatStore.setSnapshots(chatStore.activeTaskId as string, list);
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
      console.log('setSize', rect);
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
    return <div>Loading...</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-row overflow-hidden px-2 pb-2 pt-10">
      <ReactFlowProvider>
        <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-2xl border-solid border-border-tertiary bg-surface-secondary">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={30} minSize={20}>
              <ChatBox />
            </ResizablePanel>
            <ResizableHandle
              withHandle={true}
              className="custom-resizable-handle"
            />
            <ResizablePanel>
              {chatStore.tasks[chatStore.activeTaskId as string]
                ?.activeWorkSpace && (
                <div className="flex h-full w-full flex-1 flex-col pr-2 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                  {chatStore.tasks[
                    chatStore.activeTaskId as string
                  ]?.taskAssigning?.find(
                    (agent) =>
                      agent.agent_id ===
                      chatStore.tasks[chatStore.activeTaskId as string]
                        .activeWorkSpace
                  )?.type === 'browser_agent' && (
                    <div className="flex h-[calc(100vh-104px)] w-full flex-1 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                      <BrowserAgentWorkSpace />
                    </div>
                  )}
                  {chatStore.tasks[chatStore.activeTaskId as string]
                    ?.activeWorkSpace === 'workflow' && (
                    <div className="flex h-full w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                      <div className="relative flex h-full w-full flex-col rounded-2xl border border-solid border-transparent p-2">
                        {/*filter blur */}
                        <div className="pointer-events-none absolute inset-0 rounded-xl bg-transparent"></div>
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
                        .activeWorkSpace
                  )?.type === 'developer_agent' && (
                    <div className="flex h-[calc(100vh-104px)] w-full flex-1 duration-300 animate-in fade-in-0 slide-in-from-right-2">
                      <TerminalAgentWrokSpace></TerminalAgentWrokSpace>
                      {/* <Terminal content={[]} /> */}
                    </div>
                  )}
                  {chatStore.tasks[chatStore.activeTaskId as string]
                    .activeWorkSpace === 'documentWorkSpace' && (
                    <div className="flex h-[calc(100vh-104px)] w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                      <div className="relative flex h-[calc(100vh-104px)] w-full flex-col rounded-2xl border border-solid border-border-subtle-strong">
                        {/*filter blur */}
                        <div className="blur-bg bg-white-50 pointer-events-none absolute inset-0 rounded-xl"></div>
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
                        .activeWorkSpace
                  )?.type === 'document_agent' && (
                    <div className="flex h-[calc(100vh-104px)] w-full flex-1 items-center justify-center duration-300 animate-in fade-in-0 slide-in-from-right-2">
                      <div className="relative flex h-[calc(100vh-104px)] w-full flex-col rounded-2xl border border-solid border-border-subtle-strong">
                        {/*filter blur */}
                        <div className="blur-bg bg-white-50 pointer-events-none absolute inset-0 rounded-xl"></div>
                        <div className="relative z-10 h-full w-full">
                          <Folder
                            data={chatStore.tasks[
                              chatStore.activeTaskId as string
                            ]?.taskAssigning?.find(
                              (agent) =>
                                agent.agent_id ===
                                chatStore.tasks[
                                  chatStore.activeTaskId as string
                                ].activeWorkSpace
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                  <BottomBar />
                </div>
              )}
            </ResizablePanel>
            {/* Fixed sidebar on the right
							<div className="h-full z-30">
								<SideBar />
							</div>*/}
          </ResizablePanelGroup>
        </div>
      </ReactFlowProvider>
      <UpdateElectron />
    </div>
  );
}
