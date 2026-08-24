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

import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock,
  FileText,
  Loader,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  ChatProjectionNodeOfKind,
  EventRendererProps,
} from './rendererRegistry';
import { UnknownEventFallback } from './UnknownEventFallback';

function displayStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

/** Status colour matches RepeatedToolCallGroup so one status reads the same everywhere. */
function statusClassName(status: string): string {
  if (status === 'failed' || status === 'outcome_unknown') {
    return 'text-ds-text-error-default-default';
  }
  if (status === 'timed_out') {
    return 'text-ds-text-warning-default-default';
  }
  if (status === 'running' || status === 'pending') {
    return 'text-ds-text-information-default-default';
  }
  if (status === 'completed') return 'text-ds-text-success-default-default';
  return 'text-ds-ink-muted-default';
}

function statusIcon(status: string): LucideIcon {
  if (status === 'failed' || status === 'outcome_unknown') return CircleAlert;
  if (status === 'timed_out') return Clock;
  if (status === 'running') return Loader;
  if (status === 'pending') return Clock;
  if (status === 'completed') return CircleCheck;
  return CircleSlash;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const Icon = statusIcon(status);

  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-ds-text-meta',
        statusClassName(status)
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      {t(`chat.tool-status-${status}`, { defaultValue: displayStatus(status) })}
    </span>
  );
}

function artifactDisplayLabel(
  name: string | undefined,
  path: string,
  fallback: string
): string {
  const candidate = (name || path).trim().replaceAll('\\', '/');
  return candidate.split('/').filter(Boolean).at(-1) || fallback;
}

export function MessageEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'message'>>) {
  const { t } = useTranslation();
  const isUser = node.role === 'user';

  const message = (
    <article
      aria-label={
        isUser
          ? t('chat.timeline-user-message')
          : t('chat.timeline-assistant-message')
      }
      className={cn(
        'w-full rounded-xl px-4 py-3 text-ds-text-base break-words whitespace-pre-wrap text-ds-ink-default-default',
        isUser
          ? 'rounded-br-sm bg-ds-neutral-strong-default'
          : 'bg-ds-neutral-subtle-default'
      )}
      data-message-role={node.role}
    >
      <span className="block">{node.content}</span>
    </article>
  );

  return isUser ? <div className="w-full pl-16">{message}</div> : message;
}

function noticeTone(severity: string): string {
  if (severity === 'error') {
    return 'border-ds-border-error-default-default bg-ds-bg-error-subtle-default text-ds-text-error-default-default';
  }
  if (severity === 'warning') {
    return 'border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default text-ds-text-warning-default-default';
  }
  if (severity === 'success') {
    return 'border-ds-border-success-default-default bg-ds-bg-success-subtle-default text-ds-text-success-default-default';
  }
  return 'border-ds-border-information-default-default bg-ds-bg-information-subtle-default text-ds-text-information-default-default';
}

export function NoticeEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'notice'>>) {
  return (
    <aside
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-ds-text-base break-words whitespace-pre-wrap',
        noticeTone(node.severity)
      )}
      data-notice-severity={node.severity}
      role={node.severity === 'error' ? 'alert' : 'status'}
    >
      {node.title ? (
        <strong className="block font-medium">{node.title}</strong>
      ) : null}
      <span className={cn('block', node.title && 'mt-1')}>{node.content}</span>
    </aside>
  );
}

export function InteractionEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'interaction'>>) {
  const { t } = useTranslation();
  const requestEventId =
    node.requestEventId ||
    (node.status === 'requested' ? node.eventId : undefined);

  return (
    <section
      aria-label={t('chat.control-region-label')}
      className="rounded-xl border border-x border-y border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default px-4 py-3"
      data-interaction-id={node.interactionId}
      data-interaction-request-event-id={requestEventId}
      data-interaction-resolution-event-id={node.resolutionEventId}
      data-interaction-run-id={node.runId}
      data-interaction-status={node.status}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="block text-ds-text-base font-semibold text-ds-ink-default-default">
          {t('chat.control-input-required')}
        </span>
        <span className="shrink-0 text-ds-text-meta text-ds-ink-muted-default">
          {t(`chat.tool-status-${node.status}`, {
            defaultValue: displayStatus(node.status),
          })}
        </span>
      </div>
      {node.response && node.prompt ? (
        <div className="mt-2" data-interaction-question>
          <span className="block text-ds-text-meta font-medium text-ds-ink-muted-default">
            {t('chat.timeline-question')}
          </span>
          <span className="mt-1 block text-ds-text-base font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
            {node.prompt}
          </span>
        </div>
      ) : null}
      {node.response ? (
        <div className="mt-2" data-interaction-answer>
          <span className="block text-ds-text-meta font-medium text-ds-ink-muted-default">
            {t('chat.timeline-answer')}
          </span>
          <span className="mt-1 block text-ds-text-base font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
            {node.response}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function PlanEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'plan'>>) {
  const { t } = useTranslation();
  const taskCount = node.tasks.length;

  return (
    <section className="rounded-xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="block text-ds-text-base font-semibold text-ds-ink-default-default">
          {node.title || t('chat.timeline-plan')}
        </span>
        <span className="shrink-0 text-ds-text-meta text-ds-ink-muted-default">
          {taskCount === 1
            ? t('chat.timeline-plan-task-count-one', { count: taskCount })
            : t('chat.timeline-plan-task-count-other', { count: taskCount })}
        </span>
      </div>
      {node.summary ? (
        <span className="mt-2 block text-ds-text-base font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
          {node.summary}
        </span>
      ) : null}
    </section>
  );
}

export function ActivityEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'activity'>>) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="block min-w-0 truncate text-ds-text-base font-medium text-ds-ink-default-default">
          {node.title}
        </span>
        <StatusBadge status={node.status} />
      </div>
      {node.detail ? (
        <span className="mt-1 block text-ds-text-base font-normal break-words whitespace-pre-wrap text-ds-ink-subtle-default">
          {node.detail}
        </span>
      ) : null}
      {node.status === 'outcome_unknown' ? (
        <span
          className="mt-2 block text-ds-text-base font-medium text-ds-text-error-default-default"
          role="alert"
        >
          {t('chat.tool-outcome-unknown-warning', {
            defaultValue:
              'Result unknown. The external action may have already happened; do not retry automatically.',
          })}
        </span>
      ) : null}
    </section>
  );
}

export function ArtifactEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'artifact'>>) {
  const { t } = useTranslation();
  const label = artifactDisplayLabel(
    node.name,
    node.path,
    t('chat.timeline-artifact')
  );

  return (
    <section className="rounded-xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-ds-text-base font-medium text-ds-ink-default-default">
          <FileText
            aria-hidden
            className="size-4 shrink-0 text-ds-ink-subtle-default"
          />
          <span className="min-w-0 truncate">{label}</span>
        </span>
        <span className="shrink-0 text-ds-text-meta text-ds-ink-muted-default">
          {displayStatus(node.operation)}
        </span>
      </div>
    </section>
  );
}

export function RunStatusEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'run_status'>>) {
  const { t } = useTranslation();
  const Icon = statusIcon(node.status);

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-ds-text-base',
        statusClassName(node.status)
      )}
      role="status"
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="block">
        {t('chat.timeline-run-status', {
          status: t(`chat.tool-status-${node.status}`, {
            defaultValue: displayStatus(node.status),
          }),
        })}
      </span>
    </div>
  );
}

export function UnknownEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'unknown'>>) {
  return <UnknownEventFallback node={node} />;
}
