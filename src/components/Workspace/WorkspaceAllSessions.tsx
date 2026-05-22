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
  NavListSessionRows,
  type NavListSession,
} from '@/components/ProjectPageSidebar/NavList';
import { taskIdToCreatedMs } from '@/lib/chatTaskIdTime';
import { getSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import type { ChatStore } from '@/store/chatStore';
import { ChatTaskStatus } from '@/types/constants';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface WorkspaceAllSessionsProps {
  tasks: ChatStore['tasks'];
  activeTaskId?: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export function WorkspaceAllSessions({
  tasks,
  activeTaskId,
  onSelectSession,
  onDeleteSession,
}: WorkspaceAllSessionsProps) {
  const { t } = useTranslation();

  const sessions: NavListSession[] = useMemo(() => {
    const entries = Object.entries(tasks)
      .filter(([, task]) => {
        return (
          (task.messages?.length || 0) > 0 ||
          task.hasMessages ||
          task.status !== ChatTaskStatus.PENDING
        );
      })
      .map(([id, task]) => ({
        id,
        title:
          task.summaryTask?.trim() ||
          t('layout.sessions-untitled', { defaultValue: 'Untitled session' }),
        sessionLead: getSessionNavLeadPresentation(task),
      }));
    entries.sort((a, b) => taskIdToCreatedMs(b.id) - taskIdToCreatedMs(a.id));
    return entries;
  }, [tasks, t]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <div className="m-0 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <p className="m-0 px-3 py-6 text-center text-body-sm text-ds-text-neutral-muted-default">
            {t('layout.sessions-create-task-hint')}
          </p>
        ) : (
          <NavListSessionRows
            sessions={sessions}
            activeSessionId={activeTaskId}
            onSessionClick={onSelectSession}
            onDeleteSession={onDeleteSession}
            folded={false}
            panelListHover
          />
        )}
      </div>
    </div>
  );
}
