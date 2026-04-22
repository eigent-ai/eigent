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
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  memo,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { formatSplittingElapsed } from './TokenUtils';

const CONTENT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1];
const HEIGHT_MOTION = {
  height: { duration: 0.22, ease: CONTENT_EASE },
  opacity: { duration: 0.16, ease: CONTENT_EASE },
} as const;
const MARKDOWN_DEFER_THRESHOLD = 1200;
const MARKDOWN_DEFER_MS = 180;

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

function toolRowTitle(toolkitName: string, method: string): string {
  return `${toolkitName} · ${titleCaseMethod(method)}`;
}

type ToolSegment = {
  type: 'tool';
  /** Stable for list keys (index in merged agent log at activation). */
  id: string;
  rowTitle: string;
  toolkitName: string;
  method: string;
  summary: string;
  detail: string;
  status: 'running' | 'done';
};

type AgentSegment = { type: 'agent'; id: string; text: string };

type LogSegment = AgentSegment | ToolSegment;

function buildLogSegments(merged: AgentMessage[]): LogSegment[] {
  const segments: LogSegment[] = [];

  for (let entryIndex = 0; entryIndex < merged.length; entryIndex++) {
    const entry = merged[entryIndex]!;
    if (entry.step === AgentStep.ACTIVATE_AGENT) {
      const text = normalizeToolkitMessage(entry.data?.message).trim();
      if (text) segments.push({ type: 'agent', id: `a-${entryIndex}`, text });
      continue;
    }

    if (entry.step === AgentStep.ACTIVATE_TOOLKIT) {
      const name = (entry.data?.toolkit_name ?? '').trim() || 'Tool';
      const method = (entry.data?.method_name ?? '').trim();
      const rawMsg = normalizeToolkitMessage(entry.data?.message).trim();

      if (name.toLowerCase() === 'notice') {
        if (rawMsg)
          segments.push({ type: 'agent', id: `a-${entryIndex}`, text: rawMsg });
        continue;
      }

      if (!method && !rawMsg) continue;

      segments.push({
        type: 'tool',
        id: `t-${entryIndex}`,
        rowTitle: toolRowTitle(name, method),
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

      // Pairs the most recent *running* segment with the same toolkit+method. If the backend
      // ever interleaves two concurrent invocations of the same tool, this could attach
      // completion to the wrong segment; a stable per-invocation id in the log would be needed.
      for (let i = segments.length - 1; i >= 0; i--) {
        const s = segments[i];
        if (s.type !== 'tool') continue;
        if (s.status !== 'running') continue;
        if (s.toolkitName !== name || s.method !== method) continue;

        s.status = 'done';
        s.detail = [s.detail, msg].filter(Boolean).join('\n\n').trim();
        s.summary = formatToolSummary(name, method, s.detail);
        s.rowTitle = toolRowTitle(name, method);
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

const ToolDetailRow = memo(function ToolDetailRow({
  rowTitle,
  detail,
}: {
  rowTitle: string;
  detail: string;
}) {
  const [open, setOpen] = useState(false);
  const [renderMarkdown, setRenderMarkdown] = useState(false);

  useEffect(() => {
    if (!open) {
      setRenderMarkdown(false);
      return;
    }

    if (detail.length <= MARKDOWN_DEFER_THRESHOLD) {
      setRenderMarkdown(true);
      return;
    }

    const timer = window.setTimeout(
      () => setRenderMarkdown(true),
      MARKDOWN_DEFER_MS
    );
    return () => window.clearTimeout(timer);
  }, [open, detail]);

  return (
    <div className="min-w-0 flex w-full flex-col items-start">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-w-0 gap-1 py-2 inline-flex max-w-full items-center self-start text-left transition-opacity hover:opacity-80"
      >
        <span className="text-body-sm font-medium min-w-0 text-ds-text-neutral-subtle-default shrink overflow-hidden text-ellipsis whitespace-nowrap">
          {rowTitle}
        </span>
        <ChevronRight
          size={16}
          aria-hidden
          className={cn(
            'text-ds-icon-neutral-subtle-default shrink-0 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="tool-detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="min-w-0 w-full overflow-hidden"
          >
            {detail ? (
              <div className="py-2 px-3 bg-ds-bg-neutral-muted-default rounded-xl w-full">
                {renderMarkdown ? (
                  <MarkDown
                    content={detail}
                    enableTypewriter={false}
                    pTextSize="text-xs"
                  />
                ) : (
                  <p className="text-label-xs text-ds-text-neutral-subtle-default m-0">
                    Rendering details...
                  </p>
                )}
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

ToolDetailRow.displayName = 'ToolDetailRow';

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
  const { t: _t } = useTranslation();
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

  const useTypewriterForAgent =
    outerOpen &&
    (status === ChatTaskStatus.FINISHED || status === ChatTaskStatus.PAUSE);

  return (
    <div className={cn('min-w-0 my-2 flex w-full flex-col', className)}>
      <button
        type="button"
        aria-expanded={outerOpen}
        onClick={() => setOuterOpen((v) => !v)}
        className="gap-1 py-2 min-w-0 flex w-full items-center justify-start text-left"
      >
        <span className="text-body-sm font-medium text-ds-text-neutral-muted-default">
          {status === ChatTaskStatus.RUNNING ||
          status === ChatTaskStatus.PAUSE ? (
            <Trans
              i18nKey="chat.working-on-tasks-for"
              values={{ time: timeLabel }}
              components={{
                elapsed: (
                  <span className="text-ds-text-neutral-subtle-default tabular-nums" />
                ),
              }}
            />
          ) : (
            <Trans
              i18nKey="chat.worked-for"
              values={{ time: timeLabel }}
              components={{
                elapsed: (
                  <span className="text-ds-text-neutral-subtle-default tabular-nums" />
                ),
              }}
            />
          )}
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

      <AnimatePresence initial={false}>
        {outerOpen ? (
          <motion.div
            key="work-log-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={HEIGHT_MOTION}
            className="overflow-hidden"
          >
            <div className="gap-3 pb-1 min-w-0 flex flex-col">
              {segments.map((seg) => {
                if (seg.type === 'agent') {
                  return (
                    <div key={seg.id} className="min-w-0">
                      {useTypewriterForAgent ? (
                        <MarkDown
                          key={`tw-${seg.id}-${outerOpen}`}
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
                    key={seg.id}
                    rowTitle={seg.rowTitle}
                    detail={seg.detail}
                  />
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
