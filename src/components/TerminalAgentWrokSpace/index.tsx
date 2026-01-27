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

import { fetchPut } from '@/api/http';
import Terminal from '@/components/Terminal';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import {
  ArrowDown,
  ArrowUp,
  Bird,
  Bot,
  ChevronLeft,
  CodeXml,
  FileText,
  GalleryThumbnails,
  Globe,
  Image,
  Settings2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

export default function TerminalAgentWrokSpace() {
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const { t } = useTranslation();
  const [isSingleMode, setIsSingleMode] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isTakeControl, setIsTakeControl] = useState(false);

  const activeTaskId = chatStore?.activeTaskId;
  const taskAssigning = chatStore?.tasks[activeTaskId as string]?.taskAssigning;
  const activeWorkSpace =
    chatStore?.tasks[activeTaskId as string]?.activeWorkSpace;

  // Use useMemo to derive activeAgent from taskAssigning and activeWorkSpace
  const activeAgent = useMemo(() => {
    if (!chatStore || !taskAssigning) return null;
    return (
      taskAssigning.find((item) => item.agent_id === activeWorkSpace) || null
    );
  }, [chatStore, taskAssigning, activeWorkSpace]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const agentMap = {
    developer_agent: {
      name: 'Developer Agent',
      icon: <CodeXml size={16} className="text-text-primary" />,
      textColor: 'text-emerald-700',
      bgColor: 'bg-bg-fill-coding-active',
      shapeColor: 'bg-bg-fill-coding-default',
      borderColor: 'border-bg-fill-coding-active',
      bgColorLight: 'bg-emerald-200',
    },
    browser_agent: {
      name: 'Browser Agent',
      icon: <Globe size={16} className="text-text-primary" />,
      textColor: 'text-blue-700',
      bgColor: 'bg-bg-fill-browser-active',
      shapeColor: 'bg-bg-fill-browser-default',
      borderColor: 'border-bg-fill-browser-active',
      bgColorLight: 'bg-blue-200',
    },
    document_agent: {
      name: 'Document Agent',
      icon: <FileText size={16} className="text-text-primary" />,
      textColor: 'text-yellow-700',
      bgColor: 'bg-bg-fill-writing-active',
      shapeColor: 'bg-bg-fill-writing-default',
      borderColor: 'border-bg-fill-writing-active',
      bgColorLight: 'bg-yellow-200',
    },
    multi_modal_agent: {
      name: 'Multi Modal Agent',
      icon: <Image size={16} className="text-text-primary" />,
      textColor: 'text-fuchsia-700',
      bgColor: 'bg-bg-fill-multimodal-active',
      shapeColor: 'bg-bg-fill-multimodal-default',
      borderColor: 'border-bg-fill-multimodal-active',
      bgColorLight: 'bg-fuchsia-200',
    },
    social_medium_agent: {
      name: 'Social Media Agent',
      icon: <Bird size={16} className="text-text-primary" />,
      textColor: 'text-purple-700',
      bgColor: 'bg-violet-700',
      shapeColor: 'bg-violet-300',
      borderColor: 'border-violet-700',
      bgColorLight: 'bg-purple-50',
    },
  };
  const _handleTakeControl = (id: string) => {
    console.log('handleTakeControl', id);
    fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
      action: 'pause',
    });
    setIsTakeControl(true);
  };

  return isTakeControl ? (
    <div className="flex h-full w-full flex-col items-center justify-start rounded-xl border border-solid border-border-success bg-menutabs-bg-default">
      <div className="flex w-full items-start justify-start p-sm">
        <div className="rounded-full border border-solid border-border-primary bg-transparent p-1">
          <Button
            size="sm"
            variant="success"
            onClick={() => {
              fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
                action: 'resume',
              });
              setIsTakeControl(false);
              window.electronAPI.hideAllWebview();
            }}
            className="rounded-full"
          >
            <ChevronLeft size={16} className="text-text-inverse-primary" />
            <span className="text-text-inverse-primary text-sm font-bold leading-13">
              {t('chat.give-back-to-agent')}
            </span>
          </Button>
        </div>
      </div>
      <div id="webview-container" className="h-full w-full"></div>
    </div>
  ) : (
    <div
      className={`flex h-[calc(100vh-104px)] w-full flex-1 items-center justify-center transition-all duration-300 ease-in-out`}
    >
      <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl bg-menutabs-bg-default">
        <div className="flex flex-shrink-0 items-center justify-between rounded-t-2xl px-2 pb-2 pt-3">
          <div className="flex items-center justify-start gap-sm">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                chatStore.setActiveWorkSpace(
                  chatStore.activeTaskId as string,
                  'workflow'
                );
              }}
            >
              <ChevronLeft size={16} />
            </Button>
            <div
              className={`flex h-[26px] items-center gap-xs rounded-lg px-2 py-0.5 ${
                agentMap[activeAgent?.type as keyof typeof agentMap]
                  ?.bgColorLight
              }`}
            >
              <Bot className="h-4 w-4 text-icon-primary" />
              <div
                className={`text-[10px] font-bold leading-17 ${
                  agentMap[activeAgent?.type as keyof typeof agentMap]
                    ?.textColor
                }`}
              >
                {agentMap[activeAgent?.type as keyof typeof agentMap]?.name}
              </div>
            </div>
            <div className="text-text-tertiary text-[10px] font-medium leading-17">
              {
                activeAgent?.tasks?.filter(
                  (task) => task.status && task.status !== 'running'
                ).length
              }
              /{activeAgent?.tasks?.length}
            </div>
          </div>
          <Button size="icon" variant="ghost">
            <Settings2 size={16} />
          </Button>
        </div>

        {activeAgent?.tasks.filter(
          (task) => task?.terminal && task?.terminal.length > 0
        )?.length === 1 ? (
          <div className="min-h-0 flex-1">
            {activeAgent?.tasks.filter(
              (task) => task?.terminal && task?.terminal.length > 0
            )[0] && (
              <div
                // onClick={() =>
                // 	handleTakeControl(
                // 		activeAgent?.activeWebviewIds?.[0]?.id || ""
                // 	)
                // }
                className="group relative h-full w-full cursor-pointer rounded-b-2xl pt-sm"
              >
                <Terminal
                  instanceId={activeAgent?.activeWebviewIds?.[0]?.id}
                  content={
                    activeAgent?.tasks.filter(
                      (task) => task?.terminal && task?.terminal.length > 0
                    )[0].terminal
                  }
                />
                {/* <div className=" flex justify-center items-center opacity-0  transition-all group-hover:opacity-100 rounded-b-lg absolute inset-0 w-full h-full bg-black/20 pointer-events-none">
									<Button className="cursor-pointer px-md py-sm h-auto flex gap-sm rounded-full bg-bg-fill-primary">
										<Hand size={24} className="text-icon-inverse-primary" />
										<span className="text-base leading-9 font-medium text-text-inverse-primary">
											Take Control
										</span>
									</Button>
								</div> */}
              </div>
            )}
          </div>
        ) : (
          activeAgent?.tasks.filter(
            (task) => task?.terminal && task?.terminal.length > 0
          ) && (
            <div
              ref={scrollContainerRef}
              className={`${
                isSingleMode ? 'px-0' : 'px-2 pb-2'
              } scrollbar relative flex min-h-0 flex-1 flex-wrap justify-start gap-4 overflow-y-auto`}
            >
              {activeAgent?.tasks
                .filter((task) => task?.terminal && task?.terminal.length > 0)
                .map((task) => {
                  return (
                    <div
                      key={task.id}
                      className={`card-box group relative cursor-pointer rounded-lg ${
                        isSingleMode
                          ? 'h-[calc(100%)] w-[calc(100%)]'
                          : 'h-[calc(50%-8px)] w-[calc(50%-8px)]'
                      }`}
                    >
                      <Terminal instanceId={task.id} content={task.terminal} />
                      {/* <div
												onClick={() => handleTakeControl(task.id)}
												className="flex justify-center items-center opacity-0  transition-all group-hover:opacity-100 rounded-lg absolute inset-0 w-full h-full bg-black/20 pointer-events-none"
											>
												<Button className="cursor-pointer px-md py-sm h-auto flex gap-sm rounded-full bg-bg-fill-primary">
													<Hand
														size={24}
														className="text-icon-inverse-primary"
													/>
													<span className="text-base leading-9 font-medium text-text-inverse-primary">
														Take Control
													</span>
												</Button>
											</div> */}
                    </div>
                  );
                })}
            </div>
          )
        )}
        {activeAgent?.tasks.filter(
          (task) => task?.terminal && task?.terminal.length > 0
        ).length !== 1 && (
          <div className="absolute bottom-2 right-2 z-[200] flex w-auto items-center gap-1 rounded-lg border border-solid border-border-primary bg-menutabs-bg-default p-1">
            {isSingleMode && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (scrollContainerRef.current) {
                    const container = scrollContainerRef.current;
                    const card = container.querySelector('div.card-box');
                    if (!card) return;
                    const cardHeight = card.getBoundingClientRect().height;
                    const gap = 16;
                    const rowCount = isSingleMode ? 1 : 2;
                    const scrollAmount = (cardHeight + gap) * rowCount;
                    container.scrollTo({
                      top: Math.min(
                        container.scrollHeight - container.clientHeight,
                        container.scrollTop + scrollAmount
                      ),
                      behavior: 'smooth',
                    });
                  }
                }}
              >
                <ArrowDown size={16} />
              </Button>
            )}
            {isSingleMode && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (scrollContainerRef.current) {
                    const container = scrollContainerRef.current;
                    const card = container.querySelector('div.card-box');
                    if (!card) return;
                    const cardHeight = card.getBoundingClientRect().height;
                    const gap = 16;
                    const rowCount = isSingleMode ? 1 : 2;
                    const scrollAmount = (cardHeight + gap) * rowCount;
                    container.scrollTo({
                      top: Math.max(0, container.scrollTop - scrollAmount),
                      behavior: 'smooth',
                    });
                  }
                }}
              >
                <ArrowUp size={16} />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setIsSingleMode(!isSingleMode);
                if (scrollContainerRef.current) {
                  scrollContainerRef.current.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                  });
                }
              }}
            >
              <GalleryThumbnails size={16} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
