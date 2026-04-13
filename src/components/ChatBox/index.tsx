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

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import FoldedPanel from '@/components/Workforce/FoldedPanel';
import { cn } from '@/lib/utils';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, TriangleAlert, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import BottomBox from './BottomBox';
import { CHAT_TIMELINE_DEFAULT_COLLAPSED, ChatTimeline } from './ChatTimeline';
import { HeaderBox } from './HeaderBox';
import { ProjectChatContainer } from './ProjectChatContainer';
import {
  CHAT_TIMELINE_BREAKPOINT_PX,
  WORKFORCE_FOLDED_RAIL_CLASS,
  useWorkforceChatInput,
} from './useWorkforceChatInput';

export type ChatBoxProps = {
  /** When the full-screen workforce overlay is open; pauses folded panel agent sync. */
  workforceExpandedOverlayOpen?: boolean;
  onToggleWorkforceExpandedOverlay?: () => void;
  /** Session shell: 240px right rail and optional back control. */
  workforceSessionMode?: boolean;
  onBackToProject?: () => void;
};

export default function ChatBox({
  workforceExpandedOverlayOpen = false,
  onToggleWorkforceExpandedOverlay,
  workforceSessionMode = false,
  onBackToProject,
}: ChatBoxProps): JSX.Element {
  const [chatTimelineCollapsed, setChatTimelineCollapsed] = useState(
    CHAT_TIMELINE_DEFAULT_COLLAPSED
  );
  const [timelineDropdownOpen, setTimelineDropdownOpen] = useState(false);
  const chatBoxContainerRef = useRef<HTMLDivElement>(null);
  const [chatBoxWidth, setChatBoxWidth] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomBoxOverlayRef = useRef<HTMLDivElement>(null);

  const {
    chatStore,
    projectStore,
    message,
    setMessage,
    textareaRef,
    taskTime,
    loading,
    isReplayLoading,
    isPauseResumeLoading,
    hasModel,
    useCloudModelInDev,
    queuedMessages,
    handleRemoveTaskQueue,
    getBottomBoxState,
    handleSend,
    handleConfirmTask,
    handleFileSelect,
    handlePauseResume,
    handleEditQuery,
    handleReplay,
    handleSkip,
    isInputDisabled,
    scrollBottomInsetPx,
    hasAnyMessages,
    handleFileUpload,
    fileInputRef,
  } = useWorkforceChatInput({
    scrollContainerRef,
    bottomBoxOverlayRef,
    measureScrollBottomInset: true,
  });

  const { t } = useTranslation();
  const navigate = useNavigate();
  const setScrollToQueryId = usePageTabStore((s) => s.setScrollToQueryId);
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const workforceRailCollapsed = usePageTabStore(
    (s) => s.workforceRailCollapsed
  );
  const toggleWorkforceRailCollapsed = usePageTabStore(
    (s) => s.toggleWorkforceRailCollapsed
  );
  const [addWorkerDialogOpen, setAddWorkerDialogOpen] = useState(false);

  useLayoutEffect(() => {
    const el = chatBoxContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number' && Number.isFinite(w)) setChatBoxWidth(w);
    });
    ro.observe(el);
    setChatBoxWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const isNarrowTimelineLayout = useMemo(
    () => chatBoxWidth !== null && chatBoxWidth < CHAT_TIMELINE_BREAKPOINT_PX,
    [chatBoxWidth]
  );

  useEffect(() => {
    if (!isNarrowTimelineLayout) setTimelineDropdownOpen(false);
  }, [isNarrowTimelineLayout]);

  const handleScrollToQueryForTimeline = useCallback(
    (id: string) => {
      setScrollToQueryId(id);
      if (isNarrowTimelineLayout) setTimelineDropdownOpen(false);
    },
    [setScrollToQueryId, isNarrowTimelineLayout]
  );

  const allTaskEntries = useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const stores = projectStore.getAllChatStores(pid);
    const entries: Array<{
      chatId: string;
      taskId: string;
      task: ChatStore['tasks'][string];
      firstUserMessageId: string | null;
    }> = [];
    for (const { chatId, chatStore: cs } of stores) {
      const state = cs.getState();
      const tid = state.activeTaskId;
      if (!tid || !state.tasks[tid]) continue;
      const task = state.tasks[tid];
      const hasUserMessages = task.messages.some(
        (m) => m.role === 'user' && m.content
      );
      if (!hasUserMessages) continue;
      const firstUser = task.messages.find((m) => m.role === 'user');
      entries.push({
        chatId,
        taskId: tid,
        task,
        firstUserMessageId: firstUser?.id ?? null,
      });
    }
    return entries;
  }, [projectStore, chatStore]);

  const workforceRailEffectiveCollapsed =
    workforceRailCollapsed && hasAnyMessages;

  useEffect(() => {
    if (!hasAnyMessages && workforceExpandedOverlayOpen) {
      onToggleWorkforceExpandedOverlay?.();
    }
  }, [
    hasAnyMessages,
    workforceExpandedOverlayOpen,
    onToggleWorkforceExpandedOverlay,
  ]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const workforcePanelKey = chatStore.activeTaskId ?? '';

  const chatColumn = (
    <>
      {chatStore.activeTaskId && hasAnyMessages && (
        <HeaderBox
          totalTokens={chatStore.tasks[chatStore.activeTaskId]?.tokens || 0}
          status={chatStore.tasks[chatStore.activeTaskId]?.status}
          replayLoading={isReplayLoading}
          onReplay={handleReplay}
          narrowTimelineLayout={isNarrowTimelineLayout}
          timelineDropdownOpen={timelineDropdownOpen}
          onTimelineDropdownOpenChange={setTimelineDropdownOpen}
          timelineDropdownContent={
            isNarrowTimelineLayout ? (
              <ChatTimeline
                collapsed={false}
                entries={allTaskEntries}
                activeTaskId={chatStore.activeTaskId}
                setScrollToQueryId={handleScrollToQueryForTimeline}
                title={t('layout.chat-history-title', {
                  defaultValue: 'Chat history',
                })}
                emptyLabel={t('layout.no-tasks', {
                  defaultValue: 'No tasks',
                })}
              />
            ) : null
          }
          chatTimelineCollapsed={chatTimelineCollapsed}
          onToggleChatTimeline={() => setChatTimelineCollapsed((c) => !c)}
          workforceRailCollapsed={
            activeWorkspaceTab === 'workforce'
              ? workforceRailEffectiveCollapsed
              : undefined
          }
          onToggleWorkforceRail={
            activeWorkspaceTab === 'workforce'
              ? toggleWorkforceRailCollapsed
              : undefined
          }
          onBackToProject={
            workforceSessionMode && onBackToProject
              ? onBackToProject
              : undefined
          }
        />
      )}

      <div className="min-h-0 relative flex flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex flex-1 flex-row overflow-hidden">
          <div className="min-h-0 min-w-0 relative flex flex-1 flex-col overflow-hidden">
            <div
              ref={scrollContainerRef}
              className="scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
            >
              {hasAnyMessages ? (
                <ProjectChatContainer
                  scrollContainerRef={scrollContainerRef}
                  scrollBottomInsetPx={scrollBottomInsetPx}
                  onSkip={handleSkip}
                  isPauseResumeLoading={isPauseResumeLoading}
                />
              ) : (
                <div className="pl-4 pr-2 mx-auto flex min-h-full w-full max-w-[600px] flex-col">
                  <div className="gap-1 pb-4 flex flex-1 flex-col items-center justify-end">
                    <div className="text-heading-base font-bold text-text-heading text-center">
                      {t('layout.welcome-to-eigent')}
                    </div>
                  </div>

                  {chatStore.activeTaskId && (
                    <BottomBox
                      state="input"
                      queuedMessages={queuedMessages}
                      onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                      inputProps={{
                        value: message,
                        onChange: setMessage,
                        onSend: handleSend,
                        files:
                          chatStore.tasks[
                            chatStore.activeTaskId
                          ]?.attaches?.map((f) => ({
                            fileName: f.fileName,
                            filePath: f.filePath,
                          })) || [],
                        onFilesChange: (files) =>
                          chatStore.setAttaches(
                            chatStore.activeTaskId as string,
                            files as any
                          ),
                        onAddFile: handleFileSelect,
                        disabled: isInputDisabled,
                        textareaRef: textareaRef,
                        allowDragDrop: true,
                        useCloudModelInDev: useCloudModelInDev,
                      }}
                    />
                  )}

                  <div className="mt-3 gap-2 flex h-[210px] flex-1 items-start justify-center">
                    {!hasModel ? (
                      <div className="gap-2 flex items-center">
                        <div
                          onClick={() => {
                            navigate('/history?tab=agents');
                          }}
                          className="gap-2 rounded-md bg-surface-warning px-sm py-xs flex cursor-pointer items-center"
                        >
                          <TriangleAlert
                            size={20}
                            className="text-icon-warning"
                          />
                          <span className="text-xs font-medium text-text-warning flex-1 leading-[20px]">
                            {t('layout.please-select-model')}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="mr-2 gap-2 flex flex-col items-center">
                        {[
                          {
                            label: t('layout.it-ticket-creation'),
                            message: t('layout.it-ticket-creation-message'),
                          },
                          {
                            label: t('layout.bank-transfer-csv-analysis'),
                            message: t(
                              'layout.bank-transfer-csv-analysis-message'
                            ),
                          },
                          {
                            label: t('layout.find-duplicate-files'),
                            message: t('layout.find-duplicate-files-message'),
                          },
                        ].map(({ label, message: suggestionMessage }) => (
                          <div
                            key={label}
                            className="rounded-md bg-surface-tertiary px-sm py-xs text-xs font-medium text-button-tertiery-text-default cursor-pointer leading-none opacity-70 transition-all duration-300 hover:opacity-100"
                            onClick={() => {
                              setMessage(suggestionMessage);
                            }}
                          >
                            <span>{label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {chatStore.activeTaskId && hasAnyMessages && (
              <div
                ref={bottomBoxOverlayRef}
                className="inset-x-0 bottom-0 pointer-events-none absolute z-30 flex justify-center"
              >
                <div className="px-sm pointer-events-auto w-full max-w-[600px]">
                  <BottomBox
                    state={getBottomBoxState()}
                    queuedMessages={queuedMessages}
                    onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
                    subtitle={
                      getBottomBoxState() === 'confirm'
                        ? (() => {
                            const messages =
                              chatStore.tasks[chatStore.activeTaskId]
                                ?.messages || [];
                            const lastUserMessage = messages
                              .slice()
                              .reverse()
                              .find((msg) => msg.role === 'user');
                            return (
                              lastUserMessage?.content ||
                              chatStore.tasks[chatStore.activeTaskId]
                                ?.summaryTask
                            );
                          })()
                        : chatStore.tasks[chatStore.activeTaskId]?.summaryTask
                    }
                    onStartTask={() => handleConfirmTask()}
                    onEdit={handleEditQuery}
                    taskTime={taskTime}
                    taskStatus={chatStore.tasks[chatStore.activeTaskId]?.status}
                    onPauseResume={handlePauseResume}
                    pauseResumeLoading={isPauseResumeLoading}
                    loading={loading}
                    inputProps={{
                      value: message,
                      onChange: setMessage,
                      onSend: handleSend,
                      files:
                        chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(
                          (f) => ({
                            fileName: f.fileName,
                            filePath: f.filePath,
                          })
                        ) || [],
                      onFilesChange: (files) =>
                        chatStore.setAttaches(
                          chatStore.activeTaskId as string,
                          files as any
                        ),
                      onAddFile: handleFileSelect,
                      placeholder: t('chat.follow-up-placeholder'),
                      disabled: isInputDisabled,
                      textareaRef: textareaRef,
                      allowDragDrop: true,
                      useCloudModelInDev: useCloudModelInDev,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <div
      ref={chatBoxContainerRef}
      className="border-border-tertiary rounded-2xl bg-surface-secondary h-full w-full flex-none items-center justify-center overflow-hidden border-solid"
    >
      {activeWorkspaceTab === 'workforce' ? (
        <div className="min-h-0 min-w-0 flex h-full w-full flex-1 flex-row overflow-hidden">
          <div className="min-h-0 min-w-0 relative flex flex-1 flex-col overflow-hidden">
            {chatColumn}
          </div>
          <div
            id="workforce-folded-rail"
            className={cn(
              'min-h-0 ease-out flex min-w-[280px] shrink-0 flex-col overflow-hidden transition-[width] duration-200',
              workforceRailEffectiveCollapsed
                ? 'w-0'
                : WORKFORCE_FOLDED_RAIL_CLASS
            )}
            aria-hidden={workforceRailEffectiveCollapsed}
          >
            <div className="gap-2 p-2 relative z-50 flex w-full shrink-0 items-center justify-between">
              <div className="min-w-0 gap-3 flex flex-1 items-center overflow-hidden">
                <span className="text-text-heading px-1 text-body-md font-semibold shrink-0">
                  {t('layout.aiWorkforce')}
                </span>
              </div>
              <div className="gap-1 flex shrink-0 items-center">
                {hasAnyMessages && (
                  <TooltipSimple
                    content={
                      workforceExpandedOverlayOpen
                        ? t('layout.close')
                        : t('layout.expand-workforce', {
                            defaultValue: 'Expand workforce',
                          })
                    }
                    delayDuration={300}
                    side="bottom"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      buttonRadius="lg"
                      className="shrink-0"
                      onClick={() => onToggleWorkforceExpandedOverlay?.()}
                      aria-pressed={workforceExpandedOverlayOpen}
                      aria-label={
                        workforceExpandedOverlayOpen
                          ? t('layout.close')
                          : t('layout.expand-workforce', {
                              defaultValue: 'Expand workforce',
                            })
                      }
                    >
                      {workforceExpandedOverlayOpen ? (
                        <X className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipSimple>
                )}
              </div>
            </div>
            <div className="min-h-0 min-w-0 w-full flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${workforcePanelKey}-folded`}
                  initial={{ opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(4px)' }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0 h-full w-full"
                >
                  <FoldedPanel
                    pauseAgentWorkspaceSync={workforceExpandedOverlayOpen}
                  />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex h-full w-full flex-col overflow-hidden">
          {chatColumn}
        </div>
      )}
    </div>
  );
}
