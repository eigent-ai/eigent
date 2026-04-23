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
import { LayoutGrid, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';
import { NavTab, workspaceTabButtonClass } from './NavTab';

export interface NavListSession {
  id: string;
  title: string;
  /** Leading icon + color from `getSessionNavLeadPresentation`. */
  sessionLead: SessionNavLeadPresentation;
}

export interface NavListProps {
  sessions: NavListSession[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  /** Top row: workspace tab — switches to workforce view. */
  workspaceActive: boolean;
  onWorkspaceClick: () => void;
  /** Trailing + control (e.g. create task + focus session). */
  onNewSession: () => void;
  /** Icon-only rail: match other sidebar `NavTab`s. */
  folded: boolean;
  className?: string;
}

/** Workspace row (split: tab + new session) and a flat scrollable session column. */
export function NavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  workspaceActive,
  onWorkspaceClick,
  onNewSession,
  folded,
  className,
}: NavListProps) {
  const { t } = useTranslation();
  const workspaceLabel = t('triggers.workspace');

  const deleteLabel = t('layout.sessions-delete-session', {
    defaultValue: 'Delete session',
  });
  const sessionMenuAria = t('layout.sessions-session-menu', {
    defaultValue: 'Session options',
  });
  const newSessionLabel = t('layout.sessions-start-new', {
    defaultValue: 'Start new session',
  });

  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex w-full flex-col overflow-hidden',
        className
      )}
    >
      <div className="min-w-0 gap-2 flex w-full flex-col">
        <NavTab
          layout="split"
          active={workspaceActive}
          onClick={onWorkspaceClick}
          leading={<LayoutGrid className="h-4 w-4 shrink-0" aria-hidden />}
          label={workspaceLabel}
          endAction={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className={cn(
                'no-drag mr-1 rounded-xl hover:bg-ds-bg-neutral-strong-default shrink-0',
                'focus-visible:ring-ds-border-neutral-default-default focus-visible:z-10 focus-visible:ring-2 focus-visible:outline-none'
              )}
              aria-label={newSessionLabel}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNewSession();
              }}
            >
              <Plus
                className="h-4 w-4 text-ds-icon-neutral-muted-default"
                aria-hidden
              />
            </Button>
          }
          tooltip={workspaceLabel}
          tooltipEnabledWhenCollapsed={!folded}
          folded={folded}
          ariaLabel={workspaceLabel}
          ariaCurrentPage={workspaceActive}
        />

        {folded ? (
          <TooltipSimple
            content={newSessionLabel}
            side="right"
            align="center"
            enabled
            className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
          >
            <button
              type="button"
              onClick={onNewSession}
              className={cn(workspaceTabButtonClass(false), 'gap-0 w-full')}
              aria-label={newSessionLabel}
            >
              <Plus
                className="h-4 w-4 text-ds-icon-neutral-muted-default shrink-0"
                aria-hidden
              />
            </button>
          </TooltipSimple>
        ) : null}
      </div>

      <div
        className={cn(
          'm-0 min-h-0 min-w-0 gap-0.5 p-0 pb-1 flex flex-1 flex-col overflow-y-auto',
          folded ? 'mt-0.5' : 'mt-1'
        )}
      >
        {sessions.map((session) => {
          const active = activeSessionId === session.id;
          const LeadIcon = session.sessionLead.Icon;
          const leadClassName = cn(
            'h-4 w-4 shrink-0',
            session.sessionLead.iconClassName,
            session.sessionLead.spin && 'animate-spin'
          );
          if (folded) {
            return (
              <div key={session.id} className="min-w-0">
                <TooltipSimple
                  content={session.title}
                  side="right"
                  align="center"
                  enabled
                  className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
                >
                  <button
                    type="button"
                    onClick={() => onSessionClick?.(session.id)}
                    className={cn(
                      workspaceTabButtonClass(active),
                      'gap-0 min-w-0 w-full'
                    )}
                    aria-label={session.title}
                    aria-current={active ? 'true' : undefined}
                  >
                    <LeadIcon className={leadClassName} aria-hidden />
                  </button>
                </TooltipSimple>
              </div>
            );
          }
          return (
            <div key={session.id} className="min-w-0">
              <div
                className={cn(
                  'group/session-item min-w-0 h-8 gap-1 rounded-xl pl-3 pr-1 relative flex w-full items-center overflow-hidden',
                  active
                    ? 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default'
                    : 'hover:bg-ds-bg-neutral-subtle-default bg-transparent'
                )}
              >
                <button
                  type="button"
                  onClick={() => onSessionClick?.(session.id)}
                  className={cn(
                    'no-drag min-h-0 min-w-0 gap-3 py-1 px-0 relative z-0 flex flex-1 items-center overflow-hidden text-left outline-none',
                    'focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:ring-2 focus-visible:outline-none'
                  )}
                >
                  <LeadIcon className={leadClassName} aria-hidden />
                  <span
                    className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default flex-1 overflow-visible whitespace-nowrap"
                    title={session.title}
                  >
                    {session.title}
                  </span>
                </button>

                <span
                  className={cn(
                    'top-0 bottom-0 right-7 w-14 pointer-events-none absolute z-[1] bg-gradient-to-l to-transparent',
                    active
                      ? 'from-ds-bg-neutral-subtle-default'
                      : 'group-hover/session-item:from-ds-bg-neutral-subtle-default from-transparent'
                  )}
                  aria-hidden
                />

                <div className="relative z-[2] shrink-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'no-drag h-7 w-7 rounded-lg text-ds-icon-neutral-muted-default flex shrink-0 items-center justify-center transition-opacity duration-150 outline-none',
                          active
                            ? 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default opacity-100'
                            : [
                                'md:opacity-0 bg-transparent opacity-100',
                                'md:group-hover/session-item:opacity-100',
                                'md:group-focus-within/session-item:opacity-100',
                                'data-[state=open]:opacity-100',
                              ],
                          'focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:ring-2 focus-visible:outline-none'
                        )}
                        aria-label={sessionMenuAria}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[9rem]">
                      <DropdownMenuItem
                        className="text-ds-text-error-default-default focus:text-ds-text-error-default-default cursor-pointer"
                        onClick={() => onDeleteSession?.(session.id)}
                      >
                        {deleteLabel}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
