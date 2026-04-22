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

import tokenDarkIcon from '@/assets/token-dark.svg';
import tokenLightIcon from '@/assets/token-light.svg';
import { ClipboardList } from '@/components/ui/animate-ui/icons/clipboard-list';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatedTokenNumber, formatSplittingElapsed } from './TokenUtils';

/** Shared start wall time when the task has no `taskTime` / `elapsed` yet (keeps a stable clock across remounts). */
const splittingTimerStartMsByTaskId = new Map<string, number>();

/** Matches work-log / `getFormattedTaskTime` (TaskWorkLogAccordion `getTaskElapsedMs`). */
function getTaskElapsedMs(task: { taskTime: number; elapsed: number }): number {
  if (task.taskTime !== 0) {
    return Math.max(0, Date.now() - task.taskTime + task.elapsed);
  }
  return Math.max(0, task.elapsed);
}

function getOrCreateSplittingMapStart(taskId: string): number {
  let start = splittingTimerStartMsByTaskId.get(taskId);
  if (start === undefined) {
    start = Date.now();
    splittingTimerStartMsByTaskId.set(taskId, start);
  }
  return start;
}

function clearSplittingTimerStart(taskId: string) {
  splittingTimerStartMsByTaskId.delete(taskId);
}

function isSplittingSkeletonPhase(task: any): boolean {
  if (!task) return false;
  const anyToSubTasksMessage = task.messages?.find(
    (m: any) => m.step === AgentStep.TO_SUB_TASKS
  );
  return (
    (task.status !== ChatTaskStatus.FINISHED &&
      task.status !== ChatTaskStatus.RUNNING &&
      !anyToSubTasksMessage &&
      !task.hasWaitComfirm &&
      (task.messages?.length ?? 0) > 0) ||
    (task.isTakeControl && !anyToSubTasksMessage)
  );
}

function useSplittingPhaseElapsedMs(
  chatStore: VanillaChatStore,
  taskId: string | null
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!taskId) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const sync = () => {
      const task = chatStore.getState().tasks[taskId];
      if (!isSplittingSkeletonPhase(task)) {
        clearSplittingTimerStart(taskId);
      }
    };
    sync();
    const unsubscribe = chatStore.subscribe(sync);
    return () => {
      unsubscribe();
      clearSplittingTimerStart(taskId);
    };
  }, [chatStore, taskId]);

  if (!taskId) return 0;
  const task = chatStore.getState().tasks[taskId];
  if (!task) return 0;
  const fromTask = getTaskElapsedMs(task);
  if (fromTask > 0 || task.taskTime !== 0) {
    return fromTask;
  }
  return Math.max(0, now - getOrCreateSplittingMapStart(taskId));
}

export interface SplittingProgressRowProps {
  chatStore: VanillaChatStore;
  taskId: string | null;
  className?: string;
}

export function SplittingProgressRow({
  chatStore,
  taskId,
  className,
}: SplittingProgressRowProps) {
  const { t } = useTranslation();
  const { appearance } = useAuthStore();
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const elapsedMs = useSplittingPhaseElapsedMs(chatStore, taskId);

  const tokens = useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => (taskId ? (chatStore.getState().tasks[taskId]?.tokens ?? 0) : 0),
    () => (taskId ? (chatStore.getState().tasks[taskId]?.tokens ?? 0) : 0)
  );

  return (
    <div
      className={cn(
        'gap-x-2 gap-y-1 min-w-0 py-2 mx-3 flex w-full flex-wrap items-center justify-start',
        className
      )}
    >
      <div className="flex shrink-0 items-center justify-center">
        <ClipboardList
          animate
          loop
          size={16}
          className="text-ds-icon-information-default-default"
        />
      </div>
      <span className="text-body-sm font-medium text-ds-text-information-default-default shrink-0">
        {t('chat.splitting-tasks')}
      </span>
      <span className="text-body-sm font-normal text-ds-text-neutral-subtle-default shrink-0 tabular-nums">
        {formatSplittingElapsed(elapsedMs)}
      </span>
      <span className="text-body-sm font-normal text-ds-text-neutral-subtle-default shrink-0 tabular-nums">
        {' '}
        •{' '}
      </span>
      <span
        className="gap-1 text-body-sm font-normal text-ds-text-neutral-subtle-default flex shrink-0 items-center"
        aria-label={`${t('chat.token')}: ${tokens}`}
      >
        <AnimatedTokenNumber value={tokens} />
        tokens
      </span>
    </div>
  );
}
