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

import {
  NavList,
  type NavListSession,
} from '@/components/ProjectPageSidebar/NavList';
import { Button } from '@/components/ui/button';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import type { WebProject } from '@web/types';
import { formatDistanceToNow } from 'date-fns';
import {
  CircleCheckBig,
  FolderOpen,
  LoaderCircle,
  MessageCircle,
} from 'lucide-react';
import { useMemo } from 'react';

function getProjectNavLead(project: WebProject): SessionNavLeadPresentation {
  if (project.ongoingCount > 0) {
    return {
      kind: 'running',
      Icon: LoaderCircle,
      iconClassName: '!text-ds-icon-information-default-default',
      spin: true,
    };
  }
  if (project.completedCount > 0) {
    return {
      kind: 'finished',
      Icon: CircleCheckBig,
      iconClassName: '!text-ds-icon-status-completed-default-default',
    };
  }
  return {
    kind: 'idle',
    Icon: MessageCircle,
    iconClassName: '!text-ds-icon-neutral-default-default',
  };
}

function toNavListSession(project: WebProject): NavListSession {
  return {
    id: project.projectId,
    title: project.name,
    sessionLead: getProjectNavLead(project),
    trailing: formatDistanceToNow(new Date(project.latestActivity), {
      addSuffix: false,
    }),
  };
}

export function ProjectList({
  projects,
  loading,
  error,
  activeProjectId,
  onSelectProject,
  onCreate,
  showNewSession = true,
  searchQuery = '',
  hasUnfilteredProjects = false,
}: {
  projects: WebProject[];
  loading: boolean;
  error: string | null;
  activeProjectId?: string;
  onSelectProject: (projectId: string) => void;
  onCreate: () => void;
  showNewSession?: boolean;
  searchQuery?: string;
  hasUnfilteredProjects?: boolean;
}) {
  const sessions = useMemo(() => projects.map(toNavListSession), [projects]);

  if (loading) {
    return (
      <div className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-subtle-default p-8 text-ds-text-neutral-muted-default border text-center">
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
    const trimmedSearch = searchQuery.trim();
    if (hasUnfilteredProjects && trimmedSearch) {
      return (
        <div className="px-2 py-8 text-ds-text-neutral-muted-default text-center">
          No projects match &ldquo;{trimmedSearch}&rdquo;.
        </div>
      );
    }

    return (
      <div className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-subtle-default p-10 border border-dashed text-center">
        <FolderOpen className="mb-3 h-10 w-10 text-ds-icon-neutral-muted-default mx-auto" />
        <p className="mb-4 text-ds-text-neutral-muted-default">
          No projects yet. Create a task to get started.
        </p>
        <Button
          variant="primary"
          size="md"
          buttonContent="text"
          onClick={onCreate}
        >
          New task
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex flex-1 flex-col">
      <NavList
        sessions={sessions}
        activeSessionId={activeProjectId ?? null}
        onSessionClick={onSelectProject}
        onNewSession={onCreate}
        folded={false}
        panelListHover
        showRowMenu={false}
        showNewSession={showNewSession}
        className="min-h-0 flex-1"
      />
    </div>
  );
}
