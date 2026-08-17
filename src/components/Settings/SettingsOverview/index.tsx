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
import { Button } from '@/components/ui/button';
import useAppVersion from '@/hooks/use-app-version';
import { useHost } from '@/host';
import { SITE_URL } from '@/lib';
import { useAuthStore } from '@/store/authStore';
import { Download, ExternalLink, TagIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Appearance from '../Appearance';
import General from '../General';
import Privacy from '../Privacy';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionPage from '../SettingsSectionPage';

function AboutSettings() {
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
    if (!ipcRenderer) return;

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

    ipcRenderer.on('update-can-available', onUpdateCanAvailable);
    ipcRenderer.on('update-downloaded', onUpdateDownloaded);
    void ipcRenderer.invoke('check-update');

    return () => {
      ipcRenderer.off('update-can-available', onUpdateCanAvailable);
      ipcRenderer.off('update-downloaded', onUpdateDownloaded);
    };
  }, [ipcRenderer]);

  const handleVersionAction = useCallback(() => {
    if (packageUpdateAvailable) {
      void ipcRenderer?.invoke('start-download');
      return;
    }
    window.open(
      'https://github.com/eigent-ai/eigent',
      '_blank',
      'noopener,noreferrer'
    );
  }, [ipcRenderer, packageUpdateAvailable]);

  return (
    <SettingsSectionPage>
      <SettingsRowGroup>
        <SettingsRow
          title="Eigent"
          description={t('setting.official-website', {
            defaultValue: 'Official Eigent website.',
          })}
          action={
            <button
              type="button"
              onClick={() =>
                window.open(SITE_URL, '_blank', 'noopener,noreferrer')
              }
              className="flex cursor-pointer items-center gap-3 bg-transparent transition-opacity duration-200 hover:opacity-60"
            >
              <img src={logoSrc} alt="Eigent" className="h-7 w-auto" />
              <ExternalLink className="h-4 w-4" aria-hidden />
            </button>
          }
        />
        <SettingsRow
          title={t('setting.version', { defaultValue: 'Version' })}
          description={t('setting.version-description', {
            defaultValue: 'Current version and available updates.',
          })}
          action={
            <Button
              type="button"
              variant={packageUpdateAvailable ? 'primary' : 'outline'}
              size="sm"
              onClick={handleVersionAction}
              aria-label={
                packageUpdateAvailable
                  ? t('update.update', { defaultValue: 'Update' })
                  : t('setting.version', { defaultValue: 'Version' })
              }
              title={
                packageUpdateAvailable
                  ? (packageNewVersion ?? undefined)
                  : version
              }
            >
              {packageUpdateAvailable ? (
                <Download className="h-4 w-4" aria-hidden />
              ) : (
                <TagIcon
                  className="h-4 w-4 text-ds-text-success-default-default"
                  aria-hidden
                />
              )}
              {packageUpdateAvailable
                ? [
                    t('update.update', { defaultValue: 'Update' }),
                    packageNewVersion,
                  ]
                    .filter(Boolean)
                    .join(' ')
                : version || t('setting.version', { defaultValue: 'Version' })}
            </Button>
          }
        />
      </SettingsRowGroup>
    </SettingsSectionPage>
  );
}

export default function SettingsOverview() {
  return (
    <div className="flex w-full flex-col gap-4 py-4 [&>section]:py-0">
      <General />
      <Appearance />
      <Privacy />
      <AboutSettings />
    </div>
  );
}
