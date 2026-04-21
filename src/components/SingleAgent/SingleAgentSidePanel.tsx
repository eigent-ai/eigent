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

import { AgentFolderSection } from '@/components/SidePanelSections/AgentFolderSection';
import { ContextSection } from '@/components/SidePanelSections/ContextSection';
import { ProgressSection } from '@/components/SidePanelSections/ProgressSection';
import { buildContextItems } from '@/components/SidePanelSections/buildContextItems';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export interface SingleAgentSidePanelProps {
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
}

export function SingleAgentSidePanel({
  isSidePanelVisible,
  onToggleSidePanel: _onToggleSidePanel,
}: SingleAgentSidePanelProps) {
  const { t } = useTranslation();
  const { chatStore } = useChatStoreAdapter();

  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : undefined;

  const agents = activeTask?.taskAssigning ?? [];
  const subtasks = agents[0]?.tasks ?? activeTask?.taskInfo ?? [];
  const files = activeTask?.fileList ?? [];
  const contextItems = useMemo(() => buildContextItems(agents), [agents]);

  if (!isSidePanelVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        'min-w-0 flex h-full w-full flex-col overflow-hidden',
        'relative'
      )}
    >
      <div className="gap-2 py-2 pl-2 pr-4 relative z-50 flex w-full shrink-0 items-center justify-between">
        <span className="text-ds-text-neutral-default-default px-1 text-body-md font-semibold truncate">
          {t('layout.workspace-session-single-agent')}
        </span>
      </div>

      <div className="gap-2 px-2 pb-2 min-h-0 min-w-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <ProgressSection
          title={t('layout.workforce-progress', { defaultValue: 'Progress' })}
          subtasks={subtasks}
        />
        <ContextSection
          title={t('layout.workforce-context', { defaultValue: 'Context' })}
          items={contextItems}
        />
        <AgentFolderSection
          title={t('layout.workforce-agent-folder', {
            defaultValue: 'Agent Folder',
          })}
          files={files}
        />
      </div>
    </div>
  );
}
