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
import { cn } from '@/lib/utils';
import { LayoutGrid, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_TOOLTIP_CONTENT_CLASS } from './constants';
import { NavListSessionRows, type NavListSession } from './NavListSessionRows';
import { NavTab, workspaceTabButtonClass } from './NavTab';

export {
  NAV_LIST_SESSIONS_RECENT_MAX,
  NavListSessionRows,
  type NavListSession,
} from './NavListSessionRows';

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
        <NavListSessionRows
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionClick={onSessionClick}
          onDeleteSession={onDeleteSession}
          folded={folded}
        />
      </div>
    </div>
  );
}
