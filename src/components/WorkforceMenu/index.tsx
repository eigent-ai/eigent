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

import { AgentAvatar } from '@/components/Workspace/AgentAvatar';
import { Button } from '@/components/ui/button';
import { MenuToggleGroup, MenuToggleItem } from '@/components/ui/menu-button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { useWorkerList } from '@/store/authStore';
import { useWorkflowViewportStore } from '@/store/workflowViewportStore';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface WorkforceMenuProps {
  onToggleChatBox?: () => void;
  isChatBoxVisible?: boolean;
}

export default function WorkforceMenu({
  onToggleChatBox: _onToggleChatBox,
  isChatBoxVisible: _isChatBoxVisible = true,
}: WorkforceMenuProps) {
  const { t } = useTranslation();
  const host = useHost();
  const { chatStore } = useChatStoreAdapter();
  const workerList = useWorkerList();

  const { moveLeft, moveRight } = useWorkflowViewportStore();

  const baseWorker: Agent[] = useMemo(
    () => [
      {
        tasks: [],
        agent_id: 'developer_agent',
        name: t('layout.developer-agent'),
        type: 'developer_agent',
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        agent_id: 'browser_agent',
        name: t('layout.browser-agent'),
        type: 'browser_agent',
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        agent_id: 'multi_modal_agent',
        name: t('layout.multi-modal-agent'),
        type: 'multi_modal_agent',
        log: [],
        activeWebviewIds: [],
      },
      // {
      // 	tasks: [],
      // 	agent_id: "social_media_agent",
      // 	name: "Social Media Agent",
      // 	type: "social_media_agent",
      // 	log: [],
      // 	activeWebviewIds: [],
      // },
      {
        tasks: [],
        agent_id: 'document_agent',
        name: t('layout.document-agent'),
        type: 'document_agent',
        log: [],
        activeWebviewIds: [],
      },
    ],
    [t]
  );

  const activeTaskId = chatStore?.activeTaskId as string;
  const taskAssigning = chatStore?.tasks[activeTaskId]?.taskAssigning;
  const webViewUrls = chatStore?.tasks[activeTaskId]?.webViewUrls;

  // Helper to safely access task properties
  const getCurrentTask = () =>
    activeTaskId ? chatStore?.tasks?.[activeTaskId] : undefined;

  const agentList = useMemo(() => {
    if (!chatStore) return [];
    const base = [...baseWorker, ...workerList].filter(
      (worker) => !taskAssigning?.find((agent) => agent.type === worker.type)
    );
    return [...base, ...(taskAssigning || [])];
  }, [chatStore, baseWorker, workerList, taskAssigning]);

  useEffect(() => {
    if (!chatStore || !host?.electronAPI?.onWebviewNavigated) return;
    const cleanup = host.electronAPI.onWebviewNavigated(
      (id: string, url: string) => {
        if (!chatStore.activeTaskId) return;
        const currentTask = getCurrentTask();
        if (!currentTask) return;

        let webViewUrls = [...(currentTask.webViewUrls || [])];
        let taskAssigning = [...(currentTask.taskAssigning || [])];
        const hasId = taskAssigning.find((item) =>
          item.activeWebviewIds?.find((webview) => webview.id === id)
        );
        if (!hasId) {
          const hasUrl = webViewUrls.find(
            (item) => new URL(item.url).hostname === new URL(url).hostname
          );

          if (hasUrl) {
            const activeAgentIndex = taskAssigning.findIndex((item) =>
              item.tasks.find((task) => task.id === hasUrl?.processTaskId)
            );

            if (activeAgentIndex === -1) {
              const browserAgentIndex = taskAssigning.findIndex(
                (item) => item.type === 'browser_agent'
              );
              if (browserAgentIndex !== -1) {
                taskAssigning[browserAgentIndex].activeWebviewIds?.push({
                  id,
                  url,
                  img: '',
                  processTaskId: hasUrl?.processTaskId || '',
                });
                chatStore.setTaskAssigning(
                  chatStore.activeTaskId as string,
                  taskAssigning
                );
              }
            } else {
              taskAssigning[activeAgentIndex].activeWebviewIds?.push({
                id,
                url,
                img: '',
                processTaskId: hasUrl?.processTaskId || '',
              });
              chatStore.setTaskAssigning(
                chatStore.activeTaskId as string,
                taskAssigning
              );
            }
            const urlIndex = webViewUrls.findIndex((item) => item.url === url);
            if (urlIndex !== -1) {
              webViewUrls.splice(urlIndex, 1);
            }
            chatStore.setWebViewUrls(chatStore.activeTaskId as string, [
              ...webViewUrls,
            ]);
          } else {
            // If no URL match found, also try to add to browser_agent
            const browserAgentIndex = taskAssigning.findIndex(
              (item) => item.type === 'browser_agent'
            );
            if (browserAgentIndex !== -1 && webViewUrls.length > 0) {
              taskAssigning[browserAgentIndex].activeWebviewIds?.push({
                id,
                url,
                img: '',
                processTaskId: webViewUrls[0]?.processTaskId || '',
              });
              chatStore.setTaskAssigning(
                chatStore.activeTaskId as string,
                taskAssigning
              );
            }
          }
        }

        let webviews: { id: string; agent_id: string; index: number }[] = [];
        taskAssigning.map((item) => {
          if (item.type === 'browser_agent') {
            item.activeWebviewIds?.map((webview, index) => {
              // console.log("@@@@@@", webview);
              if (webview.id === id) {
                webviews.push({ ...webview, agent_id: item.agent_id, index });
              }
            });
          }
        });

        if (taskAssigning.length === 0 || webviews.length === 0) return;

        // capture webview
        const captureWebview = () => {
          if (!host?.ipcRenderer) return;
          webviews.map((webview) => {
            host.ipcRenderer
              .invoke('capture-webview', webview.id)
              .then((base64: string) => {
                const currentTask = getCurrentTask();
                if (!currentTask) return;

                let taskAssigning = [...(currentTask.taskAssigning || [])];
                const browserAgentIndex = taskAssigning.findIndex(
                  (agent) => agent.agent_id === webview.agent_id
                );

                if (
                  browserAgentIndex !== -1 &&
                  base64 &&
                  base64 !== 'data:image/jpeg;base64,'
                ) {
                  taskAssigning[browserAgentIndex].activeWebviewIds![
                    webview.index
                  ].img = base64;

                  chatStore.setTaskAssigning(
                    chatStore.activeTaskId as string,
                    taskAssigning
                  );
                }
              })
              .catch((error: unknown) => {
                console.error('capture webview error:', error);
              });
          });
        };
        setTimeout(() => {
          captureWebview();
        }, 200);
      }
    );

    return cleanup;
  }, [chatStore, activeTaskId, webViewUrls, taskAssigning, host]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const onValueChange = (val: string) => {
    if (!chatStore.activeTaskId) return;
    if (val === '') {
      chatStore.setActiveWorkspace(chatStore.activeTaskId, 'workflow');
      return;
    }
    if (val === 'documentWorkSpace') {
      chatStore.setNuwFileNum(chatStore.activeTaskId, 0);
    }
    chatStore.setActiveWorkspace(chatStore.activeTaskId, val);

    host?.electronAPI?.hideAllWebview?.();
  };

  return (
    <div className="relative z-50 flex h-12 items-center justify-center pt-2">
      <div className="w-full">
        <div className="relative flex h-full w-full flex-row items-center justify-center">
          {/* activeAgent */}
          <AnimatePresence>
            {agentList.length > 0 && (
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className={`flex w-fit flex-row gap-2 pl-2`}
              >
                <MenuToggleGroup
                  type="single"
                  size="md"
                  orientation="horizontal"
                  value={getCurrentTask()?.activeWorkspace as string}
                  onValueChange={onValueChange}
                  className="flex w-full items-center gap-2 pb-2"
                >
                  <AnimatePresence mode="popLayout">
                    {agentList.map((agent) => (
                      <motion.div
                        key={agent.agent_id}
                        initial={{ opacity: 0, scale: 0.8, x: -20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.8, x: 20 }}
                        transition={{
                          duration: 0.3,
                          ease: 'easeInOut',
                        }}
                        layout
                      >
                        <MenuToggleItem
                          disabled={
                            ![
                              'developer_agent',
                              'browser_agent',
                              'document_agent',
                              'multi_modal_agent',
                            ].includes(agent.type as AgentNameType) ||
                            agent.tasks.length === 0
                          }
                          value={agent.agent_id}
                          icon={
                            <span className="flex size-10 overflow-hidden rounded-xl">
                              <AgentAvatar
                                agentType={agent.type}
                                agentName={agent.name}
                                fullBleed
                              />
                            </span>
                          }
                          className={
                            agent.tasks.length === 0
                              ? 'overflow-hidden opacity-30'
                              : 'overflow-hidden'
                          }
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </MenuToggleGroup>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Viewport Navigation Buttons */}
          {(moveLeft || moveRight) && (
            <div className="absolute right-2 flex items-center pb-2">
              <Button
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                onClick={moveLeft || undefined}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                onClick={moveRight || undefined}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
