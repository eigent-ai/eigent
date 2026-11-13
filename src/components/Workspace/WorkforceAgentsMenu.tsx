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

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { TooltipSimple } from '@/components/ui/tooltip';
import { agentMap, type WorkflowAgentType } from '@/components/WorkFlow/agents';
import { AgentAvatar } from '@/components/Workspace/AgentAvatar';
import { isBaseWorkflowAgent } from '@/components/Workspace/FoldedAgentCard';
import { cn } from '@/lib/utils';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The name an agent shows everywhere: its preset name, else its own. */
export function workforceAgentLabel(agent: Agent): string {
  return agentMap[agent.type as WorkflowAgentType]?.name ?? agent.name;
}

/** Avatars shown overlapping in the trigger, like a people stack. */
const AGENT_STACK_LIMIT = 4;

export interface WorkforceAgentsMenuProps {
  agents: Agent[];
  onAddAgent: () => void;
  /** Opens the agent dialog to edit an agent the user created. */
  onEditAgent?: (agent: Agent) => void;
  /** Deletes an agent the user created. Default agents cannot be deleted. */
  onDeleteAgent?: (agent: Agent) => void;
  disabled?: boolean;
}

/**
 * Workforce composer control: the first agents' avatars stacked as circles
 * with the number of agents that will work on the task. It opens the list of available agents (scrolling past a fixed
 * height) and an "Add agent" action.
 */
export function WorkforceAgentsMenu({
  agents,
  onAddAgent,
  onEditAgent,
  onDeleteAgent,
  disabled = false,
}: WorkforceAgentsMenuProps) {
  const { t } = useTranslation();
  const count = agents.length;
  const listLabel = t('layout.workforce-agents', { defaultValue: 'Agents' });
  const triggerLabel = t('layout.workforce-agents-count', {
    count,
    defaultValue_one: '{{count}} agent',
    defaultValue_other: '{{count}} agents',
  });

  return (
    <DropdownMenu>
      <TooltipSimple content={triggerLabel} side="top">
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            data-workforce-agents-trigger
            variant="secondary"
            tone="information"
            size="sm"
            textWeight="semibold"
            buttonRadius="lg"
            disabled={disabled}
            aria-label={triggerLabel}
            className="group"
          >
            <span
              aria-hidden
              data-workforce-agent-stack
              className="flex items-center"
            >
              {agents.slice(0, AGENT_STACK_LIMIT).map((agent, index) => (
                <span
                  key={agent.agent_id}
                  className={cn(
                    // The ring matches the button fill, so each avatar reads
                    // as cut out of the one before it.
                    'flex size-5 shrink-0 overflow-hidden rounded-full ring-2 ring-ds-bg-information-subtle-default transition-[box-shadow] group-hover:ring-ds-bg-information-subtle-hover',
                    index > 0 && '-ml-1.5'
                  )}
                >
                  <AgentAvatar
                    agentType={agent.type}
                    agentName={agent.name}
                    fullBleed
                  />
                </span>
              ))}
            </span>
            <span className="tabular-nums">{count}</span>
          </Button>
        </DropdownMenuTrigger>
      </TooltipSimple>
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        avoidCollisions
        className="flex w-64 flex-col overflow-hidden"
      >
        <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-ds-text-meta font-semibold text-ds-ink-muted-default">
          {listLabel}
        </DropdownMenuLabel>
        <div
          role="group"
          aria-label={listLabel}
          data-workforce-agents-list
          className="scrollbar-always-visible flex max-h-60 min-h-0 flex-col overflow-y-auto"
        >
          {agents.map((agent) => (
            <div
              key={agent.agent_id}
              data-workforce-agent-row
              className="flex min-h-ds-control-lg items-center gap-2 rounded-ds-menu-row px-2 py-1.5 text-ds-text-base text-ds-ink-default-default"
            >
              <span
                aria-hidden
                className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-ds-compact-control"
              >
                <AgentAvatar
                  agentType={agent.type}
                  agentName={agent.name}
                  fullBleed
                />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {workforceAgentLabel(agent)}
              </span>
              {!isBaseWorkflowAgent(agent) && (onEditAgent || onDeleteAgent) ? (
                <AgentActions
                  agent={agent}
                  onEdit={onEditAgent}
                  onDelete={onDeleteAgent}
                />
              ) : null}
            </div>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onSelect={onAddAgent}>
          <DsIcon icon={Plus} aria-hidden />
          {t('layout.workforce-add-agent', { defaultValue: 'Add agent' })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Trailing "…" on an agent the user created: a submenu with Edit and Delete.
 * The default agents ship with the app and have neither.
 */
function AgentActions({
  agent,
  onEdit,
  onDelete,
}: {
  agent: Agent;
  onEdit?: (agent: Agent) => void;
  onDelete?: (agent: Agent) => void;
}) {
  const { t } = useTranslation();
  const name = workforceAgentLabel(agent);
  return (
    <DropdownMenuSub>
      <DropdownMenuPrimitive.SubTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          buttonContent="icon-only"
          data-workforce-agent-actions
          aria-label={t('layout.workforce-agent-actions', {
            name,
            defaultValue: 'Actions for {{name}}',
          })}
          className="shrink-0 data-[state=open]:bg-ds-neutral-default-hover"
        >
          <DsIcon icon={Ellipsis} recipe="main-compact" aria-hidden />
        </Button>
      </DropdownMenuPrimitive.SubTrigger>
      <DropdownMenuSubContent sideOffset={4} className="w-40">
        {onEdit ? (
          <DropdownMenuItem
            className="cursor-pointer"
            onSelect={() => onEdit(agent)}
          >
            <DsIcon icon={Pencil} aria-hidden />
            {t('layout.workforce-edit-agent', { defaultValue: 'Edit' })}
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <DropdownMenuItem
            className="cursor-pointer text-ds-text-error-default-default"
            onSelect={() => onDelete(agent)}
          >
            <DsIcon icon={Trash2} aria-hidden />
            {t('layout.workforce-delete-agent', { defaultValue: 'Delete' })}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
