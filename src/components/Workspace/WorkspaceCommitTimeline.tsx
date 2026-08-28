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

import type {
  WorkspaceGitCommit,
  WorkspaceGitOperation,
} from '@/service/workspaceGitApi';
import { Bot, Upload, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type WorkspaceCommitKind =
  'save_point' | 'merge' | 'checkpoint' | 'commit';

export const classifyWorkspaceCommit = (
  commit: Pick<WorkspaceGitCommit, 'parent_oids' | 'subject'> &
    Partial<Pick<WorkspaceGitCommit, 'kind'>>
): WorkspaceCommitKind => {
  if (commit.kind) return commit.kind;
  if (commit.parent_oids.length > 1 || commit.subject.startsWith('Merge ')) {
    return 'merge';
  }
  if (commit.subject.startsWith('Checkpoint ')) return 'checkpoint';
  if (commit.subject === 'Save progress') return 'save_point';
  return 'commit';
};

const formatDate = (seconds: number) =>
  seconds > 0 ? new Date(seconds * 1000).toLocaleString() : '—';

export type WorkspaceTimelineEvent =
  | {
      type: 'commit';
      id: string;
      occurredAt: number;
      commit: WorkspaceGitCommit;
    }
  | {
      type: 'operation';
      id: string;
      occurredAt: number;
      operation: WorkspaceGitOperation;
    };

export const buildWorkspaceTimelineEvents = (
  commits: WorkspaceGitCommit[],
  operations: WorkspaceGitOperation[]
): WorkspaceTimelineEvent[] =>
  [
    ...commits.map((commit): WorkspaceTimelineEvent => ({
      type: 'commit',
      id: `commit:${commit.oid}`,
      occurredAt: commit.committed_at,
      commit,
    })),
    ...operations.map((operation): WorkspaceTimelineEvent => ({
      type: 'operation',
      id: `operation:${operation.operation_id}`,
      occurredAt: operation.occurred_at,
      operation,
    })),
  ].sort((left, right) => right.occurredAt - left.occurredAt);

export const resolveWorkspaceCommitInitiator = (
  initiatedBy: WorkspaceGitCommit['initiated_by'] | undefined
) => (initiatedBy === 'user' ? 'user' : 'agent');

export function WorkspaceCommitTimeline({
  events,
}: {
  events: WorkspaceTimelineEvent[];
}) {
  const { t } = useTranslation();

  return (
    <ol className="overflow-hidden rounded-xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-default-default px-4">
      {events.map((event, index) => {
        const commit = event.type === 'commit' ? event.commit : null;
        const operation = event.type === 'operation' ? event.operation : null;
        const initiatedBy = commit
          ? resolveWorkspaceCommitInitiator(commit.initiated_by)
          : 'user';
        const userInitiated = initiatedBy === 'user';
        const kind = commit ? classifyWorkspaceCommit(commit) : 'commit';
        const isPush = operation?.kind === 'push';
        const kindLabel = isPush
          ? t('layout.workspace-operation-push', {
              defaultValue: 'Push',
            })
          : kind === 'save_point'
            ? t('layout.workspace-commit-save-point', {
                defaultValue: 'Save point',
              })
            : kind === 'merge'
              ? t('layout.workspace-commit-merge', {
                  defaultValue: 'Merge commit',
                })
              : kind === 'checkpoint'
                ? t('layout.workspace-commit-checkpoint', {
                    defaultValue: 'Checkpoint',
                  })
                : t('layout.workspace-commit-commit', {
                    defaultValue: 'Commit',
                  });

        return (
          <li key={event.id} className="relative flex min-w-0 gap-3 py-3">
            <div
              className="relative flex w-6 shrink-0 justify-center"
              aria-hidden
            >
              {index > 0 ? (
                <span className="absolute -top-3 bottom-1/2 left-1/2 w-px -translate-x-1/2 bg-ds-border-neutral-default-default" />
              ) : null}
              {index < events.length - 1 ? (
                <span className="absolute top-1/2 -bottom-3 left-1/2 w-px -translate-x-1/2 bg-ds-border-neutral-default-default" />
              ) : null}
              <span
                className={
                  userInitiated
                    ? 'relative z-10 mt-0.5 flex size-5 items-center justify-center rounded-full border border-x border-y border-ds-border-success-default-default bg-ds-bg-success-subtle-default'
                    : 'relative z-10 mt-0.5 flex size-5 items-center justify-center rounded-full border border-x border-y border-ds-border-information-default-default bg-ds-bg-information-subtle-default'
                }
              >
                <span
                  className={
                    userInitiated
                      ? 'size-2 rounded-full bg-ds-bg-success-default-default'
                      : 'size-2 rounded-full bg-ds-bg-information-default-default'
                  }
                />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  className={
                    isPush || kind === 'merge'
                      ? 'rounded-full bg-ds-bg-information-subtle-default px-2 py-0.5 text-ds-text-meta text-ds-text-information-strong-default'
                      : kind === 'save_point'
                        ? 'rounded-full bg-ds-bg-success-subtle-default px-2 py-0.5 text-ds-text-meta text-ds-text-success-strong-default'
                        : 'rounded-full bg-ds-neutral-strong-default px-2 py-0.5 text-ds-text-meta'
                  }
                >
                  {kindLabel}
                </span>
                <span
                  className={
                    userInitiated
                      ? 'inline-flex items-center gap-1 rounded-full bg-ds-bg-success-subtle-default px-2 py-0.5 text-ds-text-meta text-ds-text-success-strong-default'
                      : 'inline-flex items-center gap-1 rounded-full bg-ds-neutral-strong-default px-2 py-0.5 text-ds-text-meta'
                  }
                >
                  {userInitiated ? (
                    <UserRound className="size-3" aria-hidden />
                  ) : (
                    <Bot className="size-3" aria-hidden />
                  )}
                  {userInitiated
                    ? t('layout.workspace-user-initiated', {
                        defaultValue: 'User initiated',
                      })
                    : t('layout.workspace-agent-generated', {
                        defaultValue: 'Agent generated',
                      })}
                </span>
                {commit && commit.parent_oids.length > 1 ? (
                  <span className="text-ds-text-meta text-ds-ink-muted-default">
                    {t('layout.workspace-commit-parent-count', {
                      count: commit.parent_oids.length,
                      defaultValue_one: '{{count}} parent',
                      defaultValue_other: '{{count}} parents',
                    })}
                  </span>
                ) : null}
                {(commit?.oid || operation?.head_oid) && (
                  <code className="ml-auto rounded-md border border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default px-2 py-0.5 text-ds-text-meta text-ds-ink-muted-default">
                    {(commit?.oid || operation?.head_oid || '').slice(0, 8)}
                  </code>
                )}
              </div>
              <span className="mt-1.5 block text-ds-text-base font-semibold break-words">
                {commit ? (
                  commit.subject
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Upload className="size-4" aria-hidden />
                    {operation?.remote_name
                      ? t('layout.workspace-pushed-to-remote', {
                          remote: operation.remote_name,
                          defaultValue: 'Pushed commits to {{remote}}',
                        })
                      : t('layout.workspace-pushed-commits', {
                          defaultValue: 'Pushed commits to remote',
                        })}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-ds-text-meta text-ds-ink-muted-default">
                {commit
                  ? `${t('layout.workspace-git-author', {
                      defaultValue: 'Git author',
                    })}: ${commit.author} · ${formatDate(commit.committed_at)}`
                  : `${t('layout.workspace-user-action', {
                      defaultValue: 'User action',
                    })} · ${formatDate(operation?.occurred_at ?? 0)}`}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
