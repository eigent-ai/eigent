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
} from '@/components/PageSidebar/ProjectNavListRows';

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
    <div className="pb-4 mx-auto flex min-h-full w-full max-w-[600px] flex-col">
      <div className="mb-3 min-w-0 gap-2 px-3 text-ds-text-neutral-muted-default flex w-full items-center justify-between">
        <h2 className="min-w-0 text-body-sm font-semibold text-left">
          {t('layout.workspace-recent-sessions-heading')}
        </h2>
        <button
          type="button"
          onClick={onOpenAllProjects}
          className="group gap-0.5 text-body-sm font-medium text-ds-text-neutral-muted-default focus-visible:rounded focus-visible:ring-ds-ring-neutral-default-focus inline-flex shrink-0 items-center transition-colors outline-none hover:underline focus-visible:ring-2"
        >
          {t('layout.all', { defaultValue: 'All' })}
          <span
            className="max-w-0 ease-out group-hover:max-w-4 inline-flex overflow-hidden transition-[max-width] duration-200"
            aria-hidden
          >
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </span>
        </button>
      </div>
      <div className="m-0 min-h-0 gap-0.5 p-0 flex w-full flex-col">
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
