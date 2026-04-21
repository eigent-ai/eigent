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
} from '@/components/Dashboard/VerticalNav';
import Appearance from '@/pages/Setting/Appearance';
import General from '@/pages/Setting/General';
import Privacy from '@/pages/Setting/Privacy';
import { useAuthStore } from '@/store/authStore';
import { Fingerprint, Palette, Settings } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Setting() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
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
      id: 'appearance',
      name: t('setting.appearance-tab'),
      icon: Palette,
      path: '/setting/appearance',
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
    <div className="flex h-auto w-full">
      <div className="top-20 w-40 pr-6 pt-8 sticky flex h-full flex-shrink-0 flex-grow-0 flex-col self-start">
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
        <button
          type="button"
          onClick={() =>
            window.open(
              'https://www.eigent.ai',
              '_blank',
              'noopener,noreferrer'
            )
          }
          className="no-drag mt-4 flex cursor-pointer items-center bg-transparent transition-opacity duration-200 hover:opacity-60"
        >
          <img src={logoSrc} alt="Eigent" className="h-6 w-auto" />
        </button>
      </div>

      <div className="flex h-auto w-full flex-1 flex-col">
        <div className="gap-4 flex flex-col">
          {activeTab === 'general' && <General />}
          {activeTab === 'appearance' && <Appearance />}
          {activeTab === 'privacy' && <Privacy />}
        </div>
      </div>
    </div>
  );
}
