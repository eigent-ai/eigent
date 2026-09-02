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
import { DsIcon } from '@/components/ui/ds-icon';
import { Input } from '@/components/ui/input';
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
      <SidebarBackHeader onBack={onBack} label={t('agents.library-back')} />
      <SidebarSection grow="fill">
        <SidebarScrollArea
          role="navigation"
          ariaLabel={t('agents.library-select-skill')}
          className="gap-ds-12 pt-ds-4"
        >
          <div className="px-ds-8">
            <Input
              type="search"
              size="sm"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              leadingIcon={<Search />}
              aria-label={t('agents.library-search')}
              placeholder={t('agents.library-search')}
            />
          </div>
          <SidebarNavGroup>
            <NavTab
              active={false}
              onClick={openUpload}
              disabled={loading || pendingIds.size > 0}
              leading={<DsIcon icon={Plus} />}
              label={t('agents.add-skill')}
            />
          </SidebarNavGroup>
          <SidebarNavGroup label={t('agents.skills')}>
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
          </SidebarNavGroup>
        </SidebarScrollArea>
      </SidebarSection>
    </SidebarShell>
  );
}
