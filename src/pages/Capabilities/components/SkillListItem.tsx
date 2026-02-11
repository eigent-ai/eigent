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
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { Ellipsis, MessageSquare, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import SkillScopeSelect from './SkillScopeSelect';

interface SkillListItemProps {
  skill: Skill;
  onDelete: () => void;
}

export default function SkillListItem({ skill, onDelete }: SkillListItemProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toggleSkill, updateSkill } = useSkillsStore();
  const { projectStore } = useChatStoreAdapter();

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

  const handleToggle = () => {
    toggleSkill(skill.id);
  };

  const handleScopeChange = (scope: {
    isGlobal: boolean;
    selectedAgents: string[];
  }) => {
    updateSkill(skill.id, { scope });
  };

  const handleTryInChat = () => {
    projectStore?.createProject('new project');
    const prompt = `I just added the {{${skill.name}}} skill for Eigent, can you make something amazing with this skill?`;
    navigate(`/?skill_prompt=${encodeURIComponent(prompt)}`);
  };

  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-2xl bg-surface-secondary p-4">
      {/* Left side: Status dot + Info */}
      <div className="flex min-w-0 flex-1 items-center gap-xs">
        {/* Status indicator dot */}
        <div
          className={`mx-xs h-3 w-3 flex-shrink-0 rounded-full ${
            skill.enabled ? 'bg-green-500' : 'bg-gray-400'
          }`}
        />
        {/* Name and description */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-base font-bold leading-7 text-text-primary">
            {skill.name}
          </span>
          <p className="truncate text-body-sm text-text-label">
            {skill.description}
          </p>
          <span className="mt-1 text-label-sm text-text-disabled">
            {t('capabilities.added')} {formatDate(skill.addedAt)}
          </span>
        </div>
      </div>

      {/* Right side: Controls */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {/* Scope Select */}
        <SkillScopeSelect
          scope={skill.scope}
          onChange={handleScopeChange}
          disabled={!skill.enabled}
        />

        {/* Enable/Disable Switch */}
        <Switch checked={skill.enabled} onCheckedChange={handleToggle} />

        {/* More Actions Menu (三个点) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Ellipsis className="h-4 w-4 text-icon-primary" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={handleTryInChat}>
              <MessageSquare className="h-4 w-4" />
              {t('capabilities.try-in-chat')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-text-cuation focus:text-text-cuation"
            >
              <Trash2 className="h-4 w-4" />
              {t('layout.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
