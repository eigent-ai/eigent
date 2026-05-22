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

import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavListSessionRows, type NavListSession } from './NavListSessionRows';
import { NavTab } from './NavTab';

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
  onNewSession: () => void;
  /** Selected state for the New Session tab. */
  newSessionActive?: boolean;
  /** Icon-only rail: match other sidebar `NavTab`s. */
  folded: boolean;
  className?: string;
}

/** New Session row and a flat scrollable session column. */
export function NavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  onNewSession,
  newSessionActive = false,
  folded,
  className,
}: NavListProps) {
  const { t } = useTranslation();
  const sessionListRef = useRef<HTMLDivElement>(null);
  const [sessionListOverflow, setSessionListOverflow] = useState(false);

  useEffect(() => {
    const el = sessionListRef.current;
    if (!el) return;

    const checkOverflow = () => {
      setSessionListOverflow(el.scrollHeight > el.clientHeight + 1);
    };

    checkOverflow();

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));

    return () => observer.disconnect();
  }, [sessions, folded]);

  const newSessionLabel = t('layout.sessions-start-new');

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-col overflow-hidden',
        className
      )}
    >
      <div className="flex w-full min-w-0 flex-col gap-2">
        <NavTab
          active={newSessionActive}
          onClick={onNewSession}
          leading={<Plus className="h-4 w-4 shrink-0" aria-hidden />}
          label={newSessionLabel}
          tooltip={newSessionLabel}
          tooltipEnabledWhenCollapsed={!folded}
          folded={folded}
          ariaLabel={newSessionLabel}
          ariaCurrentPage={newSessionActive}
        />
      </div>

      <div
        ref={sessionListRef}
        className={cn(
          'm-0 mt-1 flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 p-0 pb-1',
          folded
            ? sessionListOverflow
              ? 'scrollbar-hide overflow-y-auto'
              : 'overflow-hidden'
            : sessionListOverflow
              ? 'scrollbar overflow-y-auto'
              : 'overflow-hidden'
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
