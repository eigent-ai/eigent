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
  NAV_LIST_SESSIONS_RECENT_MAX,
  NavListSessionRows,
  type NavListSession,
} from '@/components/PageSidebar/components/NavList';
import { taskIdToCreatedMs } from '@/lib/chatTaskIdTime';
import { getSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import type { ChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';
import { ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function formatSessionStartedAgo(
  startedAtMs: number,
  t: (key: string, o?: { count?: number; defaultValue: string }) => string
): string {
  if (!startedAtMs) {
    return '';
  }
  const d = Date.now() - startedAtMs;
  if (d < 60_000) {
    return t('layout.workspace-recent-session-now', { defaultValue: 'Now' });
  }
  if (d < 3600_000) {
    const m = Math.floor(d / 60_000);
    return t('layout.workspace-recent-session-minutes', {
      count: m,
      defaultValue: `${m} min`,
    });
  }
  if (d < 86400_000) {
    const h = Math.floor(d / 3600_000);
    return t('layout.workspace-recent-session-hours', {
      count: h,
      defaultValue: `${h}h`,
    });
  }
  const days = Math.floor(d / 86400_000);
  return t('layout.workspace-recent-session-days', {
    count: days,
    defaultValue: `${days}d`,
  });
}

export interface WorkspaceRecentSessionsProps {
  tasks: ChatStore['tasks'];
  activeTaskId: string | null;
  onSelectSession: (sessionId: string) => void;
  onOpenAllSessions: () => void;
}

/**
 * When example prompts are hidden, show the five most recent started sessions
 * (same row UI as the project sidebar, capped by {@link NAV_LIST_SESSIONS_RECENT_MAX}).
 */
export function WorkspaceRecentSessions({
  tasks,
  activeTaskId,
  onSelectSession,
  onOpenAllSessions,
}: WorkspaceRecentSessionsProps) {
  const { t } = useTranslation();

  const sessions: NavListSession[] = useMemo(() => {
    const entries = Object.entries(tasks)
      .filter(([, task]) => {
        const hasStarted =
          (task.messages?.length || 0) > 0 ||
          task.hasMessages ||
          task.status !== ChatTaskStatus.PENDING;
        return hasStarted;
      })
      .map(([id, task]) => {
        const startedMs = taskIdToCreatedMs(id);
        return {
          id,
          title:
            task.summaryTask?.trim() ||
            t('layout.sessions-untitled', { defaultValue: 'Untitled session' }),
          sessionLead: getSessionNavLeadPresentation(task),
          trailing: formatSessionStartedAgo(startedMs, t) || undefined,
        };
      });
    entries.sort((a, b) => taskIdToCreatedMs(b.id) - taskIdToCreatedMs(a.id));
    return entries;
  }, [tasks, t]);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="pb-4 mx-auto flex min-h-full w-full max-w-[600px] flex-col">
      <div className="text-ds-text-neutral-muted-default mb-3 gap-2 px-3 min-w-0 flex w-full items-center justify-between">
        <h2 className="min-w-0 text-body-sm font-semibold text-left">
          {t('layout.workspace-recent-sessions-heading', {
            defaultValue: 'Recent',
          })}
        </h2>
        <button
          type="button"
          onClick={onOpenAllSessions}
          className="text-ds-text-neutral-muted-default group text-body-sm font-medium gap-0.5 focus-visible:ring-ds-ring-neutral-default-focus focus-visible:rounded inline-flex shrink-0 items-center transition-colors outline-none hover:underline focus-visible:ring-2"
        >
          {t('layout.sessions-full-title', {
            defaultValue: 'All sessions',
          })}
          <span
            className="max-w-0 ease-out group-hover:max-w-4 inline-flex overflow-hidden transition-[max-width] duration-200"
            aria-hidden
          >
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </span>
        </button>
      </div>
      <div className="m-0 min-h-0 gap-0.5 p-0 flex w-full flex-col">
        <NavListSessionRows
          sessions={sessions}
          activeSessionId={activeTaskId}
          onSessionClick={onSelectSession}
          folded={false}
          maxItems={NAV_LIST_SESSIONS_RECENT_MAX}
          panelListHover
          showRowMenu={false}
        />
      </div>
    </div>
  );
}
