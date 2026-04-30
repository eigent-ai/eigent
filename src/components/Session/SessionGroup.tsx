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
} from '@/components/PageSidebar/components/NavList';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { taskIdToCreatedMs } from '@/lib/chatTaskIdTime';
import { getSessionNavLeadPresentation } from '@/lib/sessionNavLead';
import { cn } from '@/lib/utils';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { ChatTaskStatus } from '@/types/constants';
import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export { default as SessionWorkspace } from '.';

type SessionsProps = {
  className?: string;
  tasks: ChatStore['tasks'];
  activeSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
};

export default function Sessions({
  className,
  tasks,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
}: SessionsProps) {
  const { t } = useTranslation();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const backToWorkspaceTooltip = t('layout.back-to-workspace-tooltip', {
    defaultValue: 'Back to workspace',
  });

  const sessions: NavListSession[] = useMemo(() => {
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
        sessionLead: getSessionNavLeadPresentation(task),
      }));
    entries.sort((a, b) => taskIdToCreatedMs(b.id) - taskIdToCreatedMs(a.id));
    return entries;
  }, [tasks, t]);

  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex h-full w-full flex-col overflow-hidden',
        className
      )}
    >
      <div className="gap-2 px-2 py-2 border-ds-border-neutral-subtle-default flex w-full shrink-0 items-center border-x-0 border-t-0 border-b-1 border-solid">
        <TooltipSimple content={backToWorkspaceTooltip}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setActiveWorkspaceTab('workforce')}
            className="no-drag text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default shrink-0"
            aria-label={backToWorkspaceTooltip}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
        <div className="text-ds-text-neutral-default-default min-w-0 gap-2 px-1 text-body-md font-bold flex flex-1 items-center">
          <span className="truncate">
            {t('layout.sessions-full-title', {
              defaultValue: 'All sessions',
            })}
          </span>
        </div>
      </div>
      <div className="m-0 min-h-0 gap-0.5 p-2 mx-auto flex w-full max-w-[800px] flex-1 flex-col overflow-y-auto">
        {sessions.length === 0 ? (
          <p className="text-ds-text-neutral-muted-default m-0 px-3 py-6 text-body-sm text-center">
            {t('layout.sessions-create-task-hint', {
              defaultValue: 'Create a task to start a session',
            })}
          </p>
        ) : (
          <NavListSessionRows
            sessions={sessions}
            activeSessionId={activeSessionId}
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
