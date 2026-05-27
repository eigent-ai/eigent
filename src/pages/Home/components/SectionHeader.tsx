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

import SearchInput from '@/components/Dashboard/SearchInput';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutGrid, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from '../context';

type SectionHeaderProps = {
  title: string;
  searchPlaceholder: string;
};

export default function SectionHeader({
  title,
  searchPlaceholder,
}: SectionHeaderProps) {
  const { t } = useTranslation();
  const { viewMode, setViewMode, searchQuery, setSearchQuery } = useHomeHub();

  return (
    <div className="pb-6 pt-8 pl-6 flex w-full items-center justify-between">
      <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
        {title}
      </div>
      <div className="gap-2 flex items-center">
        <SearchInput
          variant="icon"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={searchPlaceholder}
        />
        <Tabs
          value={viewMode}
          onValueChange={(value) => setViewMode(value as 'grid' | 'list')}
        >
          <TabsList>
            <TabsTrigger value="grid">
              <div className="gap-1 text-label-sm flex items-center">
                <LayoutGrid size={16} />
                <span>{t('dashboard.grid')}</span>
              </div>
            </TabsTrigger>
            <TabsTrigger value="list">
              <div className="gap-1 text-label-sm flex items-center">
                <List size={16} />
                <span>{t('dashboard.list')}</span>
              </div>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
