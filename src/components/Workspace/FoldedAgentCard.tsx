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

import { AddWorker } from '@/components/AddWorker';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HoverScrollText } from '@/components/ui/HoverScrollText';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TooltipSimple } from '@/components/ui/tooltip';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { getAgentToolkitLabels } from '@/components/WorkFlow/agentToolkitLabels';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { AgentAvatar } from '@/components/Workspace/AgentAvatar';
import { cn } from '@/lib/utils';
import { Copy, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

function FoldedAgentLeadingIcon({
  agent,
  fullBleed = false,
}: {
  agent: Agent;
  fullBleed?: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center self-center',
        fullBleed ? 'size-full' : 'size-6'
      )}
    >
      <AgentAvatar
        agentType={agent.type}
        agentName={agent.name}
        fullBleed={fullBleed}
      />
    </div>
  );
}

export function isBaseWorkflowAgent(agent: Agent): boolean {
  return BASE_WORKFLOW_AGENTS.some((b) => b.agent_id === agent.agent_id);
}

export function FoldedAgentCard({
  agent,
  isActive,
  dimmed,
  compactMode,
  onSelect,
  showUserAgentOverflow,
  onDeleteUserAgent,
  borderless = false,
  compactContextMenu,
}: {
  agent: Agent;
  isActive: boolean;
  dimmed: boolean;
  compactMode: boolean;
  onSelect: () => void;
  showUserAgentOverflow?: boolean;
  onDeleteUserAgent?: (agentId: string) => void;
  /** No border (e.g. workspace grid). */
  borderless?: boolean;
  /** Compact icon card: click opens a menu instead of calling `onSelect` directly. */
  compactContextMenu?: {
    onEdit: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    editEnabled?: boolean;
    duplicateEnabled?: boolean;
    deleteEnabled?: boolean;
  };
}) {
  const { t } = useTranslation();
  const [toolkitHovered, setToolkitHovered] = useState(false);
  const toolkitLabels = getAgentToolkitLabels(agent);
  const toolkitLine = toolkitLabels.join('  ');
  const wfType = agent.type as WorkflowAgentType;
  const preset = agentMap[wfType];

  const iconOnly = compactMode;

  const agentLabel = preset?.name ?? agent.name;

  const shellClass = cn(
    'rounded-xl bg-ds-neutral-strong-default focus-within:ring-ds-ring-focus ease-[cubic-bezier(0.23,1,0.32,1)] overflow-hidden transition-[border-color,box-shadow,opacity] duration-200 focus-within:ring-2',
    borderless
      ? 'border-x-0 border-y-0 border-0'
      : 'border-x border-y border border-solid',
    compactMode
      ? borderless
        ? cn('border-x-0 border-y-0 border-0', !isActive && 'opacity-80')
        : cn(
            'border-ds-hairline-default-default hover:border-ds-hairline-subtle-default',
            isActive &&
              (preset?.borderColor ?? 'border-ds-hairline-subtle-default'),
            !isActive && 'opacity-80'
          )
      : cn(
          borderless
            ? 'border-x-0 border-y-0 border-0'
            : 'border-transparent hover:border-transparent',
          !isActive && 'opacity-80'
        ),
    iconOnly ? 'inline-flex' : 'group relative w-full min-w-0 max-w-full',
    dimmed && (borderless ? 'opacity-50' : 'border-transparent opacity-50')
  );

  const expandedRow = (
    <div className="flex w-full max-w-full min-w-0 items-center gap-md px-3 pt-2 pb-2">
      <FoldedAgentLeadingIcon agent={agent} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            'text-base leading-relaxed font-bold',
            preset?.textColor ?? 'text-ds-ink-default-default'
          )}
        >
          {preset?.name ?? agent.name}
        </div>
        <div className="mt-0.5 min-h-4 w-full min-w-0">
          <HoverScrollText
            text={toolkitLine}
            active={toolkitHovered}
            className="text-xs leading-tight font-normal text-ds-ink-muted-default"
            innerClassName="text-xs font-normal leading-tight text-ds-ink-muted-default"
          />
        </div>
      </div>
    </div>
  );

  const compactIconButtonClass = cn(
    shellClass,
    'focus-visible:ring-ds-ring-focus size-10 inline-flex items-center justify-center text-left focus-visible:ring-2 focus-visible:outline-none'
  );

  const button = iconOnly ? (
    compactContextMenu ? (
      <DropdownMenu>
        <TooltipSimple content={agentLabel} side="top" sideOffset={8}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={agentLabel}
              aria-haspopup="menu"
              className={compactIconButtonClass}
            >
              <FoldedAgentLeadingIcon agent={agent} fullBleed />
            </button>
          </DropdownMenuTrigger>
        </TooltipSimple>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8}>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            disabled={compactContextMenu.editEnabled === false}
            onSelect={(e) => {
              e.preventDefault();
              if (compactContextMenu.editEnabled !== false) {
                compactContextMenu.onEdit();
              }
            }}
          >
            <Pencil
              className="h-4 w-4 shrink-0 text-ds-ink-default-default"
              aria-hidden
            />
            {t('workforce.edit', { defaultValue: 'Edit' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            disabled={compactContextMenu.duplicateEnabled === false}
            onSelect={(e) => {
              e.preventDefault();
              if (compactContextMenu.duplicateEnabled !== false) {
                compactContextMenu.onDuplicate();
              }
            }}
          >
            <Copy
              className="h-4 w-4 shrink-0 text-ds-ink-default-default"
              aria-hidden
            />
            {t('workforce.duplicate', { defaultValue: 'Duplicate' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-ds-text-error-default-default"
            disabled={compactContextMenu.deleteEnabled === false}
            onSelect={(e) => {
              e.preventDefault();
              if (compactContextMenu.deleteEnabled !== false) {
                compactContextMenu.onDelete();
              }
            }}
          >
            <Trash2
              className="h-4 w-4 shrink-0 text-ds-icon-error-default-default"
              aria-hidden
            />
            {t('workforce.delete', { defaultValue: 'Delete' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <button
        type="button"
        onClick={onSelect}
        aria-label={agentLabel}
        className={compactIconButtonClass}
      >
        <FoldedAgentLeadingIcon agent={agent} fullBleed />
      </button>
    )
  ) : showUserAgentOverflow ? (
    <div
      className={shellClass}
      onMouseEnter={() => setToolkitHovered(true)}
      onMouseLeave={() => setToolkitHovered(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full max-w-full min-w-0 flex-col bg-transparent text-left hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:ring-offset-0 focus-visible:outline-none',
          'pr-9'
        )}
      >
        {expandedRow}
      </button>
      <div className="pointer-events-none absolute top-1/2 right-1 z-10 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              onClick={(e) => e.stopPropagation()}
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="shrink-0 text-ds-ink-muted-default"
              aria-label={t('layout.more-actions-for', {
                name: agentLabel,
                defaultValue: 'More actions for {{name}}',
              })}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[98px] rounded-[12px] border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-strong-default p-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <PopoverClose asChild>
                <AddWorker edit workerInfo={agent} />
              </PopoverClose>
              <PopoverClose asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteUserAgent?.(agent.agent_id);
                  }}
                >
                  <Trash2
                    size={16}
                    className="text-ds-ink-default-default group-hover:text-ds-icon-status-error-default-default"
                  />
                  Delete
                </Button>
              </PopoverClose>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  ) : (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setToolkitHovered(true)}
      onMouseLeave={() => setToolkitHovered(false)}
      className={cn(
        shellClass,
        'flex w-full max-w-full min-w-0 flex-col text-left focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none'
      )}
    >
      {expandedRow}
    </button>
  );

  if (iconOnly && !compactContextMenu) {
    return (
      <TooltipSimple content={agentLabel} side="top" sideOffset={8}>
        {button}
      </TooltipSimple>
    );
  }

  return button;
}
