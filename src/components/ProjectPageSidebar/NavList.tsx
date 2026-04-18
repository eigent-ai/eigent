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
import { cn } from '@/lib/utils';
import { ChatTaskStatus, type ChatTaskStatusType } from '@/types/constants';
import { ChevronDown, MessageCircle, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface NavListSession {
  id: string;
  title: string;
  /** Drives the leading icon color (running / finished / default). */
  taskStatus?: ChatTaskStatusType;
}

export interface NavListProps {
  sessions: NavListSession[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onShowAll?: () => void;
  /** When true, “Show all” is styled as the active tab (persistent underline). */
  showAllActive?: boolean;
  /**
   * Uncontrolled initial expanded state. If omitted, expanded when `sessions.length > 0`,
   * folded when the project has not started (no sessions yet).
   */
  defaultExpanded?: boolean;
  className?: string;
}

/** Sessions list: collapsible header (Sessions + chevron, Show all) and rows with overflow title + actions menu. */
export function NavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  onShowAll,
  showAllActive = false,
  defaultExpanded,
  className,
}: NavListProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(
    () => defaultExpanded ?? sessions.length > 0
  );
  const prevSessionCountRef = useRef(sessions.length);

  useEffect(() => {
    const prev = prevSessionCountRef.current;
    if (sessions.length === 0) {
      setExpanded(false);
    } else if (prev === 0 && sessions.length > 0) {
      setExpanded(true);
    }
    prevSessionCountRef.current = sessions.length;
  }, [sessions.length]);

  const headingLabel = t('layout.sessions-heading', {
    defaultValue: 'Sessions',
  });
  const showAllLabel = t('layout.sessions-show-all', {
    defaultValue: 'Show all',
  });
  const deleteLabel = t('layout.sessions-delete-session', {
    defaultValue: 'Delete session',
  });
  const expandAria = t('layout.sessions-expand-list', {
    defaultValue: 'Expand sessions list',
  });
  const collapseAria = t('layout.sessions-collapse-list', {
    defaultValue: 'Collapse sessions list',
  });
  const sessionMenuAria = t('layout.sessions-session-menu', {
    defaultValue: 'Session options',
  });
  const emptySessionsHint = t('layout.sessions-create-task-hint', {
    defaultValue: 'Create a task to start a session',
  });

  const sessionLeadIconClass = (taskStatus: ChatTaskStatusType | undefined) => {
    if (taskStatus === ChatTaskStatus.RUNNING)
      return 'text-[color:var(--ds-icon-status-splitting-default-default)]';
    if (taskStatus === ChatTaskStatus.FINISHED)
      return 'text-[color:var(--ds-icon-status-completed-default-default)]';
    return 'text-[color:var(--ds-icon-neutral-default-default)]';
  };

  return (
    <div
      className={cn(
        'group min-h-0 min-w-0 flex w-full flex-col overflow-hidden',
        className
      )}
    >
      <div className="min-w-0 gap-2 px-1 mb-2 flex w-full items-center justify-between">
        <TooltipSimple
          content={expanded ? collapseAria : expandAria}
          side="right"
          align="center"
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'no-drag gap-1 rounded-xl py-1 px-2 text-body-xs font-bold inline-flex w-fit max-w-[calc(100%-5rem)] shrink items-center text-left text-[color:var(--ds-text-neutral-muted-default)] outline-none hover:bg-[var(--ds-bg-neutral-strong-default)]',
              'focus-visible:ring-2 focus-visible:ring-[var(--ds-border-neutral-default-default)] focus-visible:outline-none'
            )}
            aria-expanded={expanded}
            aria-label={expanded ? collapseAria : expandAria}
          >
            <span className="min-w-0 truncate">{headingLabel}</span>
            <ChevronDown
              className={cn(
                'h-4 w-4 shrink-0 text-[color:var(--ds-icon-neutral-default-default)] transition-[transform,opacity] duration-200',
                'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                expanded ? 'rotate-0' : '-rotate-90'
              )}
              aria-hidden
            />
          </button>
        </TooltipSimple>

        <button
          type="button"
          onClick={onShowAll}
          aria-current={showAllActive ? 'page' : undefined}
          className={cn(
            'no-drag gap-1 rounded-xl py-1 px-2 text-body-xs font-semibold inline-flex w-fit shrink-0 items-center text-left !text-[color:var(--ds-text-neutral-muted-default)] outline-none',
            showAllActive ? 'underline underline-offset-2' : 'hover:underline',
            'focus-visible:ring-2 focus-visible:ring-[var(--ds-border-neutral-default-default)] focus-visible:outline-none'
          )}
        >
          {showAllLabel}
        </button>
      </div>

      {expanded ? (
        <ul
          className="m-0 min-h-0 min-w-0 gap-0.5 p-0 pb-1 flex list-none flex-col overflow-y-auto"
          role="list"
        >
          {sessions.length === 0 ? (
            <li className="px-3 py-1.5 text-body-sm leading-snug text-[color:var(--ds-text-neutral-muted-default)]">
              {emptySessionsHint}
            </li>
          ) : null}
          {sessions.map((session) => {
            const active = activeSessionId === session.id;
            return (
              <li key={session.id} className="min-w-0">
                <div
                  className={cn(
                    'group/session-item min-w-0 h-8 gap-1 rounded-xl px-3 relative flex w-full items-center overflow-hidden',
                    active
                      ? 'bg-[var(--ds-bg-neutral-strong-default)] hover:bg-[var(--ds-bg-neutral-strong-default)]'
                      : 'bg-transparent hover:bg-[var(--ds-bg-neutral-strong-default)]'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSessionClick?.(session.id)}
                    className={cn(
                      'no-drag min-h-0 min-w-0 gap-3 py-1 relative z-0 flex flex-1 items-center overflow-hidden text-left outline-none',
                      'focus-visible:ring-2 focus-visible:ring-[var(--ds-border-neutral-default-default)] focus-visible:outline-none'
                    )}
                  >
                    <MessageCircle
                      className={cn(
                        'h-4 w-4 shrink-0',
                        sessionLeadIconClass(session.taskStatus)
                      )}
                      aria-hidden
                    />
                    <span
                      className="min-w-0 text-body-sm font-medium flex-1 overflow-visible whitespace-nowrap text-[color:var(--ds-text-neutral-muted-default)]"
                      title={session.title}
                    >
                      {session.title}
                    </span>
                  </button>

                  <span
                    className={cn(
                      'top-0 bottom-0 right-7 w-14 pointer-events-none absolute z-[1] bg-gradient-to-l to-transparent',
                      active
                        ? 'from-[var(--ds-bg-neutral-strong-default)]'
                        : 'from-transparent group-hover/session-item:from-[var(--ds-bg-neutral-strong-default)]'
                    )}
                    aria-hidden
                  />

                  <div className="relative z-[2] shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'no-drag h-7 w-7 rounded-lg flex shrink-0 items-center justify-center text-[color:var(--ds-icon-neutral-muted-default)] transition-opacity duration-150 outline-none',
                            active
                              ? 'bg-[var(--ds-bg-neutral-strong-default)] opacity-100 hover:bg-[var(--ds-bg-neutral-strong-default)]'
                              : [
                                  'md:opacity-0 bg-transparent opacity-100',
                                  'md:group-hover/session-item:opacity-100',
                                  'md:group-focus-within/session-item:opacity-100',
                                  'data-[state=open]:opacity-100',
                                ],
                            'focus-visible:ring-2 focus-visible:ring-[var(--ds-border-neutral-default-default)] focus-visible:outline-none'
                          )}
                          aria-label={sessionMenuAria}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[9rem]">
                        <DropdownMenuItem
                          className="cursor-pointer text-[color:var(--ds-text-status-error-strong-default)] focus:text-[color:var(--ds-text-status-error-strong-default)]"
                          onClick={() => onDeleteSession?.(session.id)}
                        >
                          {deleteLabel}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
