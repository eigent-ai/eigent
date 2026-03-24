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
    <div className="m-auto flex h-auto max-w-[940px] flex-col">
      <div className="px-6 flex h-auto w-full">
        <div className="top-20 w-40 pr-6 pt-8 sticky flex h-full flex-shrink-0 flex-grow-0 flex-col justify-between self-start">
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
            className="min-h-0 gap-0 h-full w-full flex-1"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
        </div>

        <div className="flex h-auto w-full flex-1 flex-col">
          <div className="gap-4 flex flex-col">
            {activeTab === 'cdp' && <CDP />}
            {activeTab === 'extension' && <Extension />}
            {activeTab === 'cookies' && <Cookies />}
          </div>
        </div>
      </div>
    </div>
  );
}
