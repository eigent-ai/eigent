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

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WebProject } from '@web/types';
import { formatDistanceToNow } from 'date-fns';
import { ChevronRight, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

function statusLabel(project: WebProject): string {
  if (project.ongoingCount > 0) return 'Running';
  if (project.sessionCount === 0) return 'Empty';
  return 'Idle';
}

export function ProjectList({
  projects,
  loading,
  error,
  onCreate,
}: {
  projects: WebProject[];
  loading: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-8 text-ds-text-neutral-muted-default border text-center">
        Loading projects…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border-ds-border-error-subtle-default bg-ds-bg-error-subtle-default p-8 text-ds-text-error-default-default border text-center">
        {error}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-10 border border-dashed text-center">
        <FolderOpen className="mb-3 h-10 w-10 text-ds-icon-neutral-muted-default mx-auto" />
        <p className="mb-4 text-ds-text-neutral-muted-default">
          No projects yet. Create one to start remote control.
        </p>
        <Button onClick={onCreate}>Create project</Button>
      </div>
    );
  }

  return (
    <div className="gap-3 md:grid-cols-2 xl:grid-cols-3 grid">
      {projects.map((project) => (
        <Link
          key={project.projectId}
          to={`/projects/${project.projectId}`}
          className="group rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 hover:shadow-md border transition-shadow"
        >
          <div className="mb-2 gap-2 flex items-start justify-between">
            <div>
              <h3 className="text-heading-sm font-semibold text-ds-text-neutral-default-default">
                {project.name}
              </h3>
              <p className="text-body-sm text-ds-text-neutral-muted-default line-clamp-2">
                {project.lastPrompt || 'No recent activity'}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-ds-icon-neutral-muted-default group-hover:translate-x-0.5 shrink-0 transition-transform" />
          </div>
          <div className="gap-2 text-body-sm flex flex-wrap items-center">
            <span
              className={cn(
                'px-2 py-0.5 rounded-full',
                project.ongoingCount > 0
                  ? 'bg-ds-bg-status-running-subtle-default text-ds-text-status-running-default-default'
                  : 'bg-ds-bg-neutral-subtle-default text-ds-text-neutral-muted-default'
              )}
            >
              {statusLabel(project)}
            </span>
            <span className="text-ds-text-neutral-muted-default">
              {project.sessionCount} sessions
            </span>
            <span className="text-ds-text-neutral-muted-default">
              {project.totalTokens.toLocaleString()} tokens
            </span>
          </div>
          <div className="mt-3 text-body-sm text-ds-text-neutral-muted-default">
            {formatDistanceToNow(new Date(project.latestActivity), {
              addSuffix: true,
            })}
          </div>
        </Link>
      ))}
    </div>
  );
}
