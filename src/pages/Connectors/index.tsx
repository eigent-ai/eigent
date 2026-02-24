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

import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import MCP from './MCP';
import Search from './Search';

export default function Connectors() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('mcp');

  const menuItems: Array<{ id: string; name: string }> = [
    {
      id: 'search',
      name: t('layout.search'),
    },
    {
      id: 'mcp',
      name: t('setting.mcp'),
    },
  ];

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
  };

  return (
    <div className="m-auto flex h-auto max-w-[940px] flex-col">
      <div className="flex h-auto w-full px-6">
        <div className="sticky top-20 flex h-full w-40 flex-shrink-0 flex-grow-0 flex-col justify-between self-start pr-6 pt-8">
          <VerticalNavigation
            items={
              menuItems.map((menu) => ({
                value: menu.id,
                label: (
                  <span className="text-body-sm font-bold">{menu.name}</span>
                ),
              })) as VerticalNavItem[]
            }
            value={activeTab}
            onValueChange={handleTabChange}
            className="h-full min-h-0 w-full flex-1 gap-0"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
        </div>

        <div className="flex h-auto w-full flex-1 flex-col">
          <div className="flex flex-col gap-4">
            {activeTab === 'search' && <Search />}
            {activeTab === 'mcp' && <MCP />}
          </div>
        </div>
      </div>
    </div>
  );
}
