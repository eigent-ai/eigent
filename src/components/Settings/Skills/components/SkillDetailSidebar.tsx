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
  NavTab,
  SidebarBackHeader,
  SidebarNavGroup,
  SidebarScrollArea,
  SidebarSection,
  SidebarShell,
} from '@/components/Layout/AppSidebar';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { TooltipSimple } from '@/components/ui/tooltip';
import { Plus, Search, WandSparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filterSkillLibrary } from '../skillLibrary';
import { useSkillsLibrary } from '../SkillsProvider';

export default function SkillDetailSidebar({
  selectedSkillId,
  onBack,
  onSelectSkill,
}: {
  selectedSkillId: string;
  onBack: () => void;
  onSelectSkill: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { entries, openUpload, loading, pendingIds } = useSkillsLibrary();
  const [query, setQuery] = useState('');
  // Same matching as the overview's search box, which carries the same label.
  const visible = useMemo(
    () => filterSkillLibrary(entries, query, 'all'),
    [entries, query]
  );
  return (
    <SidebarShell ariaLabel={t('agents.library-title')} className="pt-0">
      <SidebarBackHeader
        onBack={onBack}
        action={
          <TooltipSimple
            content={t('agents.add-skill')}
            variant="instant"
            side="bottom"
          >
            <Button
              type="button"
              variant="primary"
              size="sm"
              buttonRadius="full"
              buttonContent="icon-only"
              onClick={openUpload}
              disabled={loading || pendingIds.size > 0}
              aria-label={t('agents.add-skill')}
            >
              <Plus aria-hidden />
            </Button>
          </TooltipSimple>
        }
      />
      <SidebarSection className="py-ds-8">
        <Input
          type="search"
          size="sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          leadingIcon={<DsIcon icon={Search} />}
          aria-label={t('agents.library-search')}
          placeholder={t('agents.library-search')}
        />
      </SidebarSection>
      <SidebarSection grow="fill">
        <SidebarScrollArea
          role="navigation"
          ariaLabel={t('agents.library-select-skill')}
          className="pt-ds-4"
        >
          <SidebarNavGroup>
            {visible.map((entry) => (
              <NavTab
                key={entry.id}
                active={entry.id === selectedSkillId}
                onClick={() => onSelectSkill(entry.id)}
                leading={<DsIcon icon={WandSparkles} />}
                label={
                  entry.kind === 'space'
                    ? `${entry.name} · ${entry.spaceName}`
                    : entry.name
                }
                tooltip={
                  entry.kind === 'space'
                    ? `${entry.name} · ${entry.spaceName}`
                    : entry.name
                }
                ariaLabel={
                  entry.kind === 'space'
                    ? `${entry.name} · ${entry.spaceName}`
                    : entry.name
                }
                ariaCurrentPage={entry.id === selectedSkillId}
              />
            ))}
            {visible.length === 0 && (
              <DsText
                as="p"
                role="meta"
                className="px-ds-12 py-ds-16 text-center text-ds-ink-muted-default"
              >
                {t('agents.library-no-results')}
              </DsText>
            )}
          </SidebarNavGroup>
        </SidebarScrollArea>
      </SidebarSection>
    </SidebarShell>
  );
}
