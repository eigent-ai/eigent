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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useWorkerList } from '@/store/authStore';
import type { SkillScope } from '@/store/skillsStore';
import { Check, ChevronDown, Globe, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Default agent types that are always available
const DEFAULT_AGENTS = [
  'Developer Agent',
  'Browser Agent',
  'Multi-modal Agent',
  'Document Agent',
];

// Special identifier for Global option
const GLOBAL_OPTION = '__GLOBAL__';

interface SkillScopeSelectProps {
  scope: SkillScope;
  onChange: (scope: SkillScope) => void;
  disabled?: boolean;
}

export default function SkillScopeSelect({
  scope,
  onChange,
  disabled = false,
}: SkillScopeSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const workerList = useWorkerList();

  // Combine default agents with user-configured workers
  // New workers will automatically appear since workerList is reactive
  const allAgents = useMemo(() => {
    const workerNames = workerList.map((w) => w.name);
    // Combine default agents with workers, avoiding duplicates
    const combined = [...DEFAULT_AGENTS];
    workerNames.forEach((name) => {
      if (!combined.includes(name)) {
        combined.push(name);
      }
    });
    return combined;
  }, [workerList]);

  // Handle toggle for any option (including Global)
  const handleToggle = (optionName: string) => {
    if (optionName === GLOBAL_OPTION) {
      // Toggle Global
      onChange({
        isGlobal: !scope.isGlobal,
        selectedAgents: scope.selectedAgents,
      });
    } else {
      // Toggle agent
      const isSelected = scope.selectedAgents.includes(optionName);
      let newSelectedAgents: string[];

      if (isSelected) {
        newSelectedAgents = scope.selectedAgents.filter(
          (a) => a !== optionName
        );
      } else {
        newSelectedAgents = [...scope.selectedAgents, optionName];
      }

      onChange({
        isGlobal: scope.isGlobal,
        selectedAgents: newSelectedAgents,
      });
    }
  };

  const getDisplayText = () => {
    const selections: string[] = [];

    if (scope.isGlobal) {
      selections.push(t('capabilities.global'));
    }

    selections.push(...scope.selectedAgents);

    if (selections.length === 0) {
      return t('capabilities.select-scope');
    }
    if (selections.length === 1) {
      return selections[0];
    }
    return `${selections.length} ${t('capabilities.selected')}`;
  };

  const hasSelection = scope.isGlobal || scope.selectedAgents.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-xs text-text-label">
        {t('capabilities.skill-scope')}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className="min-w-[120px] justify-between gap-2 text-text-body"
          >
            {hasSelection ? (
              <Users className="h-4 w-4 text-icon-secondary" />
            ) : (
              <Globe className="h-4 w-4 text-icon-secondary" />
            )}
            <span className="flex-1 truncate text-left">
              {getDisplayText()}
            </span>
            <ChevronDown className="h-4 w-4 text-icon-secondary" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-56 rounded-xl border border-solid border-dropdown-border bg-dropdown-bg p-sm"
        >
          <div className="flex flex-col gap-1">
            {/* Global Option - same level as agents */}
            <button
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm transition-colors ${
                scope.isGlobal
                  ? 'bg-dropdown-item-bg-active text-text-heading'
                  : 'text-text-body hover:bg-dropdown-item-bg-hover'
              }`}
              onClick={() => handleToggle(GLOBAL_OPTION)}
            >
              <Globe className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{t('capabilities.global')}</span>
              {scope.isGlobal && <Check className="h-4 w-4 flex-shrink-0" />}
            </button>

            {/* Agent/Worker List - Multi-select, same level as Global */}
            {allAgents.map((agentName) => {
              const isSelected = scope.selectedAgents.includes(agentName);
              return (
                <button
                  key={agentName}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm transition-colors ${
                    isSelected
                      ? 'bg-dropdown-item-bg-active text-text-heading'
                      : 'text-text-body hover:bg-dropdown-item-bg-hover'
                  }`}
                  onClick={() => handleToggle(agentName)}
                >
                  <span className="flex-1 truncate">{agentName}</span>
                  {isSelected && <Check className="h-4 w-4 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
