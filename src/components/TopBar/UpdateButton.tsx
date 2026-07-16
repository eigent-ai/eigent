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

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import type { ProgressInfo } from 'electron-updater';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Survives TopBar remounts so a background download is only auto-started once
// per app session; after that the slot falls back to a manual button.
const AUTO_DOWNLOAD_KEY = 'eigent-update-auto-download-started';

type UpdatePhase = 'idle' | 'available' | 'downloading' | 'downloaded';

/**
 * Software-update slot at the left end of the top bar's trailing button group.
 * idle → (auto background download with inline progress) → "Launch new version".
 */
export default function UpdateButton() {
  const { t } = useTranslation();
  const host = useHost();
  const ipc = host?.ipcRenderer;
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  const startDownload = useCallback(() => {
    setFailed(false);
    setProgress(0);
    setPhase('downloading');
    void ipc?.invoke('start-download');
  }, [ipc]);

  useEffect(() => {
    if (!ipc) return;

    const onUpdateCanAvailable = (
      _event: Electron.IpcRendererEvent,
      info: VersionInfo
    ) => {
      setPhase((current) => {
        if (current !== 'idle') return current;
        return info.update ? 'available' : 'idle';
      });
    };

    const onDownloadProgress = (
      _event: Electron.IpcRendererEvent,
      info: ProgressInfo
    ) => {
      setFailed(false);
      setProgress(info.percent ?? 0);
      setPhase((current) =>
        current === 'downloaded' ? current : 'downloading'
      );
    };

    const onUpdateDownloaded = () => {
      setPhase('downloaded');
    };

    const onUpdateError = () => {
      // Inline retry affordance instead of a toast; only relevant mid-download.
      setPhase((current) => {
        if (current !== 'downloading') return current;
        setFailed(true);
        return 'available';
      });
    };

    ipc.on('update-can-available', onUpdateCanAvailable);
    ipc.on('download-progress', onDownloadProgress);
    ipc.on('update-downloaded', onUpdateDownloaded);
    ipc.on('update-error', onUpdateError);
    void ipc.invoke('check-update');

    return () => {
      ipc.off('update-can-available', onUpdateCanAvailable);
      ipc.off('download-progress', onDownloadProgress);
      ipc.off('update-downloaded', onUpdateDownloaded);
      ipc.off('update-error', onUpdateError);
    };
  }, [ipc]);

  // Auto-start the background download the first time an update is seen.
  useEffect(() => {
    if (phase !== 'available' || failed) return;
    if (sessionStorage.getItem(AUTO_DOWNLOAD_KEY)) return;
    sessionStorage.setItem(AUTO_DOWNLOAD_KEY, '1');
    startDownload();
  }, [phase, failed, startDownload]);

  if (phase === 'idle') return null;

  if (phase === 'downloading') {
    const percent = Math.round(progress);
    const label = t('update.downloading', {
      defaultValue: 'Downloading update',
    });
    return (
      <TooltipSimple content={label} side="bottom" align="end">
        <div
          className="no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-ds-bg-neutral-strong-default">
            <div
              className="h-full rounded-full bg-ds-bg-brand-default-default transition-all duration-200 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-ds-text-neutral-subtle-default">
            {percent}%
          </span>
        </div>
      </TooltipSimple>
    );
  }

  if (phase === 'downloaded') {
    const label = t('update.launch-new-version', {
      defaultValue: 'Launch new version',
    });
    return (
      <TooltipSimple
        content={t('update.click-to-install-update', {
          defaultValue: 'Click to install update',
        })}
        side="bottom"
        align="end"
      >
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="no-drag shrink-0 rounded-full px-3"
          onClick={() => void ipc?.invoke('quit-and-install')}
          aria-label={label}
        >
          {label}
        </Button>
      </TooltipSimple>
    );
  }

  // 'available' after the session already auto-downloaded once, or after a
  // download error: manual (re)start.
  const label = t('layout.update', { defaultValue: 'Update' });
  return (
    <TooltipSimple
      content={
        failed
          ? t('update.update-failed-retry', {
              defaultValue: 'Update failed — click to retry',
            })
          : label
      }
      side="bottom"
      align="end"
    >
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="no-drag shrink-0 rounded-full px-3"
        onClick={startDownload}
        aria-label={label}
      >
        {label}
      </Button>
    </TooltipSimple>
  );
}
