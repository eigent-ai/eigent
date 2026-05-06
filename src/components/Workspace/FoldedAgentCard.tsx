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
import {
  agentMap,
  WORKFLOW_AGENT_SUB_ICON_CLASS,
  type WorkflowAgentType,
} from '@/components/WorkFlow/agents';
import { getAgentToolkitLabels } from '@/components/WorkFlow/agentToolkitLabels';
import { BASE_WORKFLOW_AGENTS } from '@/components/WorkFlow/baseWorkers';
import { cn } from '@/lib/utils';
import {
  Bird,
  Bot,
  CodeXml,
  Copy,
  Ellipsis,
  FileText,
  Globe,
  Image,
  Pencil,
  Trash2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Sub icons aligned with `WorkforceMenu` / `ui/menu-button` → `MenuToggleItem` (top-right badge, 10px). */
function getWorkforceMenuStyleSubIcon(agentType: string): ReactNode {
  const key = agentType as WorkflowAgentType;
  const iconClass = WORKFLOW_AGENT_SUB_ICON_CLASS[key];
  if (!iconClass) return null;
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

function FoldedAgentLeadingIcon({ agentType }: { agentType: string }) {
  const subIcon = getWorkforceMenuStyleSubIcon(agentType);
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
    'rounded-xl bg-ds-bg-neutral-strong-default focus-within:ring-ds-ring-neutral-default-focus ease-in-out overflow-hidden transition-all duration-200 focus-within:ring-2',
    borderless ? 'border-0' : 'border border-solid',
    compactMode
      ? borderless
        ? cn('border-0', !isActive && 'opacity-80')
        : cn(
            'border-ds-border-neutral-default-default hover:border-ds-border-neutral-subtle-default',
            isActive &&
              (preset?.borderColor ??
                'border-ds-border-neutral-subtle-default'),
            !isActive && 'opacity-80'
          )
      : cn(
          borderless
            ? 'border-0'
            : 'border-transparent hover:border-transparent',
          !isActive && 'opacity-80'
        ),
    iconOnly ? 'inline-flex' : 'group relative w-full min-w-0 max-w-full',
    dimmed && (borderless ? 'opacity-50' : 'border-transparent opacity-50')
  );

  const expandedRow = (
    <div className="gap-md px-3 pb-2 pt-2 min-w-0 flex w-full max-w-full items-center">
      <FoldedAgentLeadingIcon agentType={agent.type} />
      <div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden">
        <div
          className={cn(
            'text-base font-bold leading-relaxed',
            preset?.textColor ?? 'text-ds-text-neutral-default-default'
          )}
        >
          {preset?.name ?? agent.name}
        </div>
        <div className="mt-0.5 min-h-4 min-w-0 w-full">
          <HoverScrollText
            text={toolkitLine}
            active={toolkitHovered}
            className="text-xs font-normal leading-tight text-ds-text-neutral-muted-default"
            innerClassName="text-xs font-normal leading-tight text-ds-text-neutral-muted-default"
          />
        </div>
      </div>
    </div>
  );

  const compactIconButtonClass = cn(
    shellClass,
    'focus-visible:ring-ds-ring-neutral-default-focus p-2 inline-flex items-center justify-center text-left focus-visible:ring-2 focus-visible:outline-none'
  );

  const button = iconOnly ? (
    compactContextMenu ? (
      <DropdownMenu>
        <TooltipSimple
          content={agentLabel}
          side="top"
          sideOffset={8}
          delayDuration={300}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={agentLabel}
              aria-haspopup="menu"
              className={compactIconButtonClass}
            >
              <FoldedAgentLeadingIcon agentType={agent.type} />
            </button>
          </DropdownMenuTrigger>
        </TooltipSimple>
        <DropdownMenuContent align="start" side="bottom" sideOffset={8}>
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            disabled={compactContextMenu.editEnabled === false}
            onSelect={(e) => {
              e.preventDefault();
              if (compactContextMenu.editEnabled !== false) {
                compactContextMenu.onEdit();
              }
            }}
          >
            <Pencil
              className="h-4 w-4 text-ds-icon-neutral-default-default shrink-0"
              aria-hidden
            />
            {t('workforce.edit', { defaultValue: 'Edit' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 cursor-pointer"
            disabled={compactContextMenu.duplicateEnabled === false}
            onSelect={(e) => {
              e.preventDefault();
              if (compactContextMenu.duplicateEnabled !== false) {
                compactContextMenu.onDuplicate();
              }
            }}
          >
            <Copy
              className="h-4 w-4 text-ds-icon-neutral-default-default shrink-0"
              aria-hidden
            />
            {t('workforce.duplicate', { defaultValue: 'Duplicate' })}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-ds-text-error-default-default cursor-pointer"
            disabled={compactContextMenu.deleteEnabled === false}
            onSelect={(e) => {
              e.preventDefault();
              if (compactContextMenu.deleteEnabled !== false) {
                compactContextMenu.onDelete();
              }
            }}
          >
            <Trash2
              className="h-4 w-4 text-ds-icon-error-default-default shrink-0"
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
        <FoldedAgentLeadingIcon agentType={agent.type} />
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
          'focus-visible:ring-ds-ring-neutral-default-focus min-w-0 flex w-full max-w-full flex-col bg-transparent text-left hover:bg-transparent focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:outline-none',
          'pr-9'
        )}
      >
        {expandedRow}
      </button>
      <div className="right-1 pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              onClick={(e) => e.stopPropagation()}
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="text-ds-text-neutral-muted-default shrink-0"
              aria-label={`More actions for ${agentLabel}`}
            >
              <Ellipsis className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default p-sm w-[98px] rounded-[12px] border border-solid"
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
                  className="gap-2 w-full justify-start"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteUserAgent?.(agent.agent_id);
                  }}
                >
                  <Trash2
                    size={16}
                    className="text-ds-icon-neutral-default-default group-hover:text-ds-icon-status-error-default-default"
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
        'focus-visible:ring-ds-ring-neutral-default-focus min-w-0 flex w-full max-w-full flex-col text-left focus-visible:ring-2 focus-visible:outline-none'
      )}
    >
      {expandedRow}
    </button>
  );

  if (iconOnly && !compactContextMenu) {
    return (
      <TooltipSimple
        content={agentLabel}
        side="top"
        sideOffset={8}
        delayDuration={300}
      >
        {button}
      </TooltipSimple>
    );
  }

  return button;
}
