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
import type { ChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';
import { MessageCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function taskIdToCreatedMs(id: string): number {
  const n = parseInt(id.split('-')[0] ?? '', 10);
  return Number.isFinite(n) ? n : 0;
}

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
}

const MAX_SESSIONS = 3;

/**
 * When example prompts are hidden, show the three most recent started sessions
 * (same “started” filter as the sidebar session list).
 */
export function WorkspaceRecentSessions({
  tasks,
  activeTaskId,
  onSelectSession,
}: WorkspaceRecentSessionsProps) {
  const { t } = useTranslation();

  const sessions = useMemo(() => {
    const entries = Object.entries(tasks)
      .filter(([, task]) => {
        const hasStarted =
          (task.messages?.length || 0) > 0 ||
          task.hasMessages ||
          task.status !== ChatTaskStatus.PENDING;
        return hasStarted;
      })
      .map(([id, task]) => ({
        id,
        title:
          task.summaryTask?.trim() ||
          t('layout.sessions-untitled', { defaultValue: 'Untitled session' }),
        sortKey: taskIdToCreatedMs(id),
      }));

    entries.sort((a, b) => b.sortKey - a.sortKey);
    return entries.slice(0, MAX_SESSIONS);
  }, [tasks, t]);

  if (sessions.length === 0) {
    return null;
  }

  return (
    <div className="pb-4 mx-auto flex min-h-full w-full max-w-[600px] flex-col">
      <h2 className="text-ds-text-neutral-muted-default mb-3 px-3 text-body-sm font-semibold text-left">
        {t('layout.workspace-recent-sessions-heading', {
          defaultValue: 'Recent',
        })}
      </h2>
      <ul
        className="m-0 gap-0.5 p-0 flex w-full list-none flex-col"
        role="list"
      >
        {sessions.map((session) => {
          const active = activeTaskId === session.id;
          const timeLabel = formatSessionStartedAgo(session.sortKey, t);

          return (
            <li key={session.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={cn(
                  'no-drag min-w-0 h-10 gap-3 rounded-xl px-3 ease-out flex w-full items-center overflow-hidden text-left transition-opacity duration-200 outline-none',
                  active
                    ? 'bg-ds-bg-neutral-strong-default hover:opacity-80'
                    : 'hover:opacity-80',
                  'focus-visible:ring-ds-ring-neutral-default-focus focus-visible:ring-2 focus-visible:outline-none'
                )}
              >
                <MessageCircle
                  className="text-ds-icon-neutral-default-default h-4 w-4 shrink-0"
                  aria-hidden
                />
                <span className="text-ds-text-neutral-default-default min-w-0 text-body-sm font-medium flex-1 truncate">
                  {session.title}
                </span>
                {timeLabel ? (
                  <span className="text-ds-text-neutral-muted-default text-body-xs shrink-0 tabular-nums">
                    {timeLabel}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
