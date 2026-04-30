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
import { PageSubTabsNav } from '@/components/Dashboard/HorizontalNav';
import VerticalNavigation, {
  type VerticalNavItem,
} from '@/components/Dashboard/VerticalNav';
import useAppVersion from '@/hooks/use-app-version';
import { useHost } from '@/host';
import {
  buildHistorySearchString,
  type SettingsTab as ShellSettingsTab,
} from '@/lib/historyNavConfig';
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
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import DashboardPageLayout from '../DashboardPageLayout';
import Appearance from './Appearance';
import General from './General';
import Privacy from './Privacy';

export default function Setting({
  embedded,
  settingsTab: settingsTabProp,
}: {
  embedded?: boolean;
  settingsTab?: ShellSettingsTab;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
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
  const getCurrentTab = (): 'general' | 'appearance' | 'privacy' => {
    const path = location.pathname;
    const raw = path.split('/setting/')[1] || 'general';
    if (raw === 'general' || raw === 'appearance' || raw === 'privacy')
      return raw;
    return 'general';
  };

  const [activeTab, setActiveTab] = useState(getCurrentTab);

  const SETTINGS_SUB_TABS = [
    { id: 'general' as const, labelKey: 'setting.general' },
    { id: 'appearance' as const, labelKey: 'setting.appearance-tab' },
    { id: 'privacy' as const, labelKey: 'setting.privacy' },
  ];

  useEffect(() => {
    if (embedded) return;
    setActiveTab(getCurrentTab());
  }, [embedded, location.pathname]);

  const effectiveTab: 'general' | 'appearance' | 'privacy' = embedded
    ? (settingsTabProp ?? 'general')
    : activeTab;

  const handleTabChange = (tabId: string) => {
    if (tabId !== 'general' && tabId !== 'appearance' && tabId !== 'privacy') {
      return;
    }
    if (embedded) {
      navigate(
        {
          pathname: '/history',
          search: `?${buildHistorySearchString(searchParams, {
            tab: 'settings',
            settingsTab: tabId,
          })}`,
        },
        { replace: true }
      );
      return;
    }
    setActiveTab(tabId);
    navigate(`/setting/${tabId}`);
  };

  // Close settings page
  const _handleClose = () => {
    navigate('/');
  };

  return (
    <div className="flex h-auto w-full">
      {!embedded && (
        <div className="w-40 pr-6 pt-8 flex h-auto flex-shrink-0 flex-grow-0 flex-col self-start">
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
      )}

      {embedded ? (
        <DashboardPageLayout
          title={t('layout.settings')}
          className="min-w-0 flex-1"
          tabs={
            <PageSubTabsNav
              tabs={SETTINGS_SUB_TABS.map(({ id, labelKey }) => ({
                id,
                label: t(labelKey),
              }))}
              activeId={effectiveTab}
              onChange={handleTabChange}
            />
          }
        >
          <div className="gap-4 flex flex-col">
            {effectiveTab === 'general' && <General />}
            {effectiveTab === 'appearance' && <Appearance />}
            {effectiveTab === 'privacy' && <Privacy />}
          </div>
        </DashboardPageLayout>
      ) : (
        <div className="min-w-0 flex h-auto flex-1 flex-col">
          <div className="gap-4 flex flex-col">
            {effectiveTab === 'general' && <General />}
            {effectiveTab === 'appearance' && <Appearance />}
            {effectiveTab === 'privacy' && <Privacy />}
          </div>
        </div>
      )}
    </div>
  );
}
