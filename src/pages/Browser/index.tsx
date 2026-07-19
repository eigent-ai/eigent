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
  HISTORY_VERTICAL_SIDEBAR_CLASSNAME,
  type VerticalNavItem,
} from '@/components/Dashboard/VerticalNav';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import CDP from './CDP';
import Cookies from './Cookies';
import Extension from './Extension';

const BROWSER_SECTIONS = ['cdp', 'extension', 'cookies'] as const;
type BrowserSection = (typeof BROWSER_SECTIONS)[number];

function isBrowserSection(value: string | null): value is BrowserSection {
  return value !== null && BROWSER_SECTIONS.includes(value as BrowserSection);
}

export default function Browser() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionFromUrl = searchParams.get('browserSection');
  const [activeTab, setActiveTab] = useState<BrowserSection>(() =>
    isBrowserSection(sectionFromUrl) ? sectionFromUrl : 'cdp'
  );

  useEffect(() => {
    if (searchParams.get('browserAction') === 'launch') {
      setActiveTab('cdp');
    }
  }, [searchParams]);

  useEffect(() => {
    if (!isBrowserSection(sectionFromUrl)) return;
    setActiveTab(sectionFromUrl);
    const next = new URLSearchParams(searchParams);
    next.delete('browserSection');
    setSearchParams(next, { replace: true });
  }, [sectionFromUrl, searchParams, setSearchParams]);

  const menuItems = [
    {
      id: 'cdp',
      name: t('layout.browser-connections'),
    },
    {
      id: 'extension',
      name: t('layout.browser-plugins'),
    },
    {
      id: 'cookies',
      name: t('layout.browser-cookie'),
    },
  ];

  const handleTabChange = (tabId: string) => {
    if (isBrowserSection(tabId)) setActiveTab(tabId);
  };

  return (
    <div className="flex h-auto w-full">
      <div className={HISTORY_VERTICAL_SIDEBAR_CLASSNAME}>
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
          {activeTab === 'cdp' && <CDP />}
          {activeTab === 'extension' && <Extension />}
          {activeTab === 'cookies' && <Cookies />}
        </div>
      </div>
    </div>
  );
}
