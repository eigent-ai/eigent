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
  NAV_LIST_PROJECTS_RECENT_MAX,
  ProjectNavListRows,
  type ProjectNavItem,
} from '@/components/ProjectPageSidebar/ProjectNavListRows';

import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface WorkspaceRecentSessionsProps {
  projects: ProjectNavItem[];
  activeProjectId: string | null;
  onProjectClick: (projectId: string) => void;
  onOpenAllProjects: () => void;
}

/**
 * Displays the most-recent projects from the active space — same row
 * component and data as the project sidebar nav list.
 */
export function WorkspaceRecentSessions({
  projects,
  activeProjectId,
  onProjectClick,
  onOpenAllProjects,
}: WorkspaceRecentSessionsProps) {
  const { t } = useTranslation();

  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[600px] flex-col pb-4">
      <div className="mb-3 flex w-full min-w-0 items-center justify-between gap-2 px-3 text-ds-text-neutral-muted-default">
        <h2 className="min-w-0 text-left text-body-sm font-semibold">
          {t('layout.workspace-recent-sessions-heading')}
        </h2>
        <button
          type="button"
          onClick={onOpenAllProjects}
          className="group inline-flex shrink-0 items-center gap-0.5 text-body-sm font-medium text-ds-text-neutral-muted-default outline-none transition-colors hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-default-focus"
        >
          {t('layout.all', { defaultValue: 'All' })}
          <span
            className="inline-flex max-w-0 overflow-hidden transition-[max-width] duration-200 ease-out group-hover:max-w-4"
            aria-hidden
          >
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </span>
        </button>
      </div>
      <div className="m-0 flex min-h-0 w-full flex-col gap-0.5 p-0">
        <ProjectNavListRows
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectClick={onProjectClick}
          folded={false}
          maxItems={NAV_LIST_PROJECTS_RECENT_MAX}
          panelListHover
          showRowMenu={false}
        />
      </div>
    </div>
  );
}
