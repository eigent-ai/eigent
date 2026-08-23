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
import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import { cn } from '@/lib/utils';
import { Archive, MoreHorizontal, Pin, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS } from './constants';

export interface SessionNavItem {
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

export interface SessionNavListRowsProps {
  sessions: SessionNavItem[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
  onPinSession?: (sessionId: string) => void;
  /** Icon rail: one icon per row. */
  folded: boolean;
  /** If set, only the first N sessions are rendered. */
  maxItems?: number;
  /**
   * Main-panel session lists use the default
   * neutral hover fill; sidebar keeps the subtle fill.
   */
  panelListHover?: boolean;
  /** When false, hide the trailing action area (session list and workspace recent: time only). */
  showRowMenu?: boolean;
}

/**
 * Renders compact Session rows; cap with `maxItems` for recency-prefixed UIs.
 */
export const NAV_LIST_SESSIONS_RECENT_MAX = 5;

function SessionNavRowMenu({
  sessionId,
  pinned,
  achieved,
  open,
  onOpenChange,
  onPinSession,
  onEndSession,
  onDeleteSession,
}: {
  sessionId: string;
  pinned?: boolean;
  achieved?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPinSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const pinLabel = pinned
    ? t('layout.unpin', { defaultValue: 'Unpin' })
    : t('layout.pin', { defaultValue: 'Pin' });
  const achieveLabel = t('layout.achieve-project', {
    defaultValue: 'End session',
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
              'data-[state=open]:bg-ds-neutral-subtle-selected data-[state=open]:hover:bg-ds-neutral-subtle-selected'
            )}
            aria-label={moreLabel}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal
              className="size-ds-icon-md text-ds-ink-muted-default"
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
            disabled={!onPinSession}
            onSelect={() => onPinSession?.(sessionId)}
          >
            <Pin
              className={cn(
                'h-4 w-4',
                pinned && 'fill-current text-ds-accent-default-default'
              )}
              aria-hidden
            />
            {pinLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={!onEndSession || achieved}
            onSelect={() => onEndSession?.(sessionId)}
          >
            <Archive className="h-4 w-4" aria-hidden />
            {achieveLabel}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-ds-text-error-default-default focus:text-ds-text-error-strong-default data-[highlighted]:text-ds-text-error-default-default [&>svg]:text-ds-icon-error-default-default focus:[&>svg]:text-ds-icon-error-default-default data-[highlighted]:[&>svg]:text-ds-icon-error-default-default"
            disabled={!onDeleteSession}
            onSelect={() => onDeleteSession?.(sessionId)}
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

function SessionNavRow({
  session,
  active,
  panelListHover,
  showRowMenu,
  triggerSourceLabel,
  onSessionClick,
  onPinSession,
  onEndSession,
  onDeleteSession,
}: {
  session: SessionNavItem;
  active: boolean;
  panelListHover: boolean;
  showRowMenu: boolean;
  triggerSourceLabel: string;
  onSessionClick?: (sessionId: string) => void;
  onPinSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const LeadIcon = session.sessionLead.Icon;
  const leadClassName = cn(
    'h-4 w-4 shrink-0',
    session.sessionLead.iconClassName,
    session.sessionLead.spin && 'animate-spin'
  );
  const selected = active || menuOpen;

  return (
    <div className="min-w-0">
      {/* Tooltip trigger is the whole tab so it anchors to the row’s right edge,
          not the inner title button. avoidCollisions={false} stops Floating UI
          from treating the sidebar’s overflow clip as the boundary and shifting
          the tip back over the row. */}
      <TooltipSimple
        content={session.title}
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
            'group/session-item relative flex h-8 w-full min-w-0 items-center overflow-hidden rounded-xl pr-3 pl-3',
            'transition-colors duration-150',
            selected
              ? panelListHover
                ? 'bg-ds-neutral-muted-default hover:bg-ds-neutral-default-default'
                : 'bg-ds-neutral-subtle-default hover:bg-ds-neutral-subtle-default'
              : !panelListHover
                ? 'bg-transparent hover:bg-ds-neutral-subtle-default'
                : 'bg-transparent hover:bg-ds-neutral-default-default'
          )}
        >
          <button
            type="button"
            onClick={() => onSessionClick?.(session.id)}
            className={cn(
              'no-drag relative z-0 flex min-h-0 min-w-0 flex-1 items-center gap-3 overflow-hidden px-0 py-1 text-left outline-none',
              'focus-visible:ring-2 focus-visible:ring-ds-hairline-subtle-default focus-visible:outline-none'
            )}
          >
            <LeadIcon className={leadClassName} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ds-text-base font-medium text-ds-ink-muted-default">
              {session.title}
            </span>
            {session.source === 'trigger' ? (
              <AUTOMATION_ICON
                className="h-3.5 w-3.5 shrink-0 text-ds-icon-warning-default-default"
                aria-label={triggerSourceLabel}
              />
            ) : null}
            {!showRowMenu && session.trailing ? (
              <span className="shrink-0 pl-1 text-ds-text-meta text-ds-ink-muted-default tabular-nums">
                {session.trailing}
              </span>
            ) : null}
          </button>

          {showRowMenu ? (
            <SessionNavRowMenu
              sessionId={session.id}
              pinned={session.pinned}
              achieved={session.achieved}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              onPinSession={onPinSession}
              onEndSession={onEndSession}
              onDeleteSession={onDeleteSession}
            />
          ) : null}
        </div>
      </TooltipSimple>
    </div>
  );
}

export function SessionNavListRows({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  onEndSession,
  onPinSession,
  folded,
  maxItems,
  panelListHover = false,
  showRowMenu = true,
}: SessionNavListRowsProps) {
  const { t } = useTranslation();
  const triggerSourceLabel = t('layout.task-source-trigger');
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
                align="start"
                sideOffset={4}
                avoidCollisions={false}
                enabled
                variant="instant"
                className={SIDEBAR_TAB_TOOLTIP_CONTENT_CLASS}
              >
                <button
                  type="button"
                  onClick={() => onSessionClick?.(session.id)}
                  className={cn(
                    sidebarTabButtonClass(active),
                    'w-full min-w-0 gap-0'
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
          <SessionNavRow
            key={session.id}
            session={session}
            active={active}
            panelListHover={panelListHover}
            showRowMenu={showRowMenu}
            triggerSourceLabel={triggerSourceLabel}
            onSessionClick={onSessionClick}
            onPinSession={onPinSession}
            onEndSession={onEndSession}
            onDeleteSession={onDeleteSession}
          />
        );
      })}
    </>
  );
}
