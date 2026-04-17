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

import { TooltipSimple } from '@/components/ui/tooltip';
import {
  FoldedAgentCard,
  isBaseWorkflowAgent,
} from '@/components/Workspace/FoldedAgentCard';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface WorkforceAgentListProps {
  sortedAgents: Agent[];
  activeAgentId: string | undefined;
  onSelectAgent: (agentId: string) => void;
  onAgentDetailFromMenu: (agentId: string) => void;
  onDuplicateUserAgent: (agent: Agent) => void;
  onDeleteUserAgent: (agentId: string) => void;
  onAddWorker: () => void;
}

/**
 * Workspace workforce mode: centered horizontal row of agents with add-worker.
 */
export function WorkforceAgentList({
  sortedAgents,
  activeAgentId,
  onSelectAgent,
  onAgentDetailFromMenu,
  onDuplicateUserAgent,
  onDeleteUserAgent,
  onAddWorker,
}: WorkforceAgentListProps) {
  const { t } = useTranslation();

  return (
    <div className="min-w-0 flex w-full justify-center">
      <div className="min-w-0 gap-2 inline-flex max-w-full items-center">
        <div
          role="list"
          aria-label={t('layout.aiWorkforce')}
          className="min-w-0 max-w-[min(100%,calc(100vw-3rem))] overflow-x-auto"
        >
          <div className="gap-2 flex flex-row flex-nowrap items-center justify-center">
            {sortedAgents.map((agent) => (
              <div key={agent.agent_id} className="shrink-0" role="listitem">
                <FoldedAgentCard
                  agent={agent}
                  isActive={activeAgentId === agent.agent_id}
                  dimmed={false}
                  compactMode
                  borderless
                  onSelect={() => onSelectAgent(agent.agent_id)}
                  showUserAgentOverflow={false}
                  compactContextMenu={{
                    onDetail: () => onAgentDetailFromMenu(agent.agent_id),
                    onDuplicate: () => onDuplicateUserAgent(agent),
                    onDelete: () => onDeleteUserAgent(agent.agent_id),
                    duplicateEnabled: !isBaseWorkflowAgent(agent),
                    deleteEnabled: !isBaseWorkflowAgent(agent),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col justify-center">
          <TooltipSimple
            content={t('triggers.add')}
            side="bottom"
            sideOffset={8}
            delayDuration={300}
          >
            <button
              type="button"
              className={cn(
                'rounded-xl bg-worker-surface-primary border-0',
                'p-2 inline-flex items-center justify-center',
                'text-text-secondary transition-all duration-200',
                'hover:text-text-heading opacity-80 hover:opacity-100',
                'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none'
              )}
              onClick={onAddWorker}
              aria-label={t('triggers.add')}
            >
              <Plus className="h-6 w-6 shrink-0" strokeWidth={2} aria-hidden />
            </button>
          </TooltipSimple>
        </div>
      </div>
    </div>
  );
}
