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

import type { SessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';

export type NavListSession = {
  id: string;
  title: string;
  sessionLead?: SessionNavLeadPresentation;
  trailing?: string;
};

export function NavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onNewSession,
  showNewSession = true,
  className,
}: {
  sessions: NavListSession[];
  activeSessionId: string | null;
  onSessionClick: (id: string) => void;
  onNewSession?: () => void;
  folded?: boolean;
  panelListHover?: boolean;
  showRowMenu?: boolean;
  showNewSession?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 overflow-y-auto', className)}>
      {showNewSession ? (
        <button
          type="button"
          onClick={onNewSession}
          className="flex items-center gap-2 rounded-xl border border-dashed border-ds-border-neutral-default-default px-3 py-3 text-body-sm font-semibold text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-subtle-hover"
        >
          <Plus className="h-4 w-4" />
          New task
        </button>
      ) : null}
      {sessions.map((session) => {
        const Icon = session.sessionLead?.Icon;
        const active = activeSessionId === session.id;
        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSessionClick(session.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-xl border border-solid px-3 py-3 text-left transition-colors',
              active
                ? 'border-ds-border-brand-subtle-default bg-ds-bg-brand-subtle-default'
                : 'border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default hover:bg-ds-bg-neutral-subtle-hover'
            )}
          >
            {Icon ? (
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0',
                  session.sessionLead?.spin && 'animate-spin',
                  session.sessionLead?.iconClassName
                )}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
              {session.title}
            </span>
            {session.trailing ? (
              <span className="shrink-0 text-body-xs text-ds-text-neutral-muted-default">
                {session.trailing}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
