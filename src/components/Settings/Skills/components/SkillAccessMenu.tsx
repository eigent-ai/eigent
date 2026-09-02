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

import {
  buildSkillScopeAgentOptions,
  normalizeSkillScopeAgentId,
} from '@/components/WorkFlow/agents';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkerList } from '@/store/authStore';
import type { Skill } from '@/store/skillsStore';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSkillsLibrary } from '../SkillsProvider';
import SkillAccessTag from './SkillAccessTag';

export default function SkillAccessMenu({ skill }: { skill: Skill }) {
  const { t } = useTranslation();
  const workerList = useWorkerList();
  const options = buildSkillScopeAgentOptions(workerList);
  const { updateGlobal, pendingIds, loading } = useSkillsLibrary();
  const disabled = loading || pendingIds.has(skill.id);
  const selected = new Set(
    skill.scope.selectedAgents.map(normalizeSkillScopeAgentId)
  );
  const label = skill.scope.isGlobal
    ? t('agents.all-agents')
    : selected.size
      ? t('agents.library-agent-count', { count: selected.size })
      : t('agents.library-no-agents');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SkillAccessTag
          asChild
          allAgents={skill.scope.isGlobal}
          agentCount={selected.size}
        >
          <button
            type="button"
            disabled={disabled}
            aria-label={`${t('agents.library-agent-access', { name: skill.name })}: ${label}`}
          >
            {label}
            <ChevronDown aria-hidden />
          </button>
        </SkillAccessTag>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('agents.select-agent-access')}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={skill.scope.isGlobal}
          disabled={disabled}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) =>
            void updateGlobal(skill, {
              scope: { isGlobal: Boolean(checked), selectedAgents: [] },
            })
          }
        >
          {t('agents.all-agents')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {options.map((agent) => (
          <DropdownMenuCheckboxItem
            key={agent.value}
            disabled={disabled}
            checked={skill.scope.isGlobal || selected.has(agent.value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => {
              const next = new Set(
                skill.scope.isGlobal
                  ? options.map((item) => item.value)
                  : selected
              );
              if (checked) next.add(agent.value);
              else next.delete(agent.value);
              void updateGlobal(skill, {
                scope: { isGlobal: false, selectedAgents: [...next] },
              });
            }}
          >
            {agent.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
