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
import { TooltipSimple } from '@/components/ui/tooltip';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { cn } from '@/lib/utils';
import { Archive, Pin, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';
import { workspaceTabButtonClass } from './NavTab';

export interface ProjectNavItem {
  id: string;
  title: string;
  /** Leading icon + color from `getSessionNavLeadPresentation`. */
  sessionLead: SessionNavLeadPresentation;
  achieved?: boolean;
  pinned?: boolean;
  source?: 'user' | 'trigger';
  /** e.g. relative time, shown when `showRowMenu` is false. */
  trailing?: string;
}

export interface ProjectNavListRowsProps {
  projects: ProjectNavItem[];
  activeProjectId?: string | null;
  onProjectClick?: (projectId: string) => void;
  /** Kept for backward compat (parent still wires up the delete dialog). */
  onDeleteProject?: (projectId: string) => void;
  onAchieveProject?: (projectId: string) => void;
  onPinProject?: (projectId: string) => void;
  /** Icon rail: one icon per row. */
  folded: boolean;
  /** If set, only the first N projects are rendered. */
  maxItems?: number;
  /**
   * Main-panel project lists use the default
   * neutral hover fill; sidebar keeps the subtle fill.
   */
  panelListHover?: boolean;
  /** When false, hide the trailing action area (project list and workspace recent: time only). */
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
  onDeleteProject: _onDeleteProject,
  onAchieveProject,
  onPinProject,
  folded,
  maxItems,
  panelListHover = false,
  showRowMenu = true,
}: ProjectNavListRowsProps) {
  const { t } = useTranslation();
  const achieveLabel = t('layout.achieve', { defaultValue: 'Achieve' });
  const achievedLabel = t('layout.achieved', { defaultValue: 'Achieved' });
  const pinLabel = t('layout.pin', { defaultValue: 'Pin' });
  const unpinLabel = t('layout.unpin', { defaultValue: 'Unpin' });
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
                'group/session-item h-8 min-w-0 rounded-xl pl-3 pr-3 relative flex w-full items-center overflow-hidden',
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
              {/* Main click area — always full width */}
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
                {!showRowMenu && project.trailing ? (
                  <span className="pl-1 text-body-xs text-ds-text-neutral-muted-default shrink-0 tabular-nums">
                    {project.trailing}
                  </span>
                ) : null}
              </button>

              {/* Pin + archive buttons — in-flow so title truncates; snap visible on hover, no animation */}
              {showRowMenu && (
                <div className="hidden shrink-0 items-center group-hover/session-item:flex">
                  <TooltipSimple
                    content={project.pinned ? unpinLabel : pinLabel}
                    side="top"
                    sideOffset={6}
                    delayDuration={500}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonRadius="full"
                      buttonContent="icon-only"
                      className="no-drag shrink-0"
                      aria-label={project.pinned ? unpinLabel : pinLabel}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPinProject?.(project.id);
                      }}
                    >
                      <Pin
                        className={cn(
                          'h-3.5 w-3.5 transition-colors',
                          project.pinned
                            ? 'text-ds-icon-brand-default-default fill-current'
                            : 'text-ds-icon-neutral-muted-default'
                        )}
                        aria-hidden
                      />
                    </Button>
                  </TooltipSimple>
                  <TooltipSimple
                    content={project.achieved ? achievedLabel : achieveLabel}
                    side="top"
                    sideOffset={6}
                    delayDuration={500}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      buttonRadius="full"
                      className="no-drag shrink-0"
                      aria-label={
                        project.achieved ? achievedLabel : achieveLabel
                      }
                      disabled={!onAchieveProject || project.achieved}
                      onClick={(e) => {
                        e.stopPropagation();
                        onAchieveProject?.(project.id);
                      }}
                    >
                      <Archive
                        className="h-3.5 w-3.5 text-ds-icon-neutral-muted-default"
                        aria-hidden
                      />
                    </Button>
                  </TooltipSimple>
                </div>
              )}
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
