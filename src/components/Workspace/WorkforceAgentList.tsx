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
  onEditWorkerFromMenu: (agent: Agent) => void;
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
  onEditWorkerFromMenu,
  onDuplicateUserAgent,
  onDeleteUserAgent,
  onAddWorker,
}: WorkforceAgentListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex w-full min-w-0 justify-center">
      <div className="inline-flex min-w-0 max-w-full items-center gap-2">
        <div
          role="list"
          aria-label={t('layout.aiWorkforce')}
          className="min-w-0 max-w-[min(100%,calc(100vw-3rem))] overflow-x-auto"
        >
          <div className="flex flex-row flex-nowrap items-center justify-center gap-2">
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
                    onEdit: () => onEditWorkerFromMenu(agent),
                    onDuplicate: () => onDuplicateUserAgent(agent),
                    onDelete: () => onDeleteUserAgent(agent.agent_id),
                    editEnabled: !isBaseWorkflowAgent(agent),
                    duplicateEnabled: !isBaseWorkflowAgent(agent),
                    deleteEnabled: !isBaseWorkflowAgent(agent),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col justify-center">
          <TooltipSimple content={t('triggers.add')} side="top" sideOffset={8}>
            <button
              type="button"
              className={cn(
                'rounded-xl border-0 bg-ds-bg-neutral-default-default',
                'inline-flex items-center justify-center p-2',
                'text-ds-text-neutral-muted-default transition-all duration-200',
                'opacity-80 hover:text-ds-text-neutral-default-default hover:opacity-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus'
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
