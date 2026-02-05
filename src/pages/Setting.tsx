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
import versionLogo from '@/assets/version-logo.png';
import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Navigation';
import useAppVersion from '@/hooks/use-app-version';
import General from '@/pages/Setting/General';
import Models from '@/pages/Setting/Models';
import Privacy from '@/pages/Setting/Privacy';
import { useAuthStore } from '@/store/authStore';
import { Fingerprint, Settings, TagIcon, TextSelect } from 'lucide-react';
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
      id: 'privacy',
      name: t('setting.privacy'),
      icon: Fingerprint,
      path: '/setting/privacy',
    },
    {
      id: 'models',
      name: t('setting.models'),
      icon: TextSelect,
      path: '/setting/models',
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
      <div className="flex h-auto w-full px-6">
        <div className="sticky top-20 flex h-full w-40 flex-shrink-0 flex-grow-0 flex-col justify-between self-start pr-6 pt-8">
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
            className="h-full min-h-0 w-full flex-1 gap-0"
            listClassName="w-full h-full overflow-y-auto"
            contentClassName="hidden"
          />
          <div className="mt-4 flex w-full flex-shrink-0 flex-grow-0 flex-col items-center justify-center gap-4 border-x-0 border-b-0 border-t-[0.5px] border-solid border-border-secondary py-4">
            <button
              onClick={() =>
                window.open(
                  'https://github.com/eigent-ai/eigent',
                  '_blank',
                  'noopener,noreferrer'
                )
              }
              className="flex w-full cursor-pointer flex-row items-center justify-center gap-2 rounded-lg bg-surface-tertiary px-6 py-1.5 transition-opacity duration-200 hover:opacity-60"
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
              <img src={versionLogo} alt="version-logo" className="h-5" />
            </button>
          </div>
        </div>

        <div className="flex h-auto w-full flex-1 flex-col">
          <div className="flex flex-col gap-4">
            {activeTab === 'general' && <General />}
            {activeTab === 'privacy' && <Privacy />}
            {activeTab === 'models' && <Models />}
          </div>
        </div>
      </div>
    </div>
  );
}
