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

import type {
  ChatProjectionNodeOfKind,
  EventRendererProps,
} from './rendererRegistry';
import { UnknownEventFallback } from './UnknownEventFallback';

function displayStatus(status: string): string {
  return status.replaceAll('_', ' ');
}

function artifactDisplayLabel(name: string | undefined, path: string): string {
  const candidate = (name || path).trim().replaceAll('\\', '/');
  return candidate.split('/').filter(Boolean).at(-1) || 'Artifact';
}

export function MessageEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'message'>>) {
  const isUser = node.role === 'user';

  const message = (
    <article
      aria-label={isUser ? 'User message' : 'Assistant message'}
      className={cn(
        'w-full whitespace-pre-wrap break-words rounded-xl px-4 py-3 text-body-sm text-ds-text-neutral-default-default',
        isUser
          ? 'rounded-br-sm bg-ds-bg-neutral-strong-default'
          : 'bg-ds-bg-neutral-subtle-default'
      )}
      data-message-role={node.role}
    >
      {node.content}
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
  return 'border-ds-border-information-default-default bg-ds-bg-information-subtle-default text-ds-text-information-default-default';
}

export function NoticeEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'notice'>>) {
  return (
    <aside
      className={cn(
        'w-full whitespace-pre-wrap break-words rounded-xl border px-4 py-3 text-body-sm',
        noticeTone(node.severity)
      )}
      data-notice-severity={node.severity}
      role={node.severity === 'error' ? 'alert' : 'status'}
    >
      {node.content}
    </aside>
  );
}

export function InteractionEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'interaction'>>) {
  const requestEventId =
    node.requestEventId ||
    (node.status === 'requested' ? node.eventId : undefined);

  return (
    <section
      aria-label="Agent input"
      className="rounded-xl border border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default px-4 py-3"
      data-interaction-id={node.interactionId}
      data-interaction-request-event-id={requestEventId}
      data-interaction-resolution-event-id={node.resolutionEventId}
      data-interaction-run-id={node.runId}
      data-interaction-status={node.status}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-body-sm font-semibold text-ds-text-neutral-default-default">
          Input required
        </p>
        <span className="shrink-0 text-label-xs text-ds-text-neutral-muted-default">
          {displayStatus(node.status)}
        </span>
      </div>
      {node.response && node.prompt ? (
        <div className="mt-2" data-interaction-question>
          <div className="text-label-xs font-medium text-ds-text-neutral-muted-default">
            Question
          </div>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-body-sm text-ds-text-neutral-subtle-default">
            {node.prompt}
          </p>
        </div>
      ) : null}
      {node.response ? (
        <div className="mt-2" data-interaction-answer>
          <div className="text-label-xs font-medium text-ds-text-neutral-muted-default">
            Answer
          </div>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-body-sm text-ds-text-neutral-subtle-default">
            {node.response}
          </p>
        </div>
      ) : null}
    </section>
  );
}

export function PlanEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'plan'>>) {
  const taskCount = node.tasks.length;

  return (
    <section className="rounded-xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-body-sm font-semibold text-ds-text-neutral-default-default">
          {node.title || 'Plan'}
        </p>
        <span className="shrink-0 text-label-xs text-ds-text-neutral-muted-default">
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </span>
      </div>
      {node.summary ? (
        <p className="m-0 mt-2 whitespace-pre-wrap break-words text-body-sm text-ds-text-neutral-subtle-default">
          {node.summary}
        </p>
      ) : null}
    </section>
  );
}

export function ActivityEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'activity'>>) {
  return (
    <section className="rounded-xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 min-w-0 truncate text-body-sm font-medium text-ds-text-neutral-default-default">
          {node.title}
        </p>
        <span className="shrink-0 text-label-xs text-ds-text-neutral-muted-default">
          {displayStatus(node.status)}
        </span>
      </div>
      {node.detail ? (
        <p className="m-0 mt-1 whitespace-pre-wrap break-words text-label-sm text-ds-text-neutral-subtle-default">
          {node.detail}
        </p>
      ) : null}
    </section>
  );
}

export function ArtifactEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'artifact'>>) {
  const label = artifactDisplayLabel(node.name, node.path);

  return (
    <section className="rounded-xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 min-w-0 truncate text-body-sm font-medium text-ds-text-neutral-default-default">
          {label}
        </p>
        <span className="shrink-0 text-label-xs text-ds-text-neutral-muted-default">
          {displayStatus(node.operation)}
        </span>
      </div>
    </section>
  );
}

export function RunStatusEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'run_status'>>) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 text-label-sm text-ds-text-neutral-muted-default"
      role="status"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-ds-bg-neutral-muted-default" />
      Run {displayStatus(node.status)}
    </div>
  );
}

export function UnknownEventRenderer({
  node,
}: EventRendererProps<ChatProjectionNodeOfKind<'unknown'>>) {
  return <UnknownEventFallback node={node} />;
}
