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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { cn } from '@/lib/utils';
import { Archive, MoreHorizontal, Pin, Trash2, Zap } from 'lucide-react';
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
  /** Previous end-project / achieve flow. */
  onAchieveProject?: (projectId: string) => void;
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
  onAchieveProject,
  folded,
  maxItems,
  panelListHover = false,
  showRowMenu = true,
}: ProjectNavListRowsProps) {
  const { t } = useTranslation();
  const achieveLabel = t('layout.achieve', { defaultValue: 'Achieve' });
  const pinLabel = t('layout.pin', { defaultValue: 'Pin' });
  const deleteLabel = t('layout.delete');
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
                    'min-w-0 gap-0 w-full'
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
                'group/session-item group h-8 min-w-0 gap-1 rounded-xl pl-3 relative flex w-full items-center',
                showRowMenu ? 'pr-1 overflow-visible' : 'pr-3 overflow-hidden',
                'transition-colors duration-150',
                active
                  ? panelListHover
                    ? 'bg-ds-bg-neutral-muted-default hover:bg-ds-bg-neutral-default-default'
                    : 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default'
                  : !panelListHover
                    ? 'hover:bg-ds-bg-neutral-subtle-default bg-transparent'
                    : 'hover:bg-ds-bg-neutral-default-default bg-transparent'
              )}
            >
              <button
                type="button"
                onClick={() => onProjectClick?.(project.id)}
                className={cn(
                  'no-drag min-h-0 min-w-0 gap-3 px-0 py-1 relative z-0 flex flex-1 items-center overflow-hidden text-left outline-none',
                  'focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:ring-2 focus-visible:outline-none'
                )}
              >
                <LeadIcon className={leadClassName} aria-hidden />
                <span
                  className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default flex-1 truncate"
                  title={project.title}
                >
                  {project.title}
                </span>
                {project.source === 'trigger' ? (
                  <Zap
                    className="h-3.5 w-3.5 text-ds-icon-warning-default-default shrink-0"
                    aria-label={triggerSourceLabel}
                  />
                ) : null}
                {project.trailing ? (
                  <span className="pl-1 text-body-xs text-ds-text-neutral-muted-default shrink-0 tabular-nums">
                    {project.trailing}
                  </span>
                ) : null}
              </button>

              {showRowMenu ? (
                <>
                  <span
                    className={cn(
                      'bottom-0 right-7 top-0 w-14 pointer-events-none absolute z-[1] bg-gradient-to-l to-transparent',
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

                  <div className="relative z-[2] flex shrink-0 items-stretch">
                    <div
                      className={cn(
                        'max-w-0 ease-out flex shrink-0 items-center justify-end overflow-hidden opacity-0 transition-[max-width,opacity] duration-150',
                        'pointer-events-none',
                        'group-hover/session-item:pointer-events-auto group-hover/session-item:opacity-100',
                        'group-hover/session-item:max-w-10',
                        'group-focus-within/session-item:pointer-events-auto group-focus-within/session-item:opacity-100',
                        'group-focus-within/session-item:max-w-10',
                        'has-[[data-state=open]]:max-w-10 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100',
                        active && 'max-w-10 pointer-events-auto opacity-100'
                      )}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            buttonContent="icon-only"
                            className={cn(
                              'no-drag mr-0.5 rounded-xl hover:bg-ds-bg-neutral-strong-default shrink-0',
                              'focus-visible:ring-ds-border-neutral-default-default focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
                            )}
                            aria-label={sessionMenuAria}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal
                              className="h-4 w-4 text-ds-icon-neutral-muted-default"
                              aria-hidden
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="min-w-0 w-max"
                        >
                          <DropdownMenuItem
                            className="cursor-pointer"
                            disabled={!onAchieveProject}
                            onClick={() => onAchieveProject?.(project.id)}
                          >
                            <Archive aria-hidden />
                            {achieveLabel}
                          </DropdownMenuItem>
                          <DropdownMenuItem className="cursor-pointer" disabled>
                            <Pin aria-hidden />
                            {pinLabel}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-ds-text-error-default-default focus:text-ds-text-error-default-default [&>svg]:!text-ds-icon-error-default-default cursor-pointer"
                            disabled={!onDeleteProject}
                            onClick={() => onDeleteProject?.(project.id)}
                          >
                            <Trash2 aria-hidden />
                            {deleteLabel}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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
