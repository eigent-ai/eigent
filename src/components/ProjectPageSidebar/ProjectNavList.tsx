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
import { motion } from 'framer-motion';
import { ChevronDown, Plus } from 'lucide-react';
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
  onPinProject?: (projectId: string) => void;
  onNewProject: () => void;
  /** Selected state for the New Project row. */
  newProjectActive?: boolean;
  /** Icon-only rail: match other sidebar `NavTab`s. */
  folded: boolean;
  className?: string;
}

/**
 * Collapsible section with a label header.
 * Chevron is always visible when collapsed; only visible on hover when expanded.
 */
function AccordionSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mt-3 flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'group/section-header gap-1 rounded-lg px-3 py-0.5 flex w-full items-center text-left'
        )}
        aria-expanded={expanded}
      >
        <span className="text-label-sm font-normal text-ds-text-neutral-subtle-default">
          {label}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 !text-ds-icon-neutral-muted-default shrink-0 transition-all duration-200',
            !expanded && '-rotate-90',
            expanded && 'opacity-0 group-hover/section-header:opacity-100'
          )}
          aria-hidden
        />
      </button>

      <motion.div
        initial={false}
        animate={{ height: expanded ? 'auto' : 0 }}
        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
        style={{ overflow: 'hidden' }}
      >
        <div className="gap-0.5 pt-0.5 flex flex-col">{children}</div>
      </motion.div>
    </div>
  );
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
    folded,
  };

  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex w-full flex-col overflow-hidden',
        className
      )}
    >
      {/* + New */}
      <div className="min-w-0 flex w-full flex-col">
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

      {/* Scrollable section list */}
      <div
        ref={projectListRef}
        className={cn(
          'm-0 mt-1 min-h-0 min-w-0 p-0 pb-1 flex flex-1 flex-col',
          folded
            ? projectListOverflow
              ? 'scrollbar-hide gap-0.5 overflow-y-auto'
              : 'gap-0.5 overflow-hidden'
            : projectListOverflow
              ? 'scrollbar overflow-y-auto'
              : 'overflow-hidden'
        )}
      >
        {folded ? (
          // Icon-only rail: flat list, no section headers
          <>
            {hasPinned && (
              <ProjectNavListRows
                {...sharedRowProps}
                projects={pinnedProjects}
              />
            )}
            {hasUnpinned && (
              <ProjectNavListRows
                {...sharedRowProps}
                projects={unpinnedProjects}
              />
            )}
          </>
        ) : (
          // Expanded: accordion sections
          <>
            {hasPinned && (
              <AccordionSection label={pinnedLabel}>
                <ProjectNavListRows
                  {...sharedRowProps}
                  projects={pinnedProjects}
                />
              </AccordionSection>
            )}
            {hasUnpinned && (
              <AccordionSection label={projectsLabel}>
                <ProjectNavListRows
                  {...sharedRowProps}
                  projects={unpinnedProjects}
                />
              </AccordionSection>
            )}
          </>
        )}
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
