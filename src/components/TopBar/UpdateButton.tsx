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
import {
  installDesktopUpdate,
  startDesktopUpdateDownload,
} from '@/hooks/useDesktopUpdater';
import { useHost } from '@/host';
import { useDesktopUpdateStore } from '@/store/updateStore';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Keeps an available update visible while users navigate between app screens. */
export default function UpdateButton() {
  const { t } = useTranslation();
  const ipc = useHost()?.ipcRenderer;
  const phase = useDesktopUpdateStore((state) => state.phase);
  const progress = useDesktopUpdateStore((state) => state.progress);
  const newVersion = useDesktopUpdateStore((state) => state.newVersion);
  const errorMessage = useDesktopUpdateStore((state) => state.errorMessage);

  if (!ipc || phase === 'idle' || phase === 'checking') return null;

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
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-ds-neutral-subtle-default">
            <div
              className="h-full w-full origin-left rounded-full bg-ds-accent-default-default transition-transform duration-200 ease-out motion-reduce:transition-none"
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          <span className="text-xs text-ds-ink-subtle-default tabular-nums">
            {percent}%
          </span>
        </div>
      </TooltipSimple>
    );
  }

  if (phase === 'downloaded' || phase === 'installing') {
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
          disabled={phase === 'installing'}
          onClick={() => void installDesktopUpdate(ipc)}
          aria-label={label}
        >
          {label}
        </Button>
      </TooltipSimple>
    );
  }

  const failed = phase === 'error';
  const label = failed
    ? t('update.update-failed-retry', {
        defaultValue: 'Update failed — click to retry',
      })
    : t('update.update', { defaultValue: 'Update' });

  return (
    <TooltipSimple
      content={failed ? (errorMessage ?? label) : (newVersion ?? label)}
      side="bottom"
      align="end"
    >
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="no-drag shrink-0 rounded-full px-3"
        onClick={() => void startDesktopUpdateDownload(ipc)}
        aria-label={label}
      >
        {failed ? (
          <RefreshCw className="h-4 w-4" aria-hidden />
        ) : (
          <Download className="h-4 w-4" aria-hidden />
        )}
        {failed
          ? t('layout.retry', { defaultValue: 'Retry' })
          : t('update.update', { defaultValue: 'Update' })}
      </Button>
    </TooltipSimple>
  );
}
