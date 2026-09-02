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
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { Ellipsis, MessageSquare, Settings, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { SkillLibraryEntry } from '../skillLibrary';
import { useSkillsLibrary } from '../SkillsProvider';

export function spaceSkillSettingsUrl(spaceId: string) {
  return `/home?section=spaces&spaceId=${encodeURIComponent(spaceId)}&spaceTab=workspace-profile`;
}
export default function SkillActions({ entry }: { entry: SkillLibraryEntry }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projectStore } = useChatStoreAdapter();
  const { setDeleteTarget, loading, pendingIds } = useSkillsLibrary();
  // Only this row's own in-flight save blocks it; a save on another skill
  // must not grey out every menu in the table.
  const disabled =
    loading || (entry.kind !== 'space' && pendingIds.has(entry.skill.id));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          disabled={disabled}
          aria-label={t('agents.library-actions', { name: entry.name })}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entry.kind === 'space' ? (
          <DropdownMenuItem
            onSelect={() => navigate(spaceSkillSettingsUrl(entry.spaceId))}
          >
            <Settings />
            {t('agents.library-manage-profile')}
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem
              disabled={disabled || !entry.skill.enabled}
              onSelect={() => {
                projectStore?.createProject('new project');
                navigate(
                  `/?skill_prompt=${encodeURIComponent(t('agents.try-skill-prompt', { name: entry.name }))}`
                );
              }}
            >
              <MessageSquare />
              {t('agents.try-in-chat')}
            </DropdownMenuItem>
            {entry.kind === 'global' && (
              <DropdownMenuItem
                className="text-ds-text-error-default-default"
                disabled={disabled}
                onSelect={() => setDeleteTarget(entry.skill)}
              >
                <Trash2 />
                {t('agents.delete-skill')}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
