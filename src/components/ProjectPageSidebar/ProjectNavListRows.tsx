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

import { sidebarTabButtonClass } from '@/components/Layout/AppSidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TooltipSimple } from '@/components/ui/tooltip';
import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { cn } from '@/lib/utils';
import { Archive, MoreHorizontal, Pin, Trash2, Zap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS } from './constants';

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

function ProjectNavRowMenu({
  projectId,
  pinned,
  achieved,
  open,
  onOpenChange,
  onPinProject,
  onAchieveProject,
  onDeleteProject,
}: {
  projectId: string;
  pinned?: boolean;
  achieved?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPinProject?: (projectId: string) => void;
  onAchieveProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const pinLabel = pinned
    ? t('layout.unpin', { defaultValue: 'Unpin' })
    : t('layout.pin', { defaultValue: 'Pin' });
  const achieveLabel = t('layout.achieve-project', {
    defaultValue: 'Achieve Project',
  });
  const deleteLabel = t('layout.delete-project');
  const moreLabel = t('layout.more-actions');

  return (
    <div
      className={cn(
        'flex max-w-0 shrink-0 items-center justify-end overflow-hidden opacity-0',
        'pointer-events-none',
        'group-hover/session-item:pointer-events-auto group-hover/session-item:max-w-10 group-hover/session-item:opacity-100',
        'focus-within:pointer-events-auto focus-within:max-w-10 focus-within:opacity-100',
        open && 'pointer-events-auto max-w-10 opacity-100'
      )}
    >
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonRadius="full"
            buttonContent="icon-only"
            className={cn(
              'no-drag shrink-0',
              'data-[state=open]:bg-ds-bg-neutral-subtle-selected data-[state=open]:hover:bg-ds-bg-neutral-subtle-selected'
            )}
            aria-label={moreLabel}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal
              className="h-3.5 w-3.5 text-ds-icon-neutral-muted-default"
              aria-hidden
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem
            className="gap-2"
            disabled={!onPinProject}
            onSelect={() => onPinProject?.(projectId)}
          >
            <Pin
              className={cn(
                'h-4 w-4',
                pinned && 'fill-current text-ds-icon-brand-default-default'
              )}
              aria-hidden
            />
            {pinLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={!onAchieveProject || achieved}
            onSelect={() => onAchieveProject?.(projectId)}
          >
            <Archive className="h-4 w-4" aria-hidden />
            {achieveLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default"
            disabled={!onDeleteProject}
            onSelect={() => onDeleteProject?.(projectId)}
          >
            <Trash2
              className="h-4 w-4 text-ds-icon-error-default-default"
              aria-hidden
            />
            {deleteLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ProjectNavRow({
  project,
  active,
  panelListHover,
  showRowMenu,
  triggerSourceLabel,
  onProjectClick,
  onPinProject,
  onAchieveProject,
  onDeleteProject,
}: {
  project: ProjectNavItem;
  active: boolean;
  panelListHover: boolean;
  showRowMenu: boolean;
  triggerSourceLabel: string;
  onProjectClick?: (projectId: string) => void;
  onPinProject?: (projectId: string) => void;
  onAchieveProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const LeadIcon = project.sessionLead.Icon;
  const leadClassName = cn(
    'h-4 w-4 shrink-0',
    project.sessionLead.iconClassName,
    project.sessionLead.spin && 'animate-spin'
  );
  const selected = active || menuOpen;

  return (
    <div className="min-w-0">
      {/* Tooltip trigger is the whole tab so it anchors to the row’s right edge,
          not the inner title button. avoidCollisions={false} stops Floating UI
          from treating the sidebar’s overflow clip as the boundary and shifting
          the tip back over the row. */}
      <TooltipSimple
        content={project.title}
        side="right"
        align="start"
        sideOffset={4}
        avoidCollisions={false}
        variant="instant"
        enabled={!menuOpen}
        className={SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS}
      >
        <div
          className={cn(
            'group/session-item relative flex h-8 w-full min-w-0 items-center overflow-hidden rounded-xl pl-3 pr-3',
            'transition-colors duration-150',
            selected
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
            <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-ds-text-neutral-muted-default">
              {project.title}
            </span>
            {project.source === 'trigger' ? (
              <Zap
                className="h-3.5 w-3.5 shrink-0 text-ds-icon-warning-default-default"
                aria-label={triggerSourceLabel}
              />
            ) : null}
            {!showRowMenu && project.trailing ? (
              <span className="shrink-0 pl-1 text-body-xs tabular-nums text-ds-text-neutral-muted-default">
                {project.trailing}
              </span>
            ) : null}
          </button>

          {showRowMenu ? (
            <ProjectNavRowMenu
              projectId={project.id}
              pinned={project.pinned}
              achieved={project.achieved}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              onPinProject={onPinProject}
              onAchieveProject={onAchieveProject}
              onDeleteProject={onDeleteProject}
            />
          ) : null}
        </div>
      </TooltipSimple>
    </div>
  );
}

export function ProjectNavListRows({
  projects,
  activeProjectId,
  onProjectClick,
  onDeleteProject,
  onAchieveProject,
  onPinProject,
  folded,
  maxItems,
  panelListHover = false,
  showRowMenu = true,
}: ProjectNavListRowsProps) {
  const { t } = useTranslation();
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
                align="start"
                sideOffset={4}
                avoidCollisions={false}
                enabled
                variant="instant"
                className={SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS}
              >
                <button
                  type="button"
                  onClick={() => onProjectClick?.(project.id)}
                  className={cn(
                    sidebarTabButtonClass(active),
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
          <ProjectNavRow
            key={project.id}
            project={project}
            active={active}
            panelListHover={panelListHover}
            showRowMenu={showRowMenu}
            triggerSourceLabel={triggerSourceLabel}
            onProjectClick={onProjectClick}
            onPinProject={onPinProject}
            onAchieveProject={onAchieveProject}
            onDeleteProject={onDeleteProject}
          />
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
