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
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MentionAgentListIcon } from './MentionAgentIcons';

export interface MentionAgent {
  id: string;
  label: string;
  description: string;
}

/** Design tokens for @-mention agents (workforce = camel accent). */
export const AGENT_MENTION_THEME: Record<string, { chip: string }> = {
  workforce: {
    chip: 'border !border-border-camel/50 !bg-tag-fill-camel !text-text-camel hover:!bg-tag-surface-hover shadow-none',
  },
  browser: {
    chip: 'border !border-border-browser/50 !bg-tag-fill-browser !text-text-browser hover:!bg-tag-surface-hover shadow-none',
  },
  dev: {
    chip: 'border !border-border-developer/50 !bg-tag-fill-developer !text-text-developer hover:!bg-tag-surface-hover shadow-none',
  },
  doc: {
    chip: 'border !border-border-document/50 !bg-tag-fill-document !text-text-document hover:!bg-tag-surface-hover shadow-none',
  },
  media: {
    chip: 'border !border-border-multimodal/50 !bg-tag-fill-multimodal !text-text-multimodal hover:!bg-tag-surface-hover shadow-none',
  },
};

const DEFAULT_AGENT_THEME = {
  chip: 'border !border-input-border-default !bg-input-bg-input !text-text-body hover:!bg-surface-hover-subtle shadow-none',
};

export function getAgentMentionTheme(agentId: string) {
  return AGENT_MENTION_THEME[agentId] ?? DEFAULT_AGENT_THEME;
}

/** Shared shell for agent list (border, surface, shadow). Pair with overflow-* per host. */
export const MENTION_DROPDOWN_PANEL_CLASS =
  'text-popover-foreground w-48 border-input-border-default rounded-xl bg-input-bg-default p-1 shadow-md gap-1 z-50 border border-solid';

export const BUILTIN_AGENTS: MentionAgent[] = [
  {
    id: 'workforce',
    label: 'Workforce',
    description: 'Multi-agent coordination',
  },
  {
    id: 'browser',
    label: 'Browser Agent',
    description: 'Browser automation',
  },
  {
    id: 'dev',
    label: 'Developer Agent',
    description: 'Terminal & code execution',
  },
  {
    id: 'doc',
    label: 'Document Agent',
    description: 'Document processing',
  },
  {
    id: 'media',
    label: 'Multi Modal Agent',
    description: 'Image & video analysis',
  },
];

interface MentionDropdownProps {
  visible: boolean;
  filter: string;
  onSelect: (agent: MentionAgent) => void;
  onClose: () => void;
  /** When true, render as a plain list (e.g. inside Popover) instead of floating above a relative parent */
  inline?: boolean;
  /** Current agent (e.g. mention target): row shows check and selected background */
  selectedAgentId?: string | null;
}

export const MentionDropdown = ({
  visible,
  filter,
  onSelect,
  onClose,
  inline = false,
  selectedAgentId,
}: MentionDropdownProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filterLower = filter.toLowerCase();
  const filteredAgents = BUILTIN_AGENTS.filter(
    (agent) =>
      agent.id.toLowerCase().includes(filterLower) ||
      agent.label.toLowerCase().includes(filterLower) ||
      agent.description.toLowerCase().includes(filterLower)
  );

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Keyboard navigation
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) =>
          prev < filteredAgents.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredAgents.length - 1
        );
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredAgents.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(filteredAgents[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, filteredAgents, selectedIndex, onSelect, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (!visible || !listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, visible]);

  if (!visible || filteredAgents.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={cn(
        inline
          ? 'max-h-[280px] w-full overflow-x-hidden overflow-y-auto'
          : cn(
              MENTION_DROPDOWN_PANEL_CLASS,
              'left-0 mb-2 absolute bottom-full max-h-[280px] -translate-x-[8px] overflow-x-hidden overflow-y-auto'
            )
      )}
    >
      {filteredAgents.map((agent, index) => {
        const isValue = selectedAgentId != null && agent.id === selectedAgentId;
        const isKeyboardFocused = index === selectedIndex;
        return (
          <div
            key={agent.id}
            className={cn(
              // Match SelectItem / PopoverItem: pr-8 for check, menutabs hover / highlight
              'gap-2 rounded-xl py-1.5 pl-2 pr-8 text-sm hover:bg-menutabs-fill-hover focus-visible:bg-accent focus-visible:text-accent-foreground relative flex w-full cursor-pointer items-center transition-colors outline-none select-none',
              (isValue || isKeyboardFocused) && 'bg-menutabs-fill-hover'
            )}
            onMouseEnter={() => setSelectedIndex(index)}
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent textarea blur
              onSelect(agent);
            }}
          >
            <MentionAgentListIcon agentId={agent.id} />
            <span
              className={cn(
                'min-w-0 text-sm font-medium flex-1 truncate capitalize',
                agent.id === 'workforce' ? 'text-text-camel' : 'text-text-body'
              )}
            >
              {agent.id}
            </span>
            {isValue && (
              <span className="right-2 h-3.5 w-3.5 absolute flex shrink-0 items-center justify-center">
                <Check className="h-4 w-4" aria-hidden />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
