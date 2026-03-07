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

import logoBlack from '@/assets/logo/logo_black.png';
import logoWhite from '@/assets/logo/logo_white.png';
import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Navigation';
import useAppVersion from '@/hooks/use-app-version';
import General from '@/pages/Setting/General';
import HumanInTheLoop from '@/pages/Setting/HumanInTheLoop';
import Privacy from '@/pages/Setting/Privacy';
import { useAuthStore } from '@/store/authStore';
import { Fingerprint, Settings, ShieldCheck, TagIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Setting() {
  const navigate = useNavigate();
  const location = useLocation();
  const version = useAppVersion();
  const { appearance } = useAuthStore();
  const { t } = useTranslation();
  const logoSrc = appearance === 'dark' ? logoWhite : logoBlack;
  // Setting menu configuration
  const settingMenus = [
    {
      id: 'general',
      name: t('setting.general'),
      icon: Settings,
      path: '/setting/general',
    },
    {
      id: 'human-in-the-loop',
      name: t('setting.human-in-the-loop'),
      icon: ShieldCheck,
      path: '/setting/human-in-the-loop',
    },
    {
      id: 'privacy',
      name: t('setting.privacy'),
      icon: Fingerprint,
      path: '/setting/privacy',
    },
  ];
  // Initialize tab from URL once, then manage locally without routing
  const getCurrentTab = () => {
    const path = location.pathname;
    const tabFromUrl = path.split('/setting/')[1] || 'general';
    return settingMenus.find((menu) => menu.id === tabFromUrl)?.id || 'general';
  };

  const [activeTab, setActiveTab] = useState(getCurrentTab);

  // Switch tabs locally (no navigation)
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
  };

  // Close settings page
  const _handleClose = () => {
    navigate('/');
  };

  return (
    <div className="m-auto flex h-auto max-w-[940px] flex-col">
      <div className="px-6 flex h-auto w-full">
        <div className="top-20 w-40 pr-6 pt-8 sticky flex h-full flex-shrink-0 flex-grow-0 flex-col justify-between self-start">
          <VerticalNavigation
            items={
              settingMenus.map((menu) => {
                return {
                  value: menu.id,
                  label: (
                    <span className="text-body-sm font-bold">{menu.name}</span>
                  ),
                };
              }) as VerticalNavItem[]
            }
            value={activeTab}
            onValueChange={handleTabChange}
            className="min-h-0 gap-0 h-full w-full flex-1"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
          <div className="mt-4 gap-4 border-border-secondary py-4 flex w-full flex-shrink-0 flex-grow-0 flex-col items-center justify-center border-x-0 border-t-[0.5px] border-b-0 border-solid">
            <button
              onClick={() =>
                window.open(
                  'https://github.com/eigent-ai/eigent',
                  '_blank',
                  'noopener,noreferrer'
                )
              }
              className="gap-2 rounded-lg bg-surface-tertiary px-6 py-1.5 flex w-full cursor-pointer flex-row items-center justify-center transition-opacity duration-200 hover:opacity-60"
            >
              <TagIcon className="h-4 w-4 text-text-success" />
              <div className="text-label-sm font-semibold text-text-body">
                {version}
              </div>
            </button>
            <button
              onClick={() =>
                window.open(
                  'https://www.eigent.ai',
                  '_blank',
                  'noopener,noreferrer'
                )
              }
              className="flex cursor-pointer items-center bg-transparent transition-opacity duration-200 hover:opacity-60"
            >
              <img src={logoSrc} alt="version-logo" className="h-5" />
            </button>
          </div>
        </div>

        <div className="flex h-auto w-full flex-1 flex-col">
          <div className="gap-4 flex flex-col">
            {activeTab === 'general' && <General />}
            {activeTab === 'human-in-the-loop' && <HumanInTheLoop />}
            {activeTab === 'privacy' && <Privacy />}
          </div>
        </div>
      </div>
    </div>
  );
}
