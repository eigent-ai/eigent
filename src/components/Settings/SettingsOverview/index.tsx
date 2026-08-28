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
import {
  installDesktopUpdate,
  startDesktopUpdateDownload,
} from '@/hooks/useDesktopUpdater';
import { useHost } from '@/host';
import { SITE_URL } from '@/lib';
import { useAuthStore } from '@/store/authStore';
import { useDesktopUpdateStore } from '@/store/updateStore';
import { Download, ExternalLink, RefreshCw, TagIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Appearance from '../Appearance';
import General from '../General';
import Privacy from '../Privacy';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionPage from '../SettingsSectionPage';

export function AboutSettings() {
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
  const logoSrc = appearance === 'dark' ? logoWhite : logoBlack;
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const version = useAppVersion();
  const phase = useDesktopUpdateStore((state) => state.phase);
  const progress = useDesktopUpdateStore((state) => state.progress);
  const packageNewVersion = useDesktopUpdateStore((state) => state.newVersion);
  const errorMessage = useDesktopUpdateStore((state) => state.errorMessage);

  const renderVersionAction = () => {
    if (!ipcRenderer || phase === 'idle' || phase === 'checking') {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            window.open(
              'https://github.com/eigent-ai/eigent',
              '_blank',
              'noopener,noreferrer'
            )
          }
          aria-label={t('setting.version', { defaultValue: 'Version' })}
          title={version}
        >
          <TagIcon
            className="h-4 w-4 text-ds-text-success-default-default"
            aria-hidden
          />
          {version || t('setting.version', { defaultValue: 'Version' })}
        </Button>
      );
    }

    if (phase === 'downloading') {
      const percent = Math.round(progress);
      const label = t('update.downloading', {
        defaultValue: 'Downloading update',
      });
      return (
        <div
          className="flex min-w-32 items-center gap-2"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ds-neutral-subtle-default">
            <div
              className="h-full origin-left rounded-full bg-ds-accent-default-default transition-transform duration-200 motion-reduce:transition-none"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          <span className="text-xs tabular-nums">{percent}%</span>
        </div>
      );
    }

    if (phase === 'downloaded' || phase === 'installing') {
      const label = t('update.launch-new-version', {
        defaultValue: 'Launch new version',
      });
      return (
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={phase === 'installing'}
          onClick={() => void installDesktopUpdate(ipcRenderer)}
          aria-label={label}
        >
          {label}
        </Button>
      );
    }

    const failed = phase === 'error';
    const label = failed
      ? t('update.update-failed-retry', {
          defaultValue: 'Update failed — click to retry',
        })
      : t('update.update', { defaultValue: 'Update' });
    return (
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => void startDesktopUpdateDownload(ipcRenderer)}
        aria-label={label}
        title={failed ? (errorMessage ?? label) : (packageNewVersion ?? label)}
      >
        {failed ? (
          <RefreshCw className="h-4 w-4" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        {failed
          ? t('layout.retry', { defaultValue: 'Retry' })
          : [label, packageNewVersion].filter(Boolean).join(' ')}
      </Button>
    );
  };

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
          action={renderVersionAction()}
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
