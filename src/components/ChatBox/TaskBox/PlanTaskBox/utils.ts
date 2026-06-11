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

import type { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { useEffect, useMemo, useState } from 'react';

/** Parse `<task>...</task>` tokens out of a streaming decompose blob. */
function isDisplayableRawStreamingText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  return ![
    /^msgs=\[/,
    /BaseMessage\(/,
    /\brole_name=/,
    /\bmeta_dict=/,
    /\breasoning_content=/,
    /\bstream_accumulate_mode=/,
  ].some((pattern) => pattern.test(trimmed));
}

export function parseStreamingTasks(text: string): {
  tasks: string[];
  isStreaming: boolean;
} {
  const tasks: string[] = [];
  const completeTaskRegex = /<task>([\s\S]*?)<\/task>/g;
  let match: RegExpExecArray | null;
  while ((match = completeTaskRegex.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) tasks.push(content);
  }

  const lastOpen = text.lastIndexOf('<task>');
  const lastClose = text.lastIndexOf('</task>');
  let isStreaming = false;
  if (lastOpen > lastClose) {
    const incomplete = text.substring(lastOpen + 6).trim();
    if (incomplete) {
      tasks.push(incomplete);
      isStreaming = true;
    }
  }
  if (tasks.length === 0) {
    const fallback = text.trim();
    if (isDisplayableRawStreamingText(fallback)) {
      tasks.push(fallback);
      isStreaming = true;
    }
  }
  return { tasks, isStreaming };
}

/** True while the task is between user-prompt and `to_sub_tasks` arrival. */
export function isPlanSplittingPhase(task: any): boolean {
  if (!task) return false;
  const anyToSubTasks = task.messages?.find(
    (m: any) => m.step === AgentStep.TO_SUB_TASKS
  );
  return (
    (task.status !== ChatTaskStatus.FINISHED &&
      task.status !== ChatTaskStatus.RUNNING &&
      !anyToSubTasks &&
      !task.hasWaitComfirm &&
      (task.messages?.length ?? 0) > 0) ||
    (task.isTakeControl && !anyToSubTasks)
  );
}

const splittingTimerStartByTaskId = new Map<string, number>();

function getOrCreateStart(taskId: string): number {
  let start = splittingTimerStartByTaskId.get(taskId);
  if (start === undefined) {
    start = Date.now();
    splittingTimerStartByTaskId.set(taskId, start);
  }
  return start;
}

function clearStart(taskId: string) {
  splittingTimerStartByTaskId.delete(taskId);
}

function getTaskElapsedMs(task: { taskTime: number; elapsed: number }): number {
  if (task.taskTime !== 0) {
    return Math.max(0, Date.now() - task.taskTime + task.elapsed);
  }
  return Math.max(0, task.elapsed);
}

/** Live elapsed-ms during the splitting phase, ticking every 1s. */
export function useSplittingElapsedMs(
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
      if (!isPlanSplittingPhase(task)) clearStart(taskId);
    };
    sync();
    const unsubscribe = chatStore.subscribe(sync);
    return () => {
      unsubscribe();
      clearStart(taskId);
    };
  }, [chatStore, taskId]);

  if (!taskId) return 0;
  const task = chatStore.getState().tasks[taskId];
  if (!task) return 0;
  const fromTask = getTaskElapsedMs(task);
  if (fromTask > 0 || task.taskTime !== 0) return fromTask;
  return Math.max(0, now - getOrCreateStart(taskId));
}

interface WordTypingOptions {
  intervalMs?: number;
  punctuationPauseMs?: number;
}

function nextWordSlice(text: string, fromIndex: number): string {
  const rest = text.slice(fromIndex);
  if (!rest) return '';
  const match = rest.match(/^(\s*\S+\s*)/);
  return match?.[0] || rest.charAt(0);
}

/**
 * Trails a source string with a paced word-by-word display buffer. This keeps
 * large backend chunks from appearing all at once while still catching up to
 * incremental streaming responses.
 */
export function useWordTypingBuffer(
  sourceText: string,
  options: WordTypingOptions = {}
): string {
  const { intervalMs = 45, punctuationPauseMs = 140 } = options;
  const [displayText, setDisplayText] = useState('');

  const source = sourceText || '';

  useEffect(() => {
    if (!source) {
      setDisplayText('');
      return;
    }

    setDisplayText((current) => {
      if (source.startsWith(current)) return current;
      return '';
    });
  }, [source]);

  const delay = useMemo(() => {
    if (!displayText) return intervalMs;
    return /[.!?。！？]\s*$/.test(displayText)
      ? punctuationPauseMs
      : intervalMs;
  }, [displayText, intervalMs, punctuationPauseMs]);

  useEffect(() => {
    if (!source || displayText.length >= source.length) return;
    if (!source.startsWith(displayText)) return;

    const id = window.setTimeout(() => {
      setDisplayText((current) => {
        if (!source.startsWith(current)) return '';
        if (current.length >= source.length) return current;
        return current + nextWordSlice(source, current.length);
      });
    }, delay);

    return () => window.clearTimeout(id);
  }, [source, displayText, delay]);

  return displayText;
}

export const planBlurFadeMotion = {
  initial: { opacity: 0, filter: 'blur(8px)', y: 6 },
  animate: { opacity: 1, filter: 'blur(0px)', y: 0 },
  exit: { opacity: 0, filter: 'blur(10px)', y: 4 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
} as const;

export const planOverlayScaleMotion = {
  initial: { opacity: 0, filter: 'blur(12px)', y: 8, scale: 0.8 },
  animate: { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1 },
  exit: { opacity: 0, filter: 'blur(12px)', y: 8, scale: 0.8 },
  transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
} as const;
