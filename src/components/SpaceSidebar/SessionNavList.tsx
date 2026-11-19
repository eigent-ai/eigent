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

import { SidebarScrollArea } from '@/components/Layout/AppSidebar';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
  SessionNavListRows,
  type SessionNavItem,
  type SessionOpenInActions,
} from './SessionNavListRows';
import { SidebarAccordionSection } from './SidebarAccordionSection';

export {
  NAV_LIST_SESSIONS_RECENT_MAX,
  SessionNavListRows,
  type SessionNavItem,
  type SessionOpenInActions,
} from './SessionNavListRows';

export interface SessionNavListProps {
  sessions: SessionNavItem[];
  activeSessionId?: string | null;
  onSessionClick?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onEndSession?: (sessionId: string) => void;
  onPinSession?: (sessionId: string) => void;
  openIn?: SessionOpenInActions;
  className?: string;
}

/** Optional Pinned section, and Sessions section. */
export function SessionNavList({
  sessions,
  activeSessionId,
  onSessionClick,
  onDeleteSession,
  onEndSession,
  onPinSession,
  openIn,
  className,
}: SessionNavListProps) {
  const { t } = useTranslation();

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
    openIn,
    folded: false as const,
  };

  return (
    <div
      className={cn(
        'flex min-h-0 w-full min-w-0 flex-col overflow-y-clip',
        className
      )}
    >
      {/* Scrollable section list */}
      <SidebarScrollArea className="pb-1">
        {hasPinned && (
          <SidebarAccordionSection label={pinnedLabel} className="mt-0">
            <SessionNavListRows {...sharedRowProps} sessions={pinnedSessions} />
          </SidebarAccordionSection>
        )}
        {hasUnpinned && (
          <SidebarAccordionSection
            label={sessionsLabel}
            className={hasPinned ? undefined : 'mt-0'}
          >
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
