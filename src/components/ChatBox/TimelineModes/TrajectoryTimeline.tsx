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

import { ToolInputOutputDetails } from '@/components/ChatBox/MessageItem/ToolInputOutputDetails';
import { MarkDown } from '@/components/WorkFlow/MarkDown';
import type {
  TimelineRunView,
  TimelineToolInvocation,
  TimelineTraceRow,
} from '@/lib/projector/chat/presentation';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { ChevronRight, FileText } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { normalizeRunReviewPath } from './RunFiles';
import { statusIcon, statusLabel, type TimelineModeProps } from './shared';

type NodeTraceRow = Extract<TimelineTraceRow, { kind: 'node' }>;
type TraceCategory =
  | 'USER'
  | 'CONTEXT'
  | 'ASSISTANT'
  | 'AGENT'
  | 'TOOL'
  | 'INPUT REQUIRED'
  | 'FILE';

function categoryTone(category: TraceCategory): string {
  switch (category) {
    case 'USER':
      return 'bg-ds-category-blue-background-default text-ds-category-blue-text-strong';
    case 'CONTEXT':
      return 'bg-ds-category-slate-background-default text-ds-category-slate-text-strong';
    case 'ASSISTANT':
      return 'bg-ds-category-indigo-background-default text-ds-category-indigo-text-strong';
    case 'AGENT':
      return 'bg-ds-category-purple-background-default text-ds-category-purple-text-strong';
    case 'TOOL':
      return 'bg-ds-category-teal-background-default text-ds-category-teal-text-strong';
    case 'INPUT REQUIRED':
      return 'bg-ds-category-amber-background-default text-ds-category-amber-text-strong';
    case 'FILE':
      return 'bg-ds-category-green-background-default text-ds-category-green-text-strong';
  }
}

interface DetailedStatusTone {
  iconClassName: string;
  labelClassName: string;
}

function detailedStatusTone(status: string): DetailedStatusTone {
  if (
    status === 'completed' ||
    status === 'complete' ||
    status === 'responded'
  ) {
    return {
      iconClassName: '!text-ds-text-status-completed-default-default',
      labelClassName: 'text-ds-text-status-completed-default-default',
    };
  }
  if (status === 'running') {
    return {
      iconClassName: '!text-ds-text-status-running-default-default',
      labelClassName: 'text-ds-text-status-running-default-default',
    };
  }
  if (
    status === 'failed' ||
    status === 'error' ||
    status === 'outcome_unknown'
  ) {
    return {
      iconClassName: '!text-ds-text-status-error-default-default',
      labelClassName: 'text-ds-text-status-error-default-default',
    };
  }
  if (
    status === 'pending' ||
    status === 'requested' ||
    status === 'waiting_for_user' ||
    status === 'timed_out' ||
    status === 'interrupted' ||
    status === 'expired' ||
    status === 'alert' ||
    status === 'input_required'
  ) {
    return {
      iconClassName: '!text-ds-text-status-pending-default-default',
      labelClassName: 'text-ds-text-status-pending-default-default',
    };
  }
  if (status === 'cancelling' || status === 'cancelled') {
    return {
      iconClassName: '!text-ds-text-status-cancelled-default-default',
      labelClassName: 'text-ds-text-status-cancelled-default-default',
    };
  }
  return {
    iconClassName: '!text-ds-text-neutral-muted-default',
    labelClassName: 'text-ds-text-neutral-muted-default',
  };
}

function DetailedStatusInline({
  status,
  paused = false,
}: {
  status: string;
  paused?: boolean;
}) {
  const Icon = statusIcon(status);
  const tone = detailedStatusTone(status);
  // A paused Run has stopped making progress, so its spinner stops too.
  const animated = !paused && (status === 'running' || status === 'cancelling');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 !text-label-xs font-normal capitalize',
        tone.labelClassName
      )}
      data-detailed-status={status}
    >
      <Icon
        aria-hidden
        className={cn('size-3', tone.iconClassName, animated && 'animate-spin')}
      />
      <span className={tone.labelClassName}>{statusLabel(status)}</span>
    </span>
  );
}

