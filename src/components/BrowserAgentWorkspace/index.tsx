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
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { TaskStatus } from '@/types/constants';
import {
  ArrowDown,
  ArrowUp,
  Bird,
  ChevronLeft,
  CodeXml,
  FileText,
  GalleryThumbnails,
  Globe,
  Hand,
  Image,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TaskState } from '../TaskState';
import { Button } from '../ui/button';

export default function BrowserAgentWorkspace() {
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();

  const [isSingleMode, setIsSingleMode] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    social_media_agent: {
      name: 'Social Media Agent',
      icon: <Bird size={16} className="text-text-primary" />,
      textColor: 'text-purple-700',
      bgColor: 'bg-violet-700',
      shapeColor: 'bg-violet-300',
      borderColor: 'border-violet-700',
      bgColorLight: 'bg-purple-50',
    },
  };
  // Extract complex expressions to avoid lint error in dependency array
  const activeTaskId = chatStore?.activeTaskId as string;
  const taskAssigning = chatStore?.tasks[activeTaskId]?.taskAssigning;
  const activeWorkSpace = chatStore?.tasks[activeTaskId]?.activeWorkSpace;

  // Derive activeAgent from taskAssigning and activeWorkSpace (no setState in effect)
  const activeAgent = useMemo(() => {
    if (!taskAssigning) return null;
    return (
      taskAssigning.find((item) => item.agent_id === activeWorkSpace) ?? null
    );
  }, [taskAssigning, activeWorkSpace]);

  const [isTakeControl, setIsTakeControl] = useState(false);

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

  const handleTakeControl = (id: string) => {
    console.log('handleTakeControl', id);
    fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
      action: 'pause',
    });

    setIsTakeControl(true);
    setTimeout(() => {
      getSize();
      // show corresponding webview
      window.electronAPI.showWebview(id);
    }, 400);
  };

  // listen to webview container size
  useEffect(() => {
    if (!projectStore.activeProjectId) {
      projectStore.createProject('new project');
      console.warn(
        'No active projectId found in WorkSpace, creating a new project'
      );
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
  }, [projectStore, getSize]);

  const [_url, setUrl] = useState('');

  useEffect(() => {
    window.ipcRenderer?.on('url-updated', (_event: any, newUrl: any) => {
      setUrl(newUrl);
    });

    // optional: clear listener when uninstall
    return () => {
      window.ipcRenderer.removeAllListeners('url-updated');
    };
  }, []);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return isTakeControl ? (
    <div className="flex h-full w-full flex-col items-center justify-start rounded-xl border border-solid border-border-success bg-menutabs-bg-default">
      <div className="flex w-full items-start justify-start gap-sm p-sm">
        <div className="rounded-full border border-solid border-border-primary bg-transparent p-1">
          <Button
            onClick={() => {
              fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
                action: 'resume',
              });
              setIsTakeControl(false);
              window.electronAPI.hideAllWebview();
            }}
            size="sm"
            variant="success"
            className="rounded-full"
          >
            <ChevronLeft size={16} />
            <span>Give back to Agent</span>
          </Button>
        </div>
        {/* <div className="mx-2 bg-border-primary">{url}</div> */}
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
              className={`text-base font-bold leading-snug ${
                agentMap[activeAgent?.type as keyof typeof agentMap]?.textColor
              }`}
            >
              {agentMap[activeAgent?.type as keyof typeof agentMap]?.name}
            </div>
            <TaskState
              all={activeAgent?.tasks?.length || 0}
              reAssignTo={
                activeAgent?.tasks?.filter((task) => task.reAssignTo).length ||
                0
              }
              done={
                activeAgent?.tasks?.filter(
                  (task) =>
                    task.status === TaskStatus.COMPLETED && !task.reAssignTo
                ).length || 0
              }
              progress={
                activeAgent?.tasks?.filter(
                  (task) =>
                    task.status !== TaskStatus.FAILED &&
                    task.status !== TaskStatus.COMPLETED &&
                    task.status !== TaskStatus.SKIPPED &&
                    task.status !== TaskStatus.WAITING &&
                    task.status !== TaskStatus.EMPTY &&
                    !task.reAssignTo
                ).length || 0
              }
              failed={
                activeAgent?.tasks?.filter(
                  (task) =>
                    task.status === TaskStatus.FAILED && !task.reAssignTo
                ).length || 0
              }
              skipped={
                activeAgent?.tasks?.filter(
                  (task) =>
                    (task.status === TaskStatus.SKIPPED ||
                      task.status === TaskStatus.WAITING ||
                      task.status === TaskStatus.EMPTY) &&
                    !task.reAssignTo
                ).length || 0
              }
            />
            {/* <div className="text-[10px] leading-17 font-medium text-text-tertiary">
							{
								activeAgent?.tasks?.filter(
									(task) => task.status && task.status !== "running"
								).length
							}
							/{activeAgent?.tasks?.length}
						</div> */}
          </div>
          {/* <div className="w-6 h-6 flex items-center justify-center">
						<Settings2 size={16} />
					</div> */}
        </div>

        {activeAgent?.activeWebviewIds?.length === 1 ? (
          <div className="min-h-0 flex-1">
            {activeAgent?.activeWebviewIds[0]?.img && (
              <div
                onClick={() =>
                  handleTakeControl(
                    activeAgent?.activeWebviewIds?.[0]?.id || ''
                  )
                }
                className="group relative h-full w-full cursor-pointer rounded-b-2xl pt-sm"
              >
                <img
                  src={activeAgent?.activeWebviewIds[0]?.img}
                  alt=""
                  className="h-full w-full rounded-b-2xl object-contain"
                />
                <div className="bg-black/20 pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center rounded-b-lg opacity-0 transition-all group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="primary"
                    className="cursor-pointer rounded-full"
                  >
                    <Hand size={24} />
                    <span className="text-base font-medium leading-9">
                      Take Control
                    </span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            className={`${
              isSingleMode ? 'px-0' : 'px-2 pb-2'
            } scrollbar relative flex min-h-0 flex-1 flex-wrap justify-start gap-4 overflow-y-auto`}
          >
            {activeAgent?.activeWebviewIds
              ?.filter((item) => item?.img)
              .map((item, index) => {
                return (
                  <div
                    key={index}
                    onClick={() => handleTakeControl(item.id)}
                    className={`card-box group relative cursor-pointer rounded-lg ${
                      isSingleMode
                        ? 'h-[calc(100%)] w-[calc(100%)]'
                        : 'h-[calc(50%-8px)] w-[calc(50%-8px)]'
                    }`}
                  >
                    {item.img && (
                      <img
                        src={item.img}
                        alt=""
                        className="h-full w-full rounded-2xl object-contain"
                      />
                    )}
                    <div
                      onClick={() =>
                        handleTakeControl(
                          activeAgent?.activeWebviewIds?.[0]?.id || ''
                        )
                      }
                      className="bg-black/20 pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center rounded-lg opacity-0 transition-all group-hover:opacity-100"
                    >
                      <Button
                        size="sm"
                        variant="primary"
                        className="cursor-pointer rounded-full"
                      >
                        <Hand size={24} />
                        <span className="text-base font-medium leading-9">
                          Take Control
                        </span>
                      </Button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
        {activeAgent?.activeWebviewIds?.length !== 1 && (
          <div className="z-100 absolute bottom-2 right-2 flex w-auto items-center gap-1 rounded-lg border border-solid border-border-primary bg-menutabs-bg-default p-1">
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
