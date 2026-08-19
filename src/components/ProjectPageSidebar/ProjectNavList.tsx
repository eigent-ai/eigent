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

import { NavTab, SidebarScrollArea } from '@/components/Layout/AppSidebar';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ProjectNavListRows, type ProjectNavItem } from './ProjectNavListRows';
import { SidebarAccordionSection } from './SidebarAccordionSection';

export {
  NAV_LIST_PROJECTS_RECENT_MAX,
  NAV_LIST_SESSIONS_RECENT_MAX,
  NavListSessionRows,
  ProjectNavListRows,
  type NavListSession,
  type ProjectNavItem,
} from './ProjectNavListRows';

export interface ProjectNavListProps {
  projects: ProjectNavItem[];
  activeProjectId?: string | null;
  onProjectClick?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onAchieveProject?: (projectId: string) => void;
  onPinProject?: (projectId: string) => void;
  onNewProject: () => void;
  /** Selected state for the New Project row. */
  newProjectActive?: boolean;
  className?: string;
}

/** New Project row, optional Pinned section, and Projects section. */
export function ProjectNavList({
  projects,
  activeProjectId,
  onProjectClick,
  onDeleteProject,
  onAchieveProject,
  onPinProject,
  onNewProject,
  newProjectActive = false,
  className,
}: ProjectNavListProps) {
  const { t } = useTranslation();

  const newProjectLabel = t('layout.new');
  const pinnedLabel = t('layout.pinned', { defaultValue: 'Pinned' });
  const projectsLabel = t('layout.projects', { defaultValue: 'Projects' });

  const pinnedProjects = projects.filter((p) => p.pinned);
  const unpinnedProjects = projects.filter((p) => !p.pinned);
  const hasPinned = pinnedProjects.length > 0;
  const hasUnpinned = unpinnedProjects.length > 0;

  const sharedRowProps = {
    activeProjectId,
    onProjectClick,
    onDeleteProject,
    onAchieveProject,
    onPinProject,
    folded: false as const,
  };

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-col overflow-hidden',
        className
      )}
    >
      {/* + New */}
      <div className="flex w-full min-w-0 flex-col">
        <NavTab
          active={newProjectActive}
          onClick={onNewProject}
          leading={<Plus className="h-4 w-4 shrink-0" aria-hidden />}
          label={newProjectLabel}
          ariaLabel={newProjectLabel}
          ariaCurrentPage={newProjectActive}
        />
      </div>

      {/* Scrollable section list */}
      <SidebarScrollArea className="m-0 mt-1 p-0 pb-1">
        {hasPinned && (
          <SidebarAccordionSection label={pinnedLabel}>
            <ProjectNavListRows {...sharedRowProps} projects={pinnedProjects} />
          </SidebarAccordionSection>
        )}
        {hasUnpinned && (
          <SidebarAccordionSection label={projectsLabel}>
            <ProjectNavListRows
              {...sharedRowProps}
              projects={unpinnedProjects}
            />
          </SidebarAccordionSection>
        )}
      </SidebarScrollArea>
    </div>
  );
}

export interface NavListProps {
  sessions: ProjectNavItem[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onNewSession: () => void;
  newSessionActive?: boolean;
  className?: string;
}

export function NavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  onNewSession,
  newSessionActive,
  ...rest
}: NavListProps) {
  return (
    <ProjectNavList
      projects={sessions}
      activeProjectId={activeSessionId}
      onProjectClick={onSessionClick}
      onDeleteProject={onDeleteSession}
      onNewProject={onNewSession}
      newProjectActive={newSessionActive}
      {...rest}
    />
  );
}
