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

import { isUserMessageReplyToAsk } from '@/lib/humanInteractionMessages';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { resolveWorkspaceFilePath } from '@/lib/workspaceRelativePath';
import { VanillaChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import { motion } from 'framer-motion';
import { ChevronDown, InfoIcon } from 'lucide-react';
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AgentMessageCard } from './MessageItem/AgentMessageCard';
import { ArtifactChangeList } from './MessageItem/ArtifactChangeList';
import {
  HumanInteractionCard,
  isHumanInteractionReadOnly,
} from './MessageItem/HumanInteractionCard';
import { NoticeCard } from './MessageItem/NoticeCard';
import { PreparingToExecuteTasks } from './MessageItem/PreparingToExecuteTasks';
import {
  getTaskRunDisplayStatus,
  TaskWorkLogAccordion,
} from './MessageItem/TaskWorkLogAccordion';
import { UserMessageCard } from './MessageItem/UserMessageCard';
import { PlanTaskBox } from './TaskBox/PlanTaskBox';
import { isPlanSplittingPhase } from './TaskBox/PlanTaskBox/utils';
import { TaskCard } from './TaskBox/TaskCard';

/** Collapsible card that shows a single agent's result (workforce / non–single-agent turns). */
const AgentResultCard: React.FC<{
  id: string;
  agentName?: string;
  content: string;
  attaches?: any[];
  defaultOpen?: boolean;
}> = ({ id, agentName, content, attaches, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const label = agentName || 'Agent';

  return (
    <div className="overflow-hidden px-2">
      {/* Header (always visible) */}
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold text-ds-ink-default-default transition-colors hover:bg-ds-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-ring-focus/40 focus-visible:outline-none active:shadow-ds-elevation-control-pressed"
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`shrink-0 text-ds-ink-default-default transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>

      {/* Collapsible body */}
      <div
        className={`overflow-hidden transition-opacity duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-x-0 border-t border-b-0 border-ds-hairline-default-default px-1 py-1">
          <AgentMessageCard
            id={id}
            content={content}
            typewriter={false}
            onTyping={() => {}}
            attaches={attaches}
          />
        </div>
      </div>
    </div>
  );
};

/** Typewriter only for the agent message currently being produced (latest agent row while task is running). */
function shouldUseLiveAgentTypewriter(
  task: {
    type?: string;
    delayTime?: number;
    status: string;
    messages: any[];
  } | null,
  messageId: string
): boolean {
  const replayAllows =
    task?.type !== 'replay' ||
    (task?.type === 'replay' && task?.delayTime !== 0);
  if (!replayAllows) return false;
  if (!task || task.status !== ChatTaskStatus.RUNNING) return false;
  const msgs = task.messages;
  if (!msgs.length) return false;
  const last = msgs[msgs.length - 1];
  return last.role === 'agent' && last.id === messageId;
}

export interface QueryGroup {
  queryId: string;
  userMessage: any;
  taskMessage?: any;
  otherMessages: any[];
  /** Structured ASK replies stay inside their Run instead of starting a turn. */
  interactionResponses?: Record<string, any>;
  /** Exactly one query group owns the Run-scoped task work log. */
  ownsRunWorkLog?: boolean;
}

interface UserQueryGroupProps {
  chatId: string;
  chatStore: VanillaChatStore;
  queryGroup: QueryGroup;
  isActive: boolean;
  onQueryActive: (queryId: string | null) => void;
  index: number;
  /**
   * The task this query group belongs to. When provided, all task-derived
   * UI (TaskCard summary, PlanTaskBox state, work log) reflects THIS task
   * instead of `chatStore.activeTaskId` (which is the latest task and would
   * make every historic group repaint with the newest summary).
   */
  taskId?: string;
}

export { isUserMessageReplyToAsk } from '@/lib/humanInteractionMessages';

export const UserQueryGroup: React.FC<UserQueryGroupProps> = ({
  chatId,
  chatStore,
  queryGroup,
  isActive: _isActive,
  onQueryActive,
  index,
  taskId: scopedTaskId,
}) => {
  const { t } = useTranslation();
  const groupRef = useRef<HTMLDivElement>(null);
  const chatState = chatStore.getState();

  const activeTaskId = scopedTaskId ?? chatState.activeTaskId;
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const workspaceRoot = useSpaceStore((s) =>
    activeSpaceId ? s.spaces[activeSpaceId]?.rootPath : undefined
  );
  const openFilePreviewInPanel = usePageTabStore(
    (state) => state.openFilePreview
  );
  const openReviewPreview = usePageTabStore((state) => state.openReviewPreview);
  const openFilePreview = useCallback(
    (file: FileInfo) => {
      const resolvedPath =
        file.path?.trim() ||
        resolveWorkspaceFilePath(workspaceRoot, file.relativePath);
      openFilePreviewInPanel(
        resolvedPath && resolvedPath !== file.path
          ? { ...file, path: resolvedPath, localPathAvailable: true }
          : file
      );
    },
    [openFilePreviewInPanel, workspaceRoot]
  );
  const viewChanges = activeTaskId
    ? () => openReviewPreview({ runId: activeTaskId })
    : undefined;

  // Subscribe to streaming decompose text separately for efficient updates
  const streamingDecomposeText = useSyncExternalStore(
    (callback) => chatStore.subscribe(callback),
    () => {
      const state = chatStore.getState();
      const taskId = activeTaskId;
      if (!taskId || !state.tasks[taskId]) return '';
      return state.tasks[taskId].streamingDecomposeText || '';
    }
  );

  // A human reply is scoped to the user message directly following its ASK.
  // Do not use task.activeAsk here: that is Run-global state and used to make
  // every historical user query look like a reply while input was pending.
  const isHumanReply =
    queryGroup.userMessage &&
    activeTaskId &&
    chatState.tasks[activeTaskId] &&
    isUserMessageReplyToAsk(
      chatState.tasks[activeTaskId].messages,
      queryGroup.userMessage.id
    );

  const activeTask = activeTaskId ? chatState.tasks[activeTaskId] : undefined;
  const lastUserMessageId = activeTask?.messages
    .filter((m: any) => m.role === 'user')
    .pop()?.id;
  const isCurrentUserQuery = Boolean(
    !queryGroup.taskMessage &&
    !isHumanReply &&
    activeTask &&
    queryGroup.userMessage &&
    queryGroup.userMessage.id === lastUserMessageId
  );
  const isLastUserQuery =
    isCurrentUserQuery &&
    // Only show during active phases (not finished)
    activeTask?.status !== ChatTaskStatus.FINISHED;

  const isSingleAgentTask =
    inferSessionModeFromTask(activeTask, SessionMode.WORKFORCE) ===
    SessionMode.SINGLE_AGENT;
  const hasUnconfirmedPlan = Boolean(
    activeTask?.messages.some(
      (m: any) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
    )
  );
  const isInitialTaskPreparation = Boolean(
    isLastUserQuery &&
    activeTask?.isPending &&
    streamingDecomposeText.length === 0 &&
    !activeTask.messages.some((m: any) => m.step === AgentStep.TO_SUB_TASKS)
  );
  // Single agent has no task-splitting/confirm step — it runs directly — so it
  // never has a planning phase. Skipping this avoids the splitting card
  // showing during the PENDING window after the backend `confirmed` event.
  const isPlanningPhase = Boolean(
    activeTask &&
    !isSingleAgentTask &&
    !activeTask.hasWaitComfirm &&
    (isPlanSplittingPhase(activeTask) ||
      streamingDecomposeText.length > 0 ||
      hasUnconfirmedPlan)
  );

  // Show the fallback task box for the newest query only while the agent is
  // actually planning. Direct running tasks without `to_sub_tasks` should stay
  // in the normal running/input path.
  const shouldShowFallbackTask =
    isLastUserQuery && activeTaskId && isPlanningPhase;
  // Single agent has no split/confirm step: once the task is the current
  // query and past planning, show its task-card area immediately — even while
  // PENDING — so the "Preparing to execute" item can render before the work
  // log. `TaskWorkLogAccordion` self-hides until the task reaches RUNNING.
  const shouldShowRunWorkLog =
    queryGroup.ownsRunWorkLog === true &&
    activeTaskId &&
    activeTask &&
    !isPlanningPhase;

  const task =
    (queryGroup.taskMessage ||
      shouldShowFallbackTask ||
      shouldShowRunWorkLog) &&
    activeTaskId
      ? chatState.tasks[activeTaskId]
      : null;
  const runDisplayStatus = task ? getTaskRunDisplayStatus(task) : undefined;
  const hasVisibleAgentOutput = queryGroup.otherMessages.some(
    (message) =>
      message?.step !== AgentStep.ASK &&
      typeof message?.content === 'string' &&
      message.content.trim().length > 0
  );
  const showMissingFinalResponse = Boolean(
    task?.status === ChatTaskStatus.FINISHED &&
    runDisplayStatus &&
    !hasVisibleAgentOutput
  );

  // Set up intersection observer for this query group
  useEffect(() => {
    if (!groupRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onQueryActive(queryGroup.queryId);
          }
        });
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: 0.1,
      }
    );

    observer.observe(groupRef.current);

    return () => {
      observer.disconnect();
    };
  }, [queryGroup.queryId, onQueryActive]);

  // Check if we're in skeleton phase — never for single agent (no splitting).
  // Gate on `isLastUserQuery`: historic turns that quit before emitting
  // `to_sub_tasks` (e.g. context_too_long, browser-aborted, parent killed)
  // would otherwise satisfy `isPlanSplittingPhase` forever and each render
  // its own "Subtasks Planning" spinner. Only the current/latest turn should
  // show the live splitting UI; abandoned turns fall through to taskCardVisible
  // and the conditional below renders nothing instead of a stale spinner.
  const isSkeletonPhase =
    task &&
    !isSingleAgentTask &&
    isPlanSplittingPhase(task) &&
    isLastUserQuery &&
    !isInitialTaskPreparation;

  /** Task card visible (user message is sticky alone in this mode). */
  const taskCardVisible = Boolean(task) && !isSkeletonPhase && !isHumanReply;
  const showTaskPlanCard =
    taskCardVisible &&
    !(shouldShowRunWorkLog && isSingleAgentTask) &&
    !isInitialTaskPreparation;

  const hasConfirmedSubTasks = Boolean(
    task?.messages.some(
      (m: any) => m.step === AgentStep.TO_SUB_TASKS && m.isConfirm
    )
  );
  const showPreparingExecute =
    Boolean(activeTaskId && task) &&
    task!.status === ChatTaskStatus.PENDING &&
    (isInitialTaskPreparation ||
      // Workforce: after the user confirms the plan, before the work log.
      (showTaskPlanCard && hasConfirmedSubTasks) ||
      // Single agent: from submit until the first `todo_state` arrives.
      (shouldShowRunWorkLog && isSingleAgentTask));
  const shouldShowPlanTaskBox = Boolean(
    !hasConfirmedSubTasks && (isLastUserQuery || queryGroup.taskMessage)
  );

  return (
    <motion.div
      ref={groupRef}
      data-query-id={queryGroup.queryId}
      data-task-card={taskCardVisible ? 'true' : undefined}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.1, // Stagger animation for multiple groups
      }}
      className="relative flex flex-col gap-3"
    >
      {/* User query: always rendered as a regular component in the chat flow. */}
      {queryGroup.userMessage && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="px-2 py-2"
        >
          <UserMessageCard
            id={queryGroup.userMessage.id}
            content={queryGroup.userMessage.content}
            attaches={queryGroup.userMessage.attaches}
          />
        </motion.div>
      )}

      {showTaskPlanCard && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration: 0.3,
            delay: 0.1,
          }}
        >
          <div
            style={{
              transition: 'all 0.3s ease-in-out',
              transformOrigin: 'top',
            }}
          >
            {
              hasConfirmedSubTasks ? (
                <TaskCard
                  key={`task-${activeTaskId}-${queryGroup.queryId}`}
                  chatId={chatId}
                  taskId={activeTaskId}
                  taskInfo={task?.taskInfo || []}
                  taskType={queryGroup.taskMessage?.taskType || 1}
                  taskAssigning={task?.taskAssigning || []}
                  taskRunning={task?.taskRunning || []}
                  progressValue={task?.progressValue || 0}
                  summaryTask={task?.summaryTask || ''}
                  onAddTask={() => {
                    chatState.addTaskInfo();
                  }}
                  onUpdateTask={(taskIndex, content) => {
                    chatState.updateTaskInfo(taskIndex, content);
                  }}
                  onSaveTask={() => {
                    chatState.saveTaskInfo();
                  }}
                  onDeleteTask={(taskIndex) => {
                    chatState.deleteTaskInfo(taskIndex);
                  }}
                  clickable={true}
                />
              ) : shouldShowPlanTaskBox ? (
                // Live planning UI: latest splitting turn or the group that
                // owns an unconfirmed to_sub_tasks message.
                <PlanTaskBox
                  chatStore={chatStore}
                  taskId={activeTaskId}
                  userPrompt={queryGroup.userMessage?.content}
                />
              ) : null /* historic turn that never confirmed a plan: skip the stale spinner */
            }
          </div>
        </motion.div>
      )}

      {taskCardVisible && activeTaskId && queryGroup.ownsRunWorkLog && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="px-2"
        >
          {showPreparingExecute ? <PreparingToExecuteTasks /> : null}
          <TaskWorkLogAccordion chatStore={chatStore} taskId={activeTaskId} />
        </motion.div>
      )}

      {/* Other Messages */}
      {queryGroup.otherMessages.map((message) => {
        if (message.step === AgentStep.ASK && message.interaction) {
          if (
            activeTask?.resolvedInteractionIds?.includes(
              message.interaction.interaction_id
            )
          ) {
            return null;
          }
        }

        const isDurablyWaitingReplay =
          message.step === AgentStep.ASK &&
          message.interaction &&
          activeTask?.type === 'replay' &&
          !isHumanInteractionReadOnly({
            interaction: message.interaction,
            activeTaskId,
            taskType: activeTask.type,
            taskStatus: activeTask.status,
            durableRunStatus: activeTask.durableRunStatus,
          });

        // A replay reattached to a live durable waiter remains actionable even
        // though its legacy task is terminal. This is the only ASK that stays
        // in the chat flow; normal live requests belong to BottomBox/work log.
        if (isDurablyWaitingReplay) {
          return (
            <HumanInteractionCard
              key={`interaction-${message.id}`}
              interaction={message.interaction}
              readOnly={false}
              onResolved={() => {
                if (!activeTaskId) return;
                const state = chatStore.getState();
                state.markHumanInteractionResolved(
                  activeTaskId,
                  message.interaction.interaction_id
                );
                const current = chatStore.getState().tasks[activeTaskId];
                if (!current) return;
                const [nextAsk, ...remainingAsks] = current.askList;
                state.setActiveAskList(activeTaskId, remainingAsks);
                state.setActiveAsk(activeTaskId, nextAsk?.agent_name || '');
                state.setIsPending(activeTaskId, false);
                state.setDurableRunStatus(
                  activeTaskId,
                  nextAsk ? 'waiting_for_user' : 'running'
                );
                state.setStatus(activeTaskId, ChatTaskStatus.RUNNING);
                if (nextAsk) {
                  state.addMessages(activeTaskId, nextAsk);
                }
              }}
            />
          );
        }

        // ASK is a work-log interruption. The prompt is actionable only in
        // BottomBox while pending; TaskWorkLogAccordion keeps one receipt at
        // the matching Human Toolkit position and adds question + answer only
        // after the interaction is resolved.
        if (message.step === AgentStep.ASK) {
          return null;
        }
        if (message.content.length > 0) {
          if (message.step === AgentStep.END) {
            return (
              <motion.div
                key={`end-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col"
              >
                <AgentMessageCard
                  typewriter={shouldUseLiveAgentTypewriter(task, message.id)}
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                  deferredFooter={
                    message.fileList?.length ||
                    task?.artifactManifestTruncated ||
                    (task?.artifactManifestScanStatus &&
                      task.artifactManifestScanStatus !== 'complete') ? (
                      <div className="flex flex-col gap-2">
                        <ArtifactChangeList
                          files={message.fileList || []}
                          onOpen={openFilePreview}
                          onViewChanges={viewChanges}
                          scanStatus={task?.artifactManifestScanStatus}
                          truncated={task?.artifactManifestTruncated}
                        />
                      </div>
                    ) : undefined
                  }
                />
              </motion.div>
            );
          } else if (message.content === 'skip') {
            return (
              <motion.div
                key={`skip-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col"
              >
                <AgentMessageCard
                  key={message.id}
                  id={message.id}
                  content={t('chat.no-reply-task-continues', {
                    defaultValue: 'No reply received; the task continues…',
                  })}
                  onTyping={() => {}}
                />
              </motion.div>
            );
          } else if (message.step === AgentStep.AGENT_END) {
            return (
              <motion.div
                key={`agent-end-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="px-2"
              >
                <AgentResultCard
                  id={message.id}
                  agentName={message.agent_name}
                  content={message.content}
                  attaches={message.attaches}
                  defaultOpen
                />
              </motion.div>
            );
          } else {
            return (
              <motion.div
                key={`message-${message.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col"
              >
                <AgentMessageCard
                  key={message.id}
                  typewriter={shouldUseLiveAgentTypewriter(task, message.id)}
                  id={message.id}
                  content={message.content}
                  onTyping={() => {}}
                  attaches={message.attaches}
                />
              </motion.div>
            );
          }
        } else if (message.step === AgentStep.END && message.content === '') {
          return (
            <motion.div
              key={`end-empty-${message.id}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="flex flex-col"
            >
              <ArtifactChangeList
                files={message.fileList}
                onOpen={openFilePreview}
                onViewChanges={viewChanges}
                scanStatus={task?.artifactManifestScanStatus}
                truncated={task?.artifactManifestTruncated}
              />
            </motion.div>
          );
        }

        // Notice Card
        if (
          message.step === AgentStep.NOTICE_CARD &&
          !task?.isTakeControl &&
          task?.cotList &&
          task.cotList.length > 0
        ) {
          return <NoticeCard key={`notice-${message.id}`} />;
        }

        return null;
      })}

      {showMissingFinalResponse ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-2 flex flex-row items-center gap-2 rounded-xl bg-ds-neutral-default-default px-4 py-3 text-ds-text-base text-ds-ink-muted-default"
        >
          <InfoIcon className="size-4 text-ds-ink-default-default" />
          {t('chat.run-no-final-response')}
        </motion.div>
      ) : null}

      {/* PlanTaskBox now owns streaming + skeleton splitting UI for the active task. */}
      {isSkeletonPhase && activeTaskId && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="px-2"
        >
          <PlanTaskBox
            chatStore={chatStore}
            taskId={activeTaskId}
            userPrompt={queryGroup.userMessage?.content}
          />
        </motion.div>
      )}
    </motion.div>
  );
};
