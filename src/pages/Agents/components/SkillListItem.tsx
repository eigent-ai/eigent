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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  agentMap,
  getWorkflowAgentDisplay,
  WORKFLOW_AGENT_LIST,
} from '@/components/WorkFlow/agents';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useWorkerList } from '@/store/authStore';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import {
  Bot,
  Check,
  ChevronRight,
  Ellipsis,
  MessageSquare,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface SkillListItemDefaultProps {
  variant?: 'default';
  skill: Skill;
  onDelete?: () => void;
  message?: never;
  addButtonText?: never;
  onAddClick?: never;
}

interface SkillListItemPlaceholderProps {
  variant: 'placeholder';
  skill?: never;
  onDelete?: never;
  message: string;
  addButtonText?: string;
  onAddClick?: () => void;
}

type SkillListItemProps =
  | SkillListItemDefaultProps
  | SkillListItemPlaceholderProps;

export default function SkillListItem(props: SkillListItemProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { updateSkill, toggleSkill } = useSkillsStore();
  const { projectStore } = useChatStoreAdapter();
  const workerList = useWorkerList();
  const [scopeOpen, setScopeOpen] = useState(false);

  const allAgents = useMemo(() => {
    const workflowNames = WORKFLOW_AGENT_LIST.map((a) => a.name);
    const workerNames = workerList.map((w) => w.name);
    const combined = [...workflowNames];
    workerNames.forEach((name) => {
      if (!combined.includes(name)) {
        combined.push(name);
      }
    });
    return combined.filter((name) => name !== agentMap.social_media_agent.name);
  }, [workerList]);

  if (props.variant === 'placeholder') {
    const isClickable = props.onAddClick != null;
    return (
      <div
        role={isClickable ? 'button' : undefined}
        tabIndex={isClickable ? 0 : undefined}
        className={`focus-visible:ring-ring flex w-full flex-col flex-wrap items-center justify-center gap-3 rounded-2xl bg-surface-primary px-6 py-8 transition-colors focus:outline-none focus-visible:ring-2 ${isClickable ? 'cursor-pointer hover:bg-surface-tertiary' : ''}`}
        onClick={isClickable ? props.onAddClick : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  props.onAddClick?.();
                }
              }
            : undefined
        }
        aria-label={isClickable ? props.addButtonText : undefined}
      >
        <p className="text-body-sm text-text-label">{props.message}</p>
        {isClickable && <Plus className="h-4 w-4 text-icon-primary" />}
      </div>
    );
  }

  const { skill, onDelete } = props;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) {
      return t('layout.today');
    } else if (diffDays === 1) {
      return t('layout.yesterday');
    } else if (diffDays < 30) {
      return `${diffDays} ${t('layout.days-ago')}`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const handleScopeChange = (scope: {
    isGlobal: boolean;
    selectedAgents: string[];
  }) => {
    updateSkill(skill.id, { scope });
  };

  const isAllAgentsSelected = skill.scope.isGlobal;

  const handleToggleAllAgents = () => {
    if (isAllAgentsSelected) {
      // When user unselects "All agents", clear all individual selections
      handleScopeChange({
        isGlobal: false,
        selectedAgents: [],
      });
    } else {
      // When user selects "All agents", use empty array to indicate ALL agents (including future ones)
      handleScopeChange({
        isGlobal: true,
        selectedAgents: [], // Empty array = all agents, including future agents
      });
    }
  };

  const handleToggleAgent = (agentName: string) => {
    if (isAllAgentsSelected) {
      const newSelectedAgents = allAgents.filter((a) => a !== agentName);
      handleScopeChange({
        isGlobal: false,
        selectedAgents: newSelectedAgents,
      });
      return;
    }

    const isSelected = skill.scope.selectedAgents.includes(agentName);
    const newSelectedAgents = isSelected
      ? skill.scope.selectedAgents.filter((a) => a !== agentName)
      : [...skill.scope.selectedAgents, agentName];
    handleScopeChange({
      isGlobal: false,
      selectedAgents: newSelectedAgents,
    });
  };

  const handleTryInChat = () => {
    projectStore?.createProject('new project');
    const prompt = `I just added the {{${skill.name}}} skill for Eigent, can you make something amazing with this skill?`;
    navigate(`/?skill_prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div
      className={`w-full flex-1 flex-col justify-between rounded-2xl bg-surface-tertiary p-4 transition-colors ${skill.isExample && !skill.enabled ? 'opacity-50' : ''}`}
    >
      {/* Row 1: Name / Actions */}
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-body-base truncate font-bold text-text-heading">
            {skill.name}
          </span>
        </div>

        <div className="flex flex-shrink-0 items-center gap-md">
          <Switch
            checked={skill.enabled}
            onCheckedChange={() => toggleSkill(skill.id)}
          />
          <TooltipSimple content={t('agents.try-in-chat')}>
            <Button
              variant="ghost"
              size="icon"
              disabled={!skill.enabled}
              onClick={skill.enabled ? handleTryInChat : undefined}
            >
              <MessageSquare className="h-4 w-4 text-icon-primary" />
            </Button>
          </TooltipSimple>
          {!skill.isExample && onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Ellipsis className="h-4 w-4 text-icon-primary" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-text-cuation focus:text-text-cuation"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('layout.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Row 2: Description - 5 lines max, hover shows full */}
      <TooltipSimple
        content={skill.description}
        className="max-w-sm whitespace-pre-wrap break-words"
      >
        <div className="w-full cursor-default">
          <p className="line-clamp-5 overflow-hidden break-words text-body-sm text-text-label">
            {skill.description}
          </p>
        </div>
      </TooltipSimple>

      {/* Row 3: Added time / Skill scope */}
      <div className="flex flex-col items-start gap-2">
        <Button
          variant="ghost"
          size="sm"
          className={`px-0 focus:ring-0 ${scopeOpen ? 'opacity-100' : 'opacity-50'}`}
          onClick={() => setScopeOpen((prev) => !prev)}
        >
          Select agent access
          <ChevronRight
            className={`h-4 w-4 ${scopeOpen ? '-rotate-90' : ''}`}
          />
        </Button>

        {scopeOpen && (
          <div className="flex w-full flex-wrap items-center gap-2 border-x-0 border-b-0 border-t-[0.5px] border-solid border-border-secondary pt-4">
            {/* All agents as first tab; then each agent toggle */}
            <button
              type="button"
              onClick={handleToggleAllAgents}
              className={`inline-flex items-center gap-2 rounded-full bg-surface-primary px-2 py-1 text-label-xs font-medium text-text-primary transition-opacity hover:opacity-100 [&>svg]:shrink-0 ${
                isAllAgentsSelected
                  ? 'opacity-100 [&>svg]:text-icon-success'
                  : 'opacity-60 [&>svg]:text-inherit'
              }`}
            >
              {isAllAgentsSelected ? (
                <Check size={16} className="shrink-0" />
              ) : (
                <Users size={16} className="shrink-0" />
              )}
              All Agents
            </button>

            {allAgents.map((agentName) => {
              const isSelected =
                isAllAgentsSelected ||
                skill.scope.selectedAgents.includes(agentName);
              const display = getWorkflowAgentDisplay(agentName);
              const icon = display?.icon ?? (
                <Bot size={16} className="shrink-0 text-inherit" />
              );
              return (
                <button
                  key={agentName}
                  type="button"
                  onClick={() => handleToggleAgent(agentName)}
                  className={`inline-flex items-center gap-2 rounded-full bg-surface-primary px-2 py-1 text-label-xs font-medium text-text-primary transition-opacity hover:opacity-100 [&>svg]:shrink-0 ${
                    isSelected
                      ? 'opacity-100 [&>svg]:text-icon-success'
                      : 'opacity-50 [&>svg]:text-inherit'
                  }`}
                >
                  {isSelected ? <Check size={16} className="shrink-0" /> : icon}
                  {agentName}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
