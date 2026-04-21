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

import { MarkDown } from '@/components/WorkFlow/MarkDown';
import { cn } from '@/lib/utils';
import type { VanillaChatStore } from '@/store/chatStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { formatSplittingElapsed } from './TokenUtils';

function normalizeToolkitMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Matches `getFormattedTaskTime` / task timer fields on the chat task. */
function getTaskElapsedMs(task: { taskTime: number; elapsed: number }): number {
  if (task.taskTime !== 0) {
    return Math.max(0, Date.now() - task.taskTime + task.elapsed);
  }
  return Math.max(0, task.elapsed);
}

function mergeAgentLogs(taskAssigning: Agent[] | undefined): AgentMessage[] {
  if (!taskAssigning?.length) return [];
  return taskAssigning.flatMap((a) => a.log ?? []);
}

function titleCaseMethod(method: string): string {
  if (!method) return '';
  return method.charAt(0).toUpperCase() + method.slice(1);
}

function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatToolSummary(
  toolkitName: string,
  method: string,
  preview: string
): string {
  const p = preview.trim();
  const head = `${toolkitName} · ${titleCaseMethod(method)}`;
  return p ? `${head} — ${truncateText(p, 100)}` : head;
}

/** Collapsed row: only the toolkit · method prefix; preview after — or - stays in expanded detail. */
function summaryRowLabel(fullSummary: string): string {
  const em = fullSummary.split(' — ');
  if (em.length > 1) return em[0]!.trim();
  const spacedHyphen = fullSummary.split(' - ');
  if (spacedHyphen.length > 1) return spacedHyphen[0]!.trim();
  return fullSummary.trim();
}

type ToolSegment = {
  type: 'tool';
  toolkitName: string;
  method: string;
  summary: string;
  detail: string;
  status: 'running' | 'done';
};

type AgentSegment = { type: 'agent'; text: string };

type LogSegment = AgentSegment | ToolSegment;

function buildLogSegments(merged: AgentMessage[]): LogSegment[] {
  const segments: LogSegment[] = [];

  for (const entry of merged) {
    if (entry.step === AgentStep.ACTIVATE_AGENT) {
      const text = normalizeToolkitMessage(entry.data?.message).trim();
      if (text) segments.push({ type: 'agent', text });
      continue;
    }

    if (entry.step === AgentStep.ACTIVATE_TOOLKIT) {
      const name = (entry.data?.toolkit_name ?? '').trim() || 'Tool';
      const method = (entry.data?.method_name ?? '').trim();
      const rawMsg = normalizeToolkitMessage(entry.data?.message).trim();

      if (name.toLowerCase() === 'notice') {
        if (rawMsg) segments.push({ type: 'agent', text: rawMsg });
        continue;
      }

      if (!method && !rawMsg) continue;

      segments.push({
        type: 'tool',
        toolkitName: name,
        method,
        summary: formatToolSummary(name, method, rawMsg),
        detail: rawMsg,
        status: 'running',
      });
      continue;
    }

    if (entry.step === AgentStep.DEACTIVATE_TOOLKIT) {
      const name = (entry.data?.toolkit_name ?? '').trim();
      const method = (entry.data?.method_name ?? '').trim();
      const msg = normalizeToolkitMessage(entry.data?.message).trim();

      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (s.type !== 'tool') continue;
        if (s.status !== 'running') continue;
        if (s.toolkitName !== name || s.method !== method) continue;

        s.status = 'done';
        s.detail = [s.detail, msg].filter(Boolean).join('\n\n').trim();
        s.summary = formatToolSummary(name, method, s.detail);
        break;
      }
    }
  }

  return segments;
}

/**
 * Cheap digest of the task slice that affects this accordion, so any chat store
 * mutation re-renders without relying on `updateCount` (rarely bumped).
 */
function useTaskWorkStoreSnapshot(
  chatStore: VanillaChatStore,
  taskId: string | null
) {
  return useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => {
      if (!taskId) return '';
      const t = chatStore.getState().tasks[taskId];
      if (!t) return '';
      const logDigest = (t.taskAssigning ?? [])
        .map((a) => {
          const log = a.log ?? [];
          const last = log[log.length - 1];
          const msg = last?.data?.message;
          const msgLen =
            typeof msg === 'string'
              ? msg.length
              : msg != null
                ? JSON.stringify(msg).length
                : 0;
          return `${log.length}:${last?.step ?? ''}:${msgLen}:${last?.data?.toolkit_name ?? ''}:${last?.data?.method_name ?? ''}`;
        })
        .join('>');
      return `${t.status}|${t.taskTime}|${t.elapsed}|${logDigest}`;
    },
    () => ''
  );
}

function useTaskWorkLogData(
  chatStore: VanillaChatStore,
  taskId: string | null,
  _snapshot: string
) {
  return useMemo(() => {
    if (!taskId) {
      return { task: undefined, segments: [] as LogSegment[] };
    }
    const t = chatStore.getState().tasks[taskId];
    const merged = mergeAgentLogs(t?.taskAssigning);
    const segments = buildLogSegments(merged);
    return { task: t, segments };
  }, [chatStore, taskId, _snapshot]);
}

