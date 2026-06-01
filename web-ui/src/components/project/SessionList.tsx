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
import type { WebProject, WebSession } from '@web/types';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';

function statusBadge(status: WebSession['status']) {
  if (status === 'ongoing') {
    return 'bg-ds-bg-status-running-subtle-default text-ds-text-status-running-default-default';
  }
  if (status === 'done') {
    return 'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-default-default';
  }
  return 'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default';
}

export function SessionList({
  project,
  activeTaskId,
}: {
  project: WebProject;
  activeTaskId?: string;
}) {
  if (project.sessions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ds-border-neutral-subtle-disabled p-4 text-body-sm text-ds-text-neutral-muted-default">
        No sessions yet. Send an instruction below to start one.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {project.sessions.map((session) => (
        <Link
          key={session.taskId}
          to={`/projects/${project.projectId}/sessions/${session.taskId}`}
          className={cn(
            'rounded-lg border px-3 py-3 transition-colors',
            activeTaskId === session.taskId
              ? 'border-ds-border-brand-subtle-default bg-ds-bg-brand-subtle-default'
              : 'border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover'
          )}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-body-sm capitalize',
                statusBadge(session.status)
              )}
            >
              {session.status}
            </span>
            <span className="text-body-sm text-ds-text-neutral-muted-default">
              {session.tokens.toLocaleString()} tokens
            </span>
          </div>
          <p className="line-clamp-2 text-body-md text-ds-text-neutral-default-default">
            {session.question}
          </p>
          {session.createdAt ? (
            <p className="mt-1 text-body-sm text-ds-text-neutral-muted-default">
              {formatDistanceToNow(new Date(session.createdAt), {
                addSuffix: true,
              })}
            </p>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
