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
import { useEffect, useRef, useState } from 'react';

export interface MentionAgent {
  id: string;
  label: string;
  description: string;
}

export const BUILTIN_AGENTS: MentionAgent[] = [
  {
    id: 'workforce',
    label: 'Workforce',
    description: 'Task decomposition & multi-agent collaboration',
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
}

export const MentionDropdown = ({
  visible,
  filter,
  onSelect,
  onClose,
}: MentionDropdownProps) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredAgents = BUILTIN_AGENTS.filter(
    (agent) =>
      agent.id.toLowerCase().includes(filter.toLowerCase()) ||
      agent.label.toLowerCase().includes(filter.toLowerCase())
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
        'absolute bottom-full left-0 z-50 mb-1 w-64',
        'rounded-lg border border-dropdown-border bg-dropdown-bg shadow-perfect',
        'max-h-[240px] overflow-auto py-1'
      )}
    >
      {filteredAgents.map((agent, index) => (
        <div
          key={agent.id}
          className={cn(
            'flex cursor-pointer flex-col gap-0.5 px-3 py-2 transition-colors',
            index === selectedIndex
              ? 'bg-dropdown-item-bg-hover'
              : 'hover:bg-dropdown-item-bg-hover'
          )}
          onMouseEnter={() => setSelectedIndex(index)}
          onMouseDown={(e) => {
            e.preventDefault(); // Prevent textarea blur
            onSelect(agent);
          }}
        >
          <span className="text-sm font-medium text-text-body">
            @{agent.id}
            <span className="ml-2 text-xs font-normal text-text-label">
              {agent.label}
            </span>
          </span>
          <span className="text-xs text-text-label">{agent.description}</span>
        </div>
      ))}
    </div>
  );
};
