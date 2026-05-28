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
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavTab } from './NavTab';
import { ProjectNavListRows, type ProjectNavItem } from './ProjectNavListRows';

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
  onNewProject: () => void;
  /** Selected state for the New Project row. */
  newProjectActive?: boolean;
  /** Icon-only rail: match other sidebar `NavTab`s. */
  folded: boolean;
  className?: string;
}

/** New Project row and a flat scrollable Project column. */
export function ProjectNavList({
  projects,
  activeProjectId,
  onProjectClick,
  onDeleteProject,
  onAchieveProject,
  onNewProject,
  newProjectActive = false,
  folded,
  className,
}: ProjectNavListProps) {
  const { t } = useTranslation();
  const projectListRef = useRef<HTMLDivElement>(null);
  const [projectListOverflow, setProjectListOverflow] = useState(false);

  useEffect(() => {
    const el = projectListRef.current;
    if (!el) return;

    const checkOverflow = () => {
      setProjectListOverflow(el.scrollHeight > el.clientHeight + 1);
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));

    return () => observer.disconnect();
  }, [projects, folded]);

  const newProjectLabel = t('layout.new-project');

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-col overflow-hidden',
        className
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        <NavTab
          active={newProjectActive}
          onClick={onNewProject}
          leading={<Plus className="h-4 w-4 shrink-0" aria-hidden />}
          label={newProjectLabel}
          tooltip={newProjectLabel}
          tooltipEnabledWhenCollapsed={!folded}
          folded={folded}
          ariaLabel={newProjectLabel}
          ariaCurrentPage={newProjectActive}
        />
      </div>

      <div
        ref={projectListRef}
        className={cn(
          'm-0 mt-1 flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 p-0 pb-1',
          folded
            ? projectListOverflow
              ? 'scrollbar-hide overflow-y-auto'
              : 'overflow-hidden'
            : projectListOverflow
              ? 'scrollbar overflow-y-auto'
              : 'overflow-hidden'
        )}
      >
        <ProjectNavListRows
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectClick={onProjectClick}
          onDeleteProject={onDeleteProject}
          onAchieveProject={onAchieveProject}
          folded={folded}
        />
      </div>
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
  folded: boolean;
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