function TraceRow({
  category,
  summary,
  status,
  children,
  autoExpanded = false,
  ariaLabel,
  interactionId,
  interactionRequestEventId,
  interactionResolutionEventId,
  role,
  rowId,
}: {
  category: TraceCategory;
  summary: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  autoExpanded?: boolean;
  ariaLabel?: string;
  interactionId?: string;
  interactionRequestEventId?: string;
  interactionResolutionEventId?: string;
  role?: 'user' | 'assistant';
  rowId: string;
}) {
  const [open, setOpen] = useState(autoExpanded);
  const wasAutoExpanded = useRef(autoExpanded);
  const detailsId = `trace-details-${rowId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  useEffect(() => {
    if (autoExpanded) {
      setOpen(true);
    } else if (wasAutoExpanded.current) {
      setOpen(false);
    }
    wasAutoExpanded.current = autoExpanded;
  }, [autoExpanded]);

  return (
    <li
      aria-label={ariaLabel}
      className="min-w-0 border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default last:border-b-0 hover:bg-ds-bg-neutral-default-default"
      data-detailed-trace-row={rowId}
      data-event-node-id={rowId}
      data-expanded={open ? 'true' : 'false'}
      data-interaction-id={interactionId}
      data-interaction-request-event-id={interactionRequestEventId}
      data-interaction-resolution-event-id={interactionResolutionEventId}
      data-message-role={role}
      data-trace-category={category.toLowerCase().replaceAll(' ', '-')}
    >
      <button
        type="button"
        aria-controls={detailsId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 flex-row items-center gap-3 bg-transparent px-1 py-2.5 text-left"
      >
        <span className="flex w-28 shrink-0 justify-end" data-trace-tag-column>
          <span
            className={cn(
              'inline-flex h-6 min-w-0 max-w-full items-center justify-end rounded-md px-2 text-right !text-label-xs !font-semibold uppercase leading-none tracking-wide',
              categoryTone(category)
            )}
            data-trace-tag
          >
            <span className="truncate">
              {category === 'INPUT REQUIRED' ? 'Input required' : category}
            </span>
          </span>
        </span>
        <span
          className="min-w-0 flex-1 truncate !text-label-xs !font-normal leading-4 text-ds-text-neutral-default-default"
          data-trace-summary
        >
          {summary}
        </span>
        <span
          className="ml-auto flex shrink-0 items-center gap-2"
          data-trace-ending
        >
          {status}
          <ChevronRight
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 text-ds-icon-neutral-muted-default transition-transform duration-150 motion-reduce:transition-none',
              open && 'rotate-90'
            )}
            data-trace-chevron
          />
        </span>
      </button>
      {open ? (
        <div
          id={detailsId}
          className="flex min-w-0 flex-row gap-3 px-1 pb-2.5"
          data-trace-details
        >
          <span aria-hidden className="w-28 shrink-0" />
          <div className="min-w-0 flex-1 [&_blockquote]:!text-label-xs [&_code]:!text-label-xs [&_em]:!text-label-xs [&_h1]:!text-label-xs [&_h2]:!text-label-xs [&_h3]:!text-label-xs [&_li]:!text-label-xs [&_p]:!text-label-xs [&_pre]:!text-label-xs [&_strong]:!text-label-xs [&_td]:!text-label-xs [&_th]:!text-label-xs">
            {children}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ToolTraceDetails({
  invocation,
}: {
  invocation: TimelineToolInvocation;
}) {
  const identity = [invocation.toolkitName, invocation.methodName]
    .filter(Boolean)
    .join(' · ');
  const hasDetails = Boolean(
    identity ||
    invocation.agentName ||
    invocation.input ||
    invocation.output ||
    invocation.detail
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {identity ? (
        <span className="block truncate !text-label-xs !font-normal text-ds-text-neutral-muted-default">
          {identity}
        </span>
      ) : null}
      {invocation.agentName ? (
        <span className="block truncate !text-label-xs !font-normal text-ds-text-neutral-muted-default">
          {invocation.agentName}
        </span>
      ) : null}
      <ToolInputOutputDetails
        input={invocation.input}
        output={invocation.output}
        inputLabel="Input"
        outputLabel="Output"
      >
        {!invocation.input && !invocation.output && invocation.detail ? (
          <span className="block whitespace-pre-wrap break-words rounded-md bg-ds-bg-neutral-muted-default p-2 !text-label-xs !font-normal text-ds-text-neutral-default-default opacity-60">
            {invocation.detail}
          </span>
        ) : null}
      </ToolInputOutputDetails>
      {!hasDetails ? (
        <span className="block !text-label-xs !font-normal text-ds-text-neutral-muted-default">
          No additional details
        </span>
      ) : null}
    </div>
  );
}

function categoryForNode(row: NodeTraceRow): TraceCategory {
  const node = row.node;
  if (node.kind === 'message') {
    return node.role === 'user' ? 'USER' : 'ASSISTANT';
  }
  if (node.kind === 'interaction') return 'INPUT REQUIRED';
  if (node.kind === 'artifact') return 'FILE';
  if (node.kind === 'activity' && node.activityType === 'agent') return 'AGENT';
  if (node.kind === 'activity' && node.activityType === 'terminal') {
    return 'TOOL';
  }
  return 'CONTEXT';
}

function nodeSummary(row: NodeTraceRow): string {
  const node = row.node;
  if (node.kind === 'message') return node.content;
  if (node.kind === 'interaction') return node.prompt || 'Human input';
  if (node.kind === 'activity') {
    return node.detail ? `${node.title} · ${node.detail}` : node.title;
  }
  if (node.kind === 'notice') {
    return node.title ? `${node.title} · ${node.content}` : node.content;
  }
  if (node.kind === 'plan') return node.title || node.summary || 'Plan';
  if (node.kind === 'artifact') return node.relativePath || node.path;
  if (node.kind === 'run_status') return 'Run status';
  return 'Unsupported event';
}

function nodeStatus(row: NodeTraceRow, paused: boolean): ReactNode {
  const node = row.node;
  if (
    node.kind === 'interaction' ||
    node.kind === 'activity' ||
    node.kind === 'run_status'
  ) {
    return <DetailedStatusInline paused={paused} status={node.status} />;
  }
  if (node.kind === 'artifact') {
    return (
      <span className="shrink-0 !text-label-xs !font-medium capitalize text-ds-text-success-default-default">
        {node.operation}
      </span>
    );
  }
  return null;
}

function InteractionTraceDetails({
  node,
}: {
  node: NodeTraceRow['node'] & { kind: 'interaction' };
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {node.prompt ? (
        <div>
          <span className="block !text-label-xs !font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default">
            Question
          </span>
          <span className="mt-1 block whitespace-pre-wrap break-words !text-label-xs !font-normal text-ds-text-neutral-default-default">
            {node.prompt}
          </span>
        </div>
      ) : null}
      {node.response ? (
        <div>
          <span className="block !text-label-xs !font-medium uppercase tracking-wide text-ds-text-neutral-subtle-default">
            Answer
          </span>
          <span className="mt-1 block whitespace-pre-wrap break-words !text-label-xs !font-normal text-ds-text-neutral-default-default">
            {node.response}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function NodeTraceDetails({
  row,
  runId,
}: {
  row: NodeTraceRow;
  runId: string;
}) {
  const { t } = useTranslation();
  const openReviewPreview = usePageTabStore((state) => state.openReviewPreview);
  const node = row.node;
  if (node.kind === 'message') {
    return (
      <MarkDown
        content={node.content}
        enableTypewriter={false}
        pTextSize="!text-label-xs !font-normal text-ds-text-neutral-default-default"
      />
    );
  }
  if (node.kind === 'interaction') {
    return <InteractionTraceDetails node={node} />;
  }
  if (node.kind === 'activity') {
    return (
      <span className="block whitespace-pre-wrap break-words !text-label-xs !font-normal text-ds-text-neutral-default-default">
        {node.title}
        {node.detail ? ` · ${node.detail}` : ''}
      </span>
    );
  }
  if (node.kind === 'notice') {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        {node.title ? (
          <span className="block !text-label-xs !font-medium text-ds-text-neutral-default-default">
            {node.title}
          </span>
        ) : null}
        <span className="block whitespace-pre-wrap break-words !text-label-xs !font-normal text-ds-text-neutral-subtle-default">
          {node.content}
        </span>
      </div>
    );
  }
  if (node.kind === 'plan') {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="block !text-label-xs !font-medium text-ds-text-neutral-default-default">
          {node.title || 'Plan'}
        </span>
        {node.summary ? (
          <span className="block whitespace-pre-wrap !text-label-xs !font-normal text-ds-text-neutral-subtle-default">
            {node.summary}
          </span>
        ) : null}
        {node.tasks.map((task) => (
          <span
            key={task.id}
            className="block truncate !text-label-xs !font-normal text-ds-text-neutral-subtle-default"
          >
            {task.title} · {task.status.replaceAll('_', ' ')}
          </span>
        ))}
      </div>
    );
  }
  if (node.kind === 'artifact') {
    const reviewPath = normalizeRunReviewPath(node.relativePath);
    return (
      <button
        type="button"
        disabled={!reviewPath}
        title={reviewPath ? 'Review this change' : undefined}
        onClick={() =>
          reviewPath && openReviewPreview({ runId, path: reviewPath })
        }
        className="group flex min-w-0 items-center gap-2 border-0 bg-transparent p-0 text-left disabled:cursor-default"
      >
        <FileText
          aria-hidden
          className="size-3.5 shrink-0 text-ds-icon-neutral-subtle-default"
        />
        <span className="min-w-0 flex-1 break-all !text-label-xs !font-normal text-ds-text-neutral-default-default group-enabled:group-hover:underline">
          {node.relativePath || node.path}
        </span>
      </button>
    );
  }
  if (node.kind === 'run_status') {
    return (
      <span className="block !text-label-xs !font-normal text-ds-text-neutral-default-default">
        Run status
      </span>
    );
  }
  return (
    <span className="block !text-label-xs !font-normal text-ds-text-neutral-muted-default">
      {t('chat.timeline-unsupported-event', {
        defaultValue:
          "This part of the conversation can't be shown in this version of Eigent.",
      })}
    </span>
  );
}

function DetailedRun({
  run,
  paused,
}: {
  run: TimelineRunView;
  paused: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section data-run-id={run.runId}>
      <ol className="m-0 w-full list-none overflow-hidden rounded-xl border border-ds-border-neutral-subtle-default bg-transparent p-0">
        {run.traceRows.map((row) => {
          if (row.kind === 'tool') {
            return (
              <TraceRow
                key={row.id}
                category="TOOL"
                rowId={row.id}
                summary={row.invocation.title}
                status={
                  <DetailedStatusInline
                    paused={paused}
                    status={row.invocation.status}
                  />
                }
              >
                <ToolTraceDetails invocation={row.invocation} />
              </TraceRow>
            );
          }
          const category = categoryForNode(row);
          const role = row.node.kind === 'message' ? row.node.role : undefined;
          return (
            <TraceRow
              ariaLabel={
                row.node.kind === 'interaction'
                  ? t('chat.control-region-label')
                  : undefined
              }
              autoExpanded={
                row.node.kind === 'interaction' &&
                row.node.status === 'requested'
              }
              interactionId={
                row.node.kind === 'interaction'
                  ? row.node.interactionId
                  : undefined
              }
              interactionRequestEventId={
                row.node.kind === 'interaction'
                  ? row.node.requestEventId || row.node.eventId
                  : undefined
              }
              interactionResolutionEventId={
                row.node.kind === 'interaction'
                  ? row.node.resolutionEventId
                  : undefined
              }
              key={row.id}
              category={category}
              role={role}
              rowId={row.id}
              status={nodeStatus(row, paused)}
              summary={nodeSummary(row)}
            >
              <NodeTraceDetails row={row} runId={run.runId} />
            </TraceRow>
          );
        })}
      </ol>
    </section>
  );
}

export function TrajectoryTimeline({
  runs,
  paused = false,
}: TimelineModeProps) {
  return (
    <div className="flex w-full flex-col gap-3" data-timeline-mode="trajectory">
      {runs.map((run) => (
        <DetailedRun key={run.id} paused={paused} run={run} />
      ))}
    </div>
  );
}
