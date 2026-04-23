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
import { MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';
import { workspaceTabButtonClass } from './NavTab';

export interface NavListSession {
  id: string;
  title: string;
  /** Leading icon + color from `getSessionNavLeadPresentation`. */
  sessionLead: SessionNavLeadPresentation;
  /** e.g. relative time, shown before the row menu. */
  trailing?: string;
}

export interface NavListSessionRowsProps {
  sessions: NavListSession[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  /** Icon rail: one icon per row. */
  folded: boolean;
  /** If set, only the first N sessions are rendered. */
  maxItems?: number;
  /**
   * Main-panel session lists (workspace recent, all-sessions) use the default
   * neutral hover fill; sidebar keeps the subtle fill.
   */
  panelListHover?: boolean;
}

/**
 * Renders the same session rows as the project sidebar; cap with `maxItems` for
 * recency-prefixed UIs.
 */
export const NAV_LIST_SESSIONS_RECENT_MAX = 5;

export function NavListSessionRows({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  folded,
  maxItems,
  panelListHover = false,
}: NavListSessionRowsProps) {
  const { t } = useTranslation();
  const deleteLabel = t('layout.sessions-delete-session', {
    defaultValue: 'Delete session',
  });
  const sessionMenuAria = t('layout.sessions-session-menu', {
    defaultValue: 'Session options',
  });
  const list = maxItems != null ? sessions.slice(0, maxItems) : sessions;

  return (
    <>
      {list.map((session) => {
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
                onClick={() => onSessionClick?.(session.id)}
                className={cn(
                  'no-drag min-h-0 min-w-0 gap-3 py-1 px-0 relative z-0 flex flex-1 items-center overflow-hidden text-left outline-none',
                  'focus-visible:ring-ds-ring-neutral-subtle-default focus-visible:ring-2 focus-visible:outline-none'
                )}
              >
                <LeadIcon className={leadClassName} aria-hidden />
                <span
                  className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default flex-1 truncate"
                  title={session.title}
                >
                  {session.title}
                </span>
                {session.trailing ? (
                  <span className="text-ds-text-neutral-muted-default text-body-xs pl-1 shrink-0 tabular-nums">
                    {session.trailing}
                  </span>
                ) : null}
              </button>

              <span
                className={cn(
                  'top-0 bottom-0 right-7 w-14 pointer-events-none absolute z-[1] bg-gradient-to-l to-transparent',
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
                        'no-drag h-7 w-7 rounded-lg text-ds-icon-neutral-muted-default flex shrink-0 items-center justify-center transition-opacity duration-150 outline-none',
                        active
                          ? panelListHover
                            ? 'bg-transparent opacity-100'
                            : 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default opacity-100'
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
    </>
  );
}
