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
import useAppVersion from '@/hooks/use-app-version';
import { useHost } from '@/host';
import Appearance from '@/pages/Setting/Appearance';
import General from '@/pages/Setting/General';
import Privacy from '@/pages/Setting/Privacy';
import { useAuthStore } from '@/store/authStore';
import {
  Download,
  Fingerprint,
  Palette,
  Settings,
  TagIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

export default function Setting() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
  const logoSrc = appearance === 'dark' ? logoWhite : logoBlack;
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const version = useAppVersion();
  const [packageUpdateAvailable, setPackageUpdateAvailable] = useState(false);
  const [packageNewVersion, setPackageNewVersion] = useState<string | null>(
    null
  );

  useEffect(() => {
    const ipc = ipcRenderer;
    if (!ipc) return;

    const onUpdateCanAvailable = (
      _event: Electron.IpcRendererEvent,
      info: VersionInfo
    ) => {
      setPackageUpdateAvailable(Boolean(info.update));
      setPackageNewVersion(info.newVersion ?? null);
    };

    const onUpdateDownloaded = () => {
      setPackageUpdateAvailable(false);
      setPackageNewVersion(null);
    };

    ipc.on('update-can-available', onUpdateCanAvailable);
    ipc.on('update-downloaded', onUpdateDownloaded);
    void ipc.invoke('check-update');

    return () => {
      ipc.off('update-can-available', onUpdateCanAvailable);
      ipc.off('update-downloaded', onUpdateDownloaded);
    };
  }, [ipcRenderer]);

  const handleStartPackageDownload = useCallback(() => {
    void ipcRenderer?.invoke('start-download');
  }, [ipcRenderer]);
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
      <div className="top-20 w-40 pr-6 pt-8 sticky flex h-auto flex-shrink-0 flex-grow-0 flex-col self-start">
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
          className="min-h-0 gap-0 h-fit w-full flex-none"
          listClassName="h-auto w-full"
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
          <img src={logoSrc} alt="Eigent" className="h-6 ml-3 w-auto" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (packageUpdateAvailable) {
              handleStartPackageDownload();
              return;
            }
            window.open(
              'https://github.com/eigent-ai/eigent',
              '_blank',
              'noopener,noreferrer'
            );
          }}
          className={
            packageUpdateAvailable
              ? 'no-drag mt-4 min-w-0 gap-1.5 bg-ds-bg-neutral-subtle-default px-5 py-1 flex w-full cursor-pointer flex-row items-center justify-center rounded-full transition-opacity duration-200 hover:opacity-90'
              : 'no-drag mt-4 min-w-0 gap-1.5 bg-ds-bg-neutral-subtle-default px-5 py-1 flex w-full cursor-pointer flex-row items-center justify-center rounded-full transition-opacity duration-200 hover:opacity-60'
          }
          aria-label={
            packageUpdateAvailable
              ? t('update.new-version-available')
              : version || t('setting.version', { defaultValue: 'Version' })
          }
          title={
            packageUpdateAvailable
              ? [t('update.new-version-available'), packageNewVersion]
                  .filter(Boolean)
                  .join(' ')
              : version
          }
        >
          {packageUpdateAvailable ? (
            <Download
              className="h-4 w-4 text-ds-text-neutral-default-default shrink-0 stroke-2"
              aria-hidden
            />
          ) : (
            <TagIcon
              className="h-4 w-4 text-ds-text-success-default-default shrink-0 stroke-2"
              aria-hidden
            />
          )}
          <span className="min-w-0 text-label-sm font-semibold text-ds-text-neutral-default-default flex-1 truncate text-left">
            {packageUpdateAvailable
              ? [t('update.new-version-available'), packageNewVersion]
                  .filter(Boolean)
                  .join(' ')
              : version}
          </span>
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
