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

import { NavTab, SidebarScrollArea } from '@/components/Layout/AppSidebar';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SessionNavListRows, type SessionNavItem } from './SessionNavListRows';
import { SidebarAccordionSection } from './SidebarAccordionSection';

export {
  NAV_LIST_SESSIONS_RECENT_MAX,
  SessionNavListRows,
  type SessionNavItem,
} from './SessionNavListRows';

export interface SessionNavListProps {
  sessions: SessionNavItem[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
  onPinSession?: (sessionId: string) => void;
  onNewSession: () => void;
  /** Selected state for the New Session row. */
  newSessionActive?: boolean;
  className?: string;
}

/** New Session row, optional Pinned section, and Sessions section. */
export function SessionNavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  onEndSession,
  onPinSession,
  onNewSession,
  newSessionActive = false,
  className,
}: SessionNavListProps) {
  const { t } = useTranslation();

  const newSessionLabel = t('layout.new');
  const pinnedLabel = t('layout.pinned', { defaultValue: 'Pinned' });
  const sessionsLabel = t('layout.projects', { defaultValue: 'Sessions' });

  const pinnedSessions = sessions.filter((session) => session.pinned);
  const unpinnedSessions = sessions.filter((session) => !session.pinned);
  const hasPinned = pinnedSessions.length > 0;
  const hasUnpinned = unpinnedSessions.length > 0;

  const sharedRowProps = {
    activeSessionId,
    onSessionClick,
    onDeleteSession,
    onEndSession,
    onPinSession,
    folded: false as const,
  };

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-col overflow-hidden',
        className
      )}
    >
      {/* + New Session */}
      <div className="flex w-full min-w-0 flex-col">
        <NavTab
          active={newSessionActive}
          onClick={onNewSession}
          leading={<Plus className="h-4 w-4 shrink-0" aria-hidden />}
          label={newSessionLabel}
          tooltip={
            <ShortcutTooltipContent
              label={newSessionLabel}
              shortcutId="new-project"
            />
          }
          tooltipCompact
          tooltipVariant="delayed"
          ariaLabel={newSessionLabel}
          ariaCurrentPage={newSessionActive}
        />
      </div>

      {/* Scrollable section list */}
      <SidebarScrollArea className="m-0 mt-1 p-0 pb-1">
        {hasPinned && (
          <SidebarAccordionSection label={pinnedLabel}>
            <SessionNavListRows {...sharedRowProps} sessions={pinnedSessions} />
          </SidebarAccordionSection>
        )}
        {hasUnpinned && (
          <SidebarAccordionSection label={sessionsLabel}>
            <SessionNavListRows
              {...sharedRowProps}
              sessions={unpinnedSessions}
            />
          </SidebarAccordionSection>
        )}
      </SidebarScrollArea>
    </div>
  );
}
