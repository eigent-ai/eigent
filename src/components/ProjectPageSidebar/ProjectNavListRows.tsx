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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { cn } from '@/lib/utils';
import { MoreHorizontal, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';
import { workspaceTabButtonClass } from './NavTab';

export interface ProjectNavItem {
  id: string;
  title: string;
  /** Leading icon + color from `getSessionNavLeadPresentation`. */
  sessionLead: SessionNavLeadPresentation;
  source?: 'user' | 'trigger';
  /** e.g. relative time, shown before the row menu. */
  trailing?: string;
}

export interface ProjectNavListRowsProps {
  projects: ProjectNavItem[];
  activeProjectId?: string | null;
  onProjectClick?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  /** Icon rail: one icon per row. */
  folded: boolean;
  /** If set, only the first N projects are rendered. */
  maxItems?: number;
  /**
   * Main-panel project lists use the default
   * neutral hover fill; sidebar keeps the subtle fill.
   */
  panelListHover?: boolean;
  /** When false, hide the trailing ⋯ row menu (project list and workspace recent: time only). */
  showRowMenu?: boolean;
}

/**
 * Renders compact Project rows; cap with `maxItems` for recency-prefixed UIs.
 */
export const NAV_LIST_PROJECTS_RECENT_MAX = 5;

export function ProjectNavListRows({
  projects,
  activeProjectId,
  onProjectClick,
  onDeleteProject,
  folded,
  maxItems,
  panelListHover = false,
  showRowMenu = true,
}: ProjectNavListRowsProps) {
  const { t } = useTranslation();
  const deleteLabel = t('layout.sessions-delete-session');
  const sessionMenuAria = t('layout.sessions-session-menu');
  const triggerSourceLabel = t('layout.task-source-trigger');
  const list = maxItems != null ? projects.slice(0, maxItems) : projects;

  return (
    <>
      {list.map((project) => {
        const active = activeProjectId === project.id;
        const LeadIcon = project.sessionLead.Icon;
        const leadClassName = cn(
          'h-4 w-4 shrink-0',
          project.sessionLead.iconClassName,
          project.sessionLead.spin && 'animate-spin'
        );
        if (folded) {
          return (
            <div key={project.id} className="min-w-0">
              <TooltipSimple
                content={project.title}
                side="right"
                align="center"
                enabled
                className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
              >
                <button
                  type="button"
                  onClick={() => onProjectClick?.(project.id)}
                  className={cn(
                    workspaceTabButtonClass(active),
                    'w-full min-w-0 gap-0'
                  )}
                  aria-label={project.title}
                  aria-current={active ? 'true' : undefined}
                >
                  <LeadIcon className={leadClassName} aria-hidden />
                </button>
              </TooltipSimple>
            </div>
          );
        }
        return (
          <div key={project.id} className="min-w-0">
            <div
              className={cn(
                'group/session-item relative flex h-8 w-full min-w-0 items-center gap-1 overflow-hidden rounded-xl pl-3',
                showRowMenu ? 'pr-1' : 'pr-3',
                'transition-colors duration-150',
                active
                  ? panelListHover
                    ? 'bg-ds-bg-neutral-muted-default hover:bg-ds-bg-neutral-default-default'
                    : 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default'
                  : !panelListHover
                    ? 'bg-transparent hover:bg-ds-bg-neutral-subtle-default'
                    : 'bg-transparent hover:bg-ds-bg-neutral-default-default'
              )}
            >
              <button
                type="button"
                onClick={() => onProjectClick?.(project.id)}
                className={cn(
                  'no-drag relative z-0 flex min-h-0 min-w-0 flex-1 items-center gap-3 overflow-hidden px-0 py-1 text-left outline-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default'
                )}
              >
                <LeadIcon className={leadClassName} aria-hidden />
                <span
                  className="min-w-0 flex-1 truncate text-body-sm font-medium text-ds-text-neutral-muted-default"
                  title={project.title}
                >
                  {project.title}
                </span>
                {project.source === 'trigger' ? (
                  <Zap
                    className="h-3.5 w-3.5 shrink-0 text-ds-icon-warning-default-default"
                    aria-label={triggerSourceLabel}
                  />
                ) : null}
                {project.trailing ? (
                  <span className="shrink-0 pl-1 text-body-xs tabular-nums text-ds-text-neutral-muted-default">
                    {project.trailing}
                  </span>
                ) : null}
              </button>

              {showRowMenu && onDeleteProject ? (
                <>
                  <span
                    className={cn(
                      'pointer-events-none absolute bottom-0 right-7 top-0 z-[1] w-14 bg-gradient-to-l to-transparent',
                      active
                        ? panelListHover
                          ? 'from-ds-bg-neutral-muted-default group-hover/session-item:from-ds-bg-neutral-default-default'
                          : 'from-ds-bg-neutral-subtle-default'
                        : [
                            'from-transparent',
                            panelListHover
                              ? 'group-hover/session-item:from-ds-bg-neutral-default-default'
                              : 'group-hover/session-item:from-ds-bg-neutral-subtle-default',
                          ]
                    )}
                    aria-hidden
                  />

                  <div className="relative z-[2] shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-icon-neutral-muted-default outline-none transition-opacity duration-150',
                            active
                              ? panelListHover
                                ? 'bg-transparent opacity-100'
                                : 'bg-ds-bg-neutral-subtle-default opacity-100 hover:bg-ds-bg-neutral-subtle-default'
                              : [
                                  'bg-transparent opacity-100 md:opacity-0',
                                  'md:group-hover/session-item:opacity-100',
                                  'md:group-focus-within/session-item:opacity-100',
                                  'data-[state=open]:opacity-100',
                                ],
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default'
                          )}
                          aria-label={sessionMenuAria}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[9rem]">
                        <DropdownMenuItem
                          className="cursor-pointer text-ds-text-error-default-default focus:text-ds-text-error-default-default"
                          onClick={() => onDeleteProject?.(project.id)}
                        >
                          {deleteLabel}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}

export const NAV_LIST_SESSIONS_RECENT_MAX = NAV_LIST_PROJECTS_RECENT_MAX;
export type NavListSession = ProjectNavItem;

export interface NavListSessionRowsProps {
  sessions: ProjectNavItem[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  folded: boolean;
  maxItems?: number;
  panelListHover?: boolean;
  showRowMenu?: boolean;
}

export function NavListSessionRows({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  ...rest
}: NavListSessionRowsProps) {
  return (
    <ProjectNavListRows
      projects={sessions}
      activeProjectId={activeSessionId}
      onProjectClick={onSessionClick}
      onDeleteProject={onDeleteSession}
      {...rest}
    />
  );
}
