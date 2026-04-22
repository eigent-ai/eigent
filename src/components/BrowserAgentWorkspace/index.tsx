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
import { useHost } from '@/host';
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
  const host = useHost();

  const [isSingleMode, setIsSingleMode] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const agentMap = {
    developer_agent: {
      name: 'Developer Agent',
      icon: (
        <CodeXml size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-emerald-700',
      bgColor: 'bg-ds-bg-terminal-default-default',
      shapeColor: 'bg-ds-bg-terminal-subtle-default',
      borderColor: 'border-ds-border-terminal-default-default',
      bgColorLight: 'bg-emerald-200',
    },
    browser_agent: {
      name: 'Browser Agent',
      icon: (
        <Globe size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-blue-700',
      bgColor: 'bg-ds-bg-browser-default-default',
      shapeColor: 'bg-ds-bg-browser-subtle-default',
      borderColor: 'border-ds-border-browser-default-default',
      bgColorLight: 'bg-blue-200',
    },
    document_agent: {
      name: 'Document Agent',
      icon: (
        <FileText size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-yellow-700',
      bgColor: 'bg-ds-bg-document-default-default',
      shapeColor: 'bg-ds-bg-document-subtle-default',
      borderColor: 'border-ds-border-document-default-default',
      bgColorLight: 'bg-yellow-200',
    },
    multi_modal_agent: {
      name: 'Multi Modal Agent',
      icon: (
        <Image size={16} className="text-ds-text-neutral-default-default" />
      ),
      textColor: 'text-fuchsia-700',
      bgColor: 'bg-ds-bg-neutral-default-default',
      shapeColor: 'bg-ds-bg-neutral-subtle-default',
      borderColor: 'border-ds-border-neutral-default-default',
      bgColorLight: 'bg-fuchsia-200',
    },
    social_media_agent: {
      name: 'Social Media Agent',
      icon: <Bird size={16} className="text-ds-text-neutral-default-default" />,
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
  const activeWorkspace = chatStore?.tasks[activeTaskId]?.activeWorkspace;

  // Derive activeAgent from taskAssigning and activeWorkspace (no setState in effect)
  const activeAgent = useMemo(() => {
    if (!taskAssigning) return null;
    return (
      taskAssigning.find((item) => item.agent_id === activeWorkspace) ?? null
    );
  }, [taskAssigning, activeWorkspace]);

  const [isTakeControl, setIsTakeControl] = useState(false);

  const getSize = useCallback(() => {
    const webviewContainer = document.getElementById('webview-container');
    if (webviewContainer) {
      const rect = webviewContainer.getBoundingClientRect();
      host?.electronAPI?.setSize?.({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [host]);

  const handleTakeControl = (id: string) => {
    console.log('handleTakeControl', id);
    fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
      action: 'pause',
    });

    setIsTakeControl(true);
    setTimeout(() => {
      getSize();
      // show corresponding webview
      host?.electronAPI?.showWebview?.(id);
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
    host?.ipcRenderer?.on('url-updated', (_event: any, newUrl: any) => {
      setUrl(newUrl);
    });

    // optional: clear listener when uninstall
    return () => {
      host?.ipcRenderer?.removeAllListeners?.('url-updated');
    };
  }, [host]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  return isTakeControl ? (
    <div className="rounded-xl border-ds-border-status-completed-default-default bg-ds-bg-neutral-strong-default flex h-full w-full flex-col items-center justify-start border border-solid">
      <div className="gap-sm p-sm flex w-full items-start justify-start">
        <div className="border-ds-border-neutral-strong-default p-1 rounded-full border border-solid bg-transparent">
          <Button
            onClick={() => {
              fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
                action: 'resume',
              });
              setIsTakeControl(false);
              host?.electronAPI?.hideAllWebview?.();
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
      className={`ease-in-out flex h-full w-full flex-1 items-center justify-center transition-all duration-300`}
    >
      <div className="backdrop-blur-sm rounded-xl bg-ds-bg-neutral-default-default relative flex h-full w-full flex-col overflow-hidden">
        <div className="rounded-t-2xl px-2 pb-2 pt-3 flex flex-shrink-0 items-center justify-between">
          <div className="gap-sm flex items-center justify-start">
            <Button
              size="xs"
              buttonContent="icon-only"
              variant="ghost"
              onClick={() => {
                chatStore.setActiveWorkspace(
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
            {/* <div className="text-[10px] leading-17 font-medium text-ds-text-neutral-muted-default">
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
                className="group rounded-b-2xl pt-sm relative h-full w-full cursor-pointer"
              >
                <img
                  src={activeAgent?.activeWebviewIds[0]?.img}
                  alt=""
                  className="rounded-b-2xl h-full w-full object-contain"
                />
                <div className="bg-black/20 inset-0 rounded-b-lg pointer-events-none absolute flex h-full w-full items-center justify-center opacity-0 transition-all group-hover:opacity-100">
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
            } scrollbar min-h-0 gap-4 relative flex flex-1 flex-wrap justify-start overflow-y-auto`}
          >
            {activeAgent?.activeWebviewIds
              ?.filter((item) => item?.img)
              .map((item, index) => {
                return (
                  <div
                    key={index}
                    onClick={() => handleTakeControl(item.id)}
                    className={`card-box group rounded-lg relative cursor-pointer ${
                      isSingleMode
                        ? 'h-[calc(100%)] w-[calc(100%)]'
                        : 'h-[calc(50%-8px)] w-[calc(50%-8px)]'
                    }`}
                  >
                    {item.img && (
                      <img
                        src={item.img}
                        alt=""
                        className="rounded-2xl h-full w-full object-contain"
                      />
                    )}
                    <div
                      onClick={() =>
                        handleTakeControl(
                          activeAgent?.activeWebviewIds?.[0]?.id || ''
                        )
                      }
                      className="bg-black/20 inset-0 rounded-lg pointer-events-none absolute flex h-full w-full items-center justify-center opacity-0 transition-all group-hover:opacity-100"
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
          <div className="bottom-2 right-2 gap-1 rounded-lg border-ds-border-neutral-strong-default bg-ds-bg-neutral-strong-default p-1 absolute z-100 flex w-auto items-center border border-solid">
            <Button
              size="xs"
              buttonContent="icon-only"
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
              size="xs"
              buttonContent="icon-only"
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
              size="xs"
              buttonContent="icon-only"
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
