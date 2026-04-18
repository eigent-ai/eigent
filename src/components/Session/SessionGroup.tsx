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

export { default as SessionWorkspace } from '.';

type SessionsProps = {
  className?: string;
  tasks: ChatStore['tasks'];
  activeSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
};

export default function Sessions({
  className,
  tasks,
  activeSessionId,
  onSelectSession,
}: SessionsProps) {
  const { t } = useTranslation();

  const sessions = useMemo(
    () =>
      Object.entries(tasks)
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
        })),
    [tasks, t]
  );

  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex h-full w-full flex-col overflow-hidden',
        className
      )}
    >
      <div className="h-11 gap-2 px-2 flex w-full shrink-0 items-center justify-between">
        <div className="text-ds-text-neutral-default-default min-w-0 gap-2 px-1 text-body-md font-bold flex flex-1 items-center">
          <span className="truncate">
            {t('layout.sessions-full-title', {
              defaultValue: 'All sessions',
            })}
          </span>
        </div>
      </div>
      <ul
        className="m-0 min-h-0 gap-0.5 p-2 pb-3 mx-auto flex w-full max-w-[800px] flex-1 list-none flex-col overflow-y-auto"
        role="list"
      >
        {sessions.length === 0 ? (
          <li className="text-ds-text-neutral-muted-default px-3 py-6 text-body-sm text-center">
            {t('layout.sessions-create-task-hint', {
              defaultValue: 'Create a task to start a session',
            })}
          </li>
        ) : (
          sessions.map((session) => {
            const active = activeSessionId === session.id;

            return (
              <li key={session.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className={cn(
                    'no-drag min-w-0 h-10 gap-3 rounded-xl px-3 flex w-full items-center overflow-hidden text-left transition-colors outline-none',
                    active
                      ? 'bg-ds-bg-neutral-strong-default'
                      : 'hover:bg-ds-bg-neutral-strong-default/80',
                    'focus-visible:ring-ds-ring-neutral-default-focus focus-visible:ring-2 focus-visible:outline-none'
                  )}
                >
                  <MessageCircle
                    className="text-ds-icon-neutral-default-default h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  <span className="text-ds-text-neutral-muted-default min-w-0 text-body-sm font-medium flex-1 truncate">
                    {session.title}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
