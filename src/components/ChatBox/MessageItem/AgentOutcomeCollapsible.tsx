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

import { MentionAgentListIcon } from '@/components/ChatBox/BottomBox/MentionAgentIcons';
import {
  agentNameToMentionId,
  getAgentDisplayLabel,
} from '@/components/ChatBox/MentionRouting';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { AgentMessageCard } from './AgentMessageCard';

export interface AgentOutcomeCollapsibleProps {
  id: string;
  agentName?: string;
  content: string;
  attaches?: any[];
  defaultOpen?: boolean;
  onMarkdownRenderComplete?: () => void;
}

/** Final single-agent report: expand/collapse, no border or background on the shell. */
export function AgentOutcomeCollapsible({
  id,
  agentName,
  content,
  attaches,
  defaultOpen = true,
  onMarkdownRenderComplete,
}: AgentOutcomeCollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const label = getAgentDisplayLabel(agentName);
  const agentIconId = agentNameToMentionId(agentName) ?? 'workforce';

  return (
    <div className="rounded-lg px-1 overflow-hidden">
      <button
        type="button"
        className="gap-2 rounded-lg px-1 py-2 text-sm font-semibold text-text-heading hover:bg-surface-hover-subtle/90 active:bg-surface-hover-subtle focus-visible:ring-border-primary/40 flex w-full items-center text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => setIsOpen((v) => !v)}
      >
        <MentionAgentListIcon
          agentId={agentIconId}
          size={16}
          className="shrink-0"
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-icon-primary shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>

      <div
        className={`ease-in-out overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="px-0 py-1">
          <AgentMessageCard
            id={id}
            content={content}
            typewriter={false}
            onTyping={() => {}}
            onMarkdownRenderComplete={onMarkdownRenderComplete}
            attaches={attaches}
          />
        </div>
      </div>
    </div>
  );
}