function useWorkLogElapsedMs(
  chatStore: VanillaChatStore,
  taskId: string | null,
  snapshot: string
): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = taskId ? chatStore.getState().tasks[taskId] : null;
    if (t?.status !== ChatTaskStatus.RUNNING) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [chatStore, taskId, snapshot]);

  return useMemo(() => {
    if (!taskId) return 0;
    const t = chatStore.getState().tasks[taskId];
    if (!t) return 0;
    return getTaskElapsedMs(t);
  }, [chatStore, taskId, snapshot, now]);
}

function ToolDetailRow({
  summary,
  detail,
}: {
  summary: string;
  detail: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-w-0 flex w-full flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-w-0 gap-1 py-2 px-2 inline-flex max-w-full items-center self-start text-left transition-opacity hover:opacity-80"
      >
        <span className="text-body-sm font-medium min-w-0 text-ds-text-neutral-muted-default shrink overflow-hidden text-ellipsis whitespace-nowrap">
          {summaryRowLabel(summary)}
        </span>
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            'text-ds-icon-neutral-muted-default shrink-0 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      </button>
      <div
        className={cn(
          'min-w-0 ease-in-out mx-2 w-full overflow-hidden transition-all duration-200',
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {detail ? (
          <div className="pb-2 pl-0 pr-0 pt-0">
            <MarkDown
              content={detail}
              enableTypewriter={false}
              pTextSize="text-xs"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface TaskWorkLogAccordionProps {
  chatStore: VanillaChatStore;
  taskId: string | null;
  className?: string;
}

export function TaskWorkLogAccordion({
  chatStore,
  taskId,
  className,
}: TaskWorkLogAccordionProps) {
  const { t } = useTranslation();
  const snapshot = useTaskWorkStoreSnapshot(chatStore, taskId);
  const { task, segments } = useTaskWorkLogData(chatStore, taskId, snapshot);
  const status = task?.status;
  const elapsedMs = useWorkLogElapsedMs(chatStore, taskId, snapshot);

  const [outerOpen, setOuterOpen] = useState(
    () => status === ChatTaskStatus.RUNNING
  );

  useEffect(() => {
    if (status === ChatTaskStatus.FINISHED) {
      setOuterOpen(false);
    } else if (status === ChatTaskStatus.RUNNING) {
      setOuterOpen(true);
    }
  }, [status]);

  if (!taskId || !task) return null;

  const allowed =
    status === ChatTaskStatus.RUNNING ||
    status === ChatTaskStatus.FINISHED ||
    status === ChatTaskStatus.PAUSE;

  if (!allowed) return null;

  if (status !== ChatTaskStatus.RUNNING && segments.length === 0) {
    return null;
  }

  const timeLabel = formatSplittingElapsed(elapsedMs);
  const headerRunning = t('chat.working-on-tasks-for', { time: timeLabel });
  const headerDone = t('chat.worked-for', { time: timeLabel });
  const headerText =
    status === ChatTaskStatus.RUNNING || status === ChatTaskStatus.PAUSE
      ? headerRunning
      : headerDone;

  const useTypewriterForAgent =
    outerOpen &&
    (status === ChatTaskStatus.FINISHED || status === ChatTaskStatus.PAUSE);

  return (
    <div className={cn('min-w-0 my-2 flex w-full flex-col', className)}>
      <button
        type="button"
        aria-expanded={outerOpen}
        onClick={() => setOuterOpen((v) => !v)}
        className="gap-1 py-2 px-2 min-w-0 flex w-full items-center justify-start text-left"
      >
        <span className="text-body-sm font-medium text-ds-text-neutral-muted-default tabular-nums">
          {headerText}
        </span>
        {outerOpen ? (
          <ChevronDown
            size={16}
            strokeWidth={2}
            aria-hidden
            className="text-ds-icon-neutral-muted-default shrink-0"
          />
        ) : (
          <ChevronRight
            size={16}
            strokeWidth={2}
            aria-hidden
            className="text-ds-icon-neutral-muted-default shrink-0"
          />
        )}
      </button>

      <div
        className={cn(
          'ease-in-out overflow-hidden transition-all duration-200',
          outerOpen ? 'max-h-[8000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="gap-3 pb-1 min-w-0 flex flex-col">
          {segments.map((seg, index) => {
            if (seg.type === 'agent') {
              return (
                <div
                  key={`agent-${index}-${seg.text.slice(0, 24)}`}
                  className="min-w-0"
                >
                  {useTypewriterForAgent ? (
                    <MarkDown
                      key={`tw-${index}-${outerOpen}`}
                      content={seg.text}
                      enableTypewriter
                      speed={12}
                      pTextSize="text-sm"
                    />
                  ) : (
                    <p className="text-body-sm font-medium m-0 leading-snug text-ds-text-neutral-default-default break-words whitespace-pre-wrap">
                      {seg.text}
                    </p>
                  )}
                </div>
              );
            }

            return (
              <ToolDetailRow
                key={`tool-${index}-${seg.toolkitName}-${seg.method}`}
                summary={seg.summary}
                detail={seg.detail}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
