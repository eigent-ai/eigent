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

import { SidePanelAccordionBox } from '@/components/Session/SidePanelAccordionBox';
import { SidePanelListRow } from '@/components/SidePanelSections/primitives';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { Bird, Bot, CodeXml, FileText, Globe, Image } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';

function hasWork(agent: Agent) {
  return Array.isArray(agent.tasks) && agent.tasks.length > 0;
}

/**
 * Mirrors `Workspace/index.tsx` ordering: agents with assigned tasks come
 * first, preserving their insertion order within each bucket. No live-progress
 * rotation; order only changes when an agent gets its first task.
 */
function sortByAssigned(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aHas = hasWork(a);
    const bHas = hasWork(b);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return 0;
  });
}

/**
 * Same sub-icon style as `Workspace/FoldedAgentCard.tsx` —
 * 10px colored lucide icon used as a top-right badge on the `Bot` tile.
 */
function getAgentSubIcon(agentType: string): ReactNode {
  const key = agentType as WorkflowAgentType;
  const preset = agentMap[key];
  if (!preset) return null;
  const iconClass = cn('!h-[10px] !w-[10px] shrink-0', preset.textColor);
  switch (key) {
    case 'developer_agent':
      return <CodeXml className={iconClass} />;
    case 'browser_agent':
      return <Globe className={iconClass} />;
    case 'document_agent':
      return <FileText className={iconClass} />;
    case 'multi_modal_agent':
      return <Image className={iconClass} />;
    case 'social_media_agent':
      return <Bird className={iconClass} />;
    default:
      return null;
  }
}

function AgentLeadingIcon({ agentType }: { agentType: string }) {
  const subIcon = getAgentSubIcon(agentType);
  return (
    <div className="h-6 w-6 text-ds-text-neutral-muted-default relative inline-flex shrink-0 items-center justify-center self-center">
      <Bot className="h-6 w-6" strokeWidth={2} aria-hidden />
      {subIcon != null && (
        <span className="-right-1 -top-1 absolute inline-flex items-center justify-center [&_svg]:shrink-0">
          {subIcon}
        </span>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const display = agentMap[agent.type as WorkflowAgentType];
  const active = hasWork(agent);
  const name = display?.name ?? agent.name;

  return (
    <SidePanelListRow
      leading={<AgentLeadingIcon agentType={agent.type} />}
      disabled={!active}
    >
      {name}
    </SidePanelListRow>
  );
}

interface AgentPoolSectionProps {
  title: string;
  agents: Agent[];
}

export function AgentPoolSection({ title, agents }: AgentPoolSectionProps) {
  const ordered = useMemo(() => sortByAssigned(agents), [agents]);
  const activeAgents = useMemo(() => ordered.filter(hasWork), [ordered]);

  const emptyState = (
    <div className="text-ds-text-neutral-muted-default text-body-sm px-1 py-1">
      No agents yet
    </div>
  );

  const collapsedPreview =
    activeAgents.length > 0 ? (
      <ul className="p-0 m-0 space-y-0.5 list-none">
        <AnimatePresence initial={false}>
          {activeAgents.map((agent) => (
            <motion.li
              key={agent.agent_id}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <AgentRow agent={agent} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    ) : null;

  return (
    <SidePanelAccordionBox title={title} collapsedPreview={collapsedPreview}>
      {ordered.length === 0 ? (
        emptyState
      ) : (
        <ul className="p-0 m-0 space-y-0.5 list-none">
          <AnimatePresence initial={false}>
            {ordered.map((agent) => (
              <motion.li
                key={agent.agent_id}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              >
                <AgentRow agent={agent} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </SidePanelAccordionBox>
  );
}
