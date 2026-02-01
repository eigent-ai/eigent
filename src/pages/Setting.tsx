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

import vsersionLogo from '@/assets/version-logo.png';
import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Navigation';
import useAppVersion from '@/hooks/use-app-version';
import General from '@/pages/Setting/General';
import Models from '@/pages/Setting/Models';
import Privacy from '@/pages/Setting/Privacy';
import { CircleCheck, Fingerprint, Settings, TextSelect } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Setting() {
  const navigate = useNavigate();
  const location = useLocation();
  const version = useAppVersion();
  const { t } = useTranslation();
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
    <div className="m-auto flex h-auto max-w-[900px] flex-col px-4 py-4">
      <div className="flex h-auto w-full px-3">
        <div className="sticky top-20 flex !w-[222px] flex-shrink-0 flex-grow-0 flex-col self-start pr-4 pt-md">
          <VerticalNavigation
            items={
              settingMenus.map((menu) => {
                const _Icon = menu.icon;
                return {
                  value: menu.id,
                  label: (
                    <span className="text-sm font-bold leading-13">
                      {menu.name}
                    </span>
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
          <div className="mt-8 flex w-full flex-shrink-0 flex-grow-0 items-center justify-center border-[0px] border-t border-solid border-white-80% pb-2 pt-4">
            <div className="flex items-center gap-1 leading-9">
              <img src={vsersionLogo} alt="version-logo" className="h-6" />
            </div>
            <div className="bg-bg-surface-tertiary flex items-center justify-center gap-1 rounded-full px-sm py-0.5">
              <CircleCheck className="text-bg-fill-success-primary h-4 w-4" />
              <div className="text-primary text-xs font-bold leading-17">
                {version}
              </div>
            </div>
          </div>
        </div>

        <div className="flex h-auto w-full flex-1 flex-col">
          <div className="flex flex-col gap-4 py-md pb-md">
            {activeTab === 'general' && <General />}
            {activeTab === 'privacy' && <Privacy />}
            {activeTab === 'models' && <Models />}
          </div>
        </div>
      </div>
    </div>
  );
}
