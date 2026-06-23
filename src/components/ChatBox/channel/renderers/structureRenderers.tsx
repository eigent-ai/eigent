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

import { ChatTaskStatus, SessionMode } from '@/types/constants';
import type {
  PlanItem,
  PreparingItem,
  TurnBoundaryItem,
  UnsupportedItem,
  WorkLogItem,
} from '@/types/sessionChannel';
import { motion } from 'framer-motion';
import { Inspect } from 'lucide-react';
import { useState } from 'react';
import { PreparingToExecuteTasks } from '../../MessageItem/PreparingToExecuteTasks';
import { TaskWorkLogAccordion } from '../../MessageItem/TaskWorkLogAccordion';
import { PlanTaskBox } from '../../TaskBox/PlanTaskBox';
import { TaskCard } from '../../TaskBox/TaskCard';
import type { ChannelRenderer } from '../context';

/**
 * Turn divider. The first turn opens silently; later turns get a subtle "Run N"
 * separator so the back-and-forth conversation reads as distinct exchanges.
 * (`data-turn-id` lives on the section wrapper in SessionChannel, not here.)
 */
export const TurnBoundaryRenderer: ChannelRenderer<TurnBoundaryItem> = ({
  item,
}) => {
  if (item.turnNumber <= 1) return null;
  return (
    <div className="gap-3 px-6 py-3 flex items-center">
      <div className="bg-ds-border-neutral-default-default h-px flex-1" />
      <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
        Run {item.turnNumber}
      </span>
      <div className="bg-ds-border-neutral-default-default h-px flex-1" />
    </div>
  );
};

export const PlanRenderer: ChannelRenderer<PlanItem> = ({ item, ctx }) => {
  const resolved = ctx.resolveTurn(item.turnId);
  if (!resolved) return null;
  const { chatStore, taskId } = resolved;
  const chatState = chatStore.getState();
  const task = chatState.tasks[taskId];

  if (task?.sessionMode === SessionMode.SINGLE_AGENT) return null;

  const hasConfirmedSubTasks = item.confirmed && item.subTasks.length > 0;
  const isRunning = task?.status === ChatTaskStatus.RUNNING;
  const isPlanning =
    !item.confirmed && (item.streamingDecomposeText.length > 0 || isRunning);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <div
        style={{ transition: 'all 0.3s ease-in-out', transformOrigin: 'top' }}
      >
        {hasConfirmedSubTasks ? (
          <TaskCard
            key={`task-${taskId}`}
            chatId={taskId}
            taskId={taskId}
            taskInfo={item.subTasks}
            taskType={1}
            taskAssigning={task?.taskAssigning || []}
            taskRunning={task?.taskRunning || []}
            progressValue={task?.progressValue || 0}
            summaryTask={item.summaryTask}
            onAddTask={() => chatState.addTaskInfo()}
            onUpdateTask={(taskIndex, content) =>
              chatState.updateTaskInfo(taskIndex, content)
            }
            onSaveTask={() => chatState.saveTaskInfo()}
            onDeleteTask={(taskIndex) => chatState.deleteTaskInfo(taskIndex)}
            clickable={true}
          />
        ) : isPlanning ? (
          <PlanTaskBox chatStore={chatStore} taskId={taskId} />
        ) : null}
      </div>
    </motion.div>
  );
};

export const WorkLogRenderer: ChannelRenderer<WorkLogItem> = ({
  item,
  ctx,
}) => {
  const resolved = ctx.resolveTurn(item.turnId);
  if (!resolved) return null;
  const showPreparing = item.status === 'running' && item.blocks.length === 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 }}
      className="px-6"
    >
      {showPreparing ? <PreparingToExecuteTasks /> : null}
      <TaskWorkLogAccordion
        chatStore={resolved.chatStore}
        taskId={resolved.taskId}
      />
    </motion.div>
  );
};

export const PreparingRenderer: ChannelRenderer<PreparingItem> = () => (
  <div className="px-6">
    <PreparingToExecuteTasks />
  </div>
);

/**
 * Fallback for a message the channel can't confidently render (structural step
 * leaked into `messages[]`, an unknown/renamed legacy step, or a renderer that
 * threw). It shows nothing inline — only a small, low-contrast inspect icon.
 * Clicking it toggles a diagnostic chip (reason + original step/role/content
 * preview) so engineers can see exactly what was demoted, without ever surfacing
 * a raw internal payload to the user.
 */
export const UnsupportedRenderer: ChannelRenderer<UnsupportedItem> = ({
  item,
}) => {
  const [open, setOpen] = useState(false);
  const reasonLabel =
    item.reason === 'structural-step'
      ? 'Structural step (not displayable)'
      : item.reason === 'render-error'
        ? 'Renderer error'
        : 'Unknown / legacy step';

  return (
    <div className="px-6 py-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Inspect unsupported message"
        aria-expanded={open}
        className="text-ds-icon-neutral-muted-default opacity-30 transition-opacity hover:opacity-100"
      >
        <Inspect className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <div className="mt-1 gap-1 rounded-lg border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default px-2 py-1.5 text-label-xs text-ds-text-neutral-muted-default flex flex-col border">
          <span className="font-medium">
            Unsupported channel item · {reasonLabel}
          </span>
          {item.sourceStep && <span>step: {item.sourceStep}</span>}
          {item.sourceRole && <span>role: {item.sourceRole}</span>}
          {item.messageId && <span>messageId: {item.messageId}</span>}
          {item.preview && (
            <span className="break-words whitespace-pre-wrap opacity-80">
              {item.preview}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
