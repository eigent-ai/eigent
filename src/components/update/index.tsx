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

import { Progress } from '@/components/ui/progress';
import type { ProgressInfo } from 'electron-updater';
import { Package, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

// ── Shared toast shell (matches toast.pen spec) ─────────────────────
interface UpdateToastProps {
  toastId: string | number;
  children: React.ReactNode;
  onClose?: () => void;
}

const UpdateToastShell = ({ toastId, children, onClose }: UpdateToastProps) => {
  const { t } = useTranslation();

  return (
    <div className="w-[275px] overflow-hidden rounded-xl border border-border-secondary bg-fill-default shadow-perfect">
      {/* Header — #f5f5f5cc bg, padding 8px vertical / 12px horizontal */}
      <div className="flex items-center justify-between bg-surface-primary px-3 py-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-icon-primary" strokeWidth={1.33} />
          <span
            className="font-bold text-text-heading"
            style={{ fontSize: '13px', lineHeight: '20px' }}
          >
            {t('update.update-eigent')}
          </span>
        </div>
        <button
          className="flex h-4 w-4 items-center justify-center rounded text-icon-secondary transition-colors hover:text-icon-primary"
          onClick={() => {
            onClose?.();
            toast.dismiss(toastId);
          }}
        >
          <X className="h-[8px] w-[8px]" strokeWidth={1.33} />
        </button>
      </div>

      {/* Body */}
      {children}
    </div>
  );
};

// ── Main component ──────────────────────────────────────────────────
const Update = () => {
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const { t } = useTranslation();

  const checkUpdate = () => {
    window.ipcRenderer.invoke('check-update');
  };

  // ── 1. New version available ────────────────────────────────────
  const onUpdateCanAvailable = useCallback(
    (_event: Electron.IpcRendererEvent, info: VersionInfo) => {
      if (info.update) {
        toast.custom(
          (toastId) => (
            <UpdateToastShell toastId={toastId}>
              <div className="px-3 py-1.5">
                <p
                  className="font-medium text-text-label"
                  style={{ fontSize: '10px', lineHeight: '16px' }}
                >
                  {t('update.new-version-available')}
                </p>
                <p
                  className="mt-0.5 text-text-disabled"
                  style={{ fontSize: '10px', lineHeight: '16px' }}
                >
                  v{info.version} → v{info.newVersion}
                </p>
                <button
                  className="mt-2 w-full rounded-md bg-fill-fill-primary px-3 py-1.5 font-medium text-text-on-action transition-colors hover:bg-fill-fill-primary-hover"
                  style={{ fontSize: '10px' }}
                  onClick={() => {
                    setIsDownloading(true);
                    setDownloadProgress(0);
                    window.ipcRenderer.invoke('start-download');
                    toast.dismiss(toastId);
                  }}
                >
                  {t('update.download')}
                </button>
              </div>
            </UpdateToastShell>
          ),
          { id: 'update-available', duration: Infinity }
        );
      }
    },
    [t]
  );

  // ── 2. Error ────────────────────────────────────────────────────
  const onUpdateError = useCallback(
    (_event: Electron.IpcRendererEvent, err: ErrorType) => {
      toast.error(t('update.update-error'), {
        description: err.message,
      });
    },
    [t]
  );

  // ── 3. Download progress ────────────────────────────────────────
  const onDownloadProgress = useCallback(
    (_event: Electron.IpcRendererEvent, progress: ProgressInfo) => {
      console.log('Download progress received:', progress);
      setDownloadProgress(progress.percent ?? 0);
    },
    []
  );

  // Render download-progress toast whenever progress changes
  useEffect(() => {
    if (isDownloading) {
      toast.custom(
        (toastId) => (
          <UpdateToastShell
            toastId={toastId}
            onClose={() => {
              setIsDownloading(false);
            }}
          >
            {/* Status text — padding 6px vertical / 12px horizontal to align with header icon */}
            <div
              className="flex cursor-pointer items-center gap-1 px-3 py-1.5"
              onClick={() => {
                setIsDownloading(false);
                toast.dismiss(toastId);
              }}
            >
              <span
                className="font-medium text-text-tertiary"
                style={{ fontSize: '10px', lineHeight: '16px' }}
              >
                {t('update.downloading-in-progress')}
              </span>
              <span
                className="font-medium text-text-primary"
                style={{ fontSize: '10px', lineHeight: '16px' }}
              >
                {t('update.click-to-stop')}
              </span>
            </div>
            {/* Progress bar — 4px height, full width, no side padding */}
            <Progress value={downloadProgress} className="h-1 rounded-none" />
          </UpdateToastShell>
        ),
        { id: 'download-progress', duration: Infinity }
      );
    }
  }, [downloadProgress, isDownloading, t]);

  // ── 4. Download complete ────────────────────────────────────────
  const onUpdateDownloaded = useCallback(
    (_event: Electron.IpcRendererEvent) => {
      setIsDownloading(false);
      toast.dismiss('download-progress');

      toast.custom(
        (toastId) => (
          <UpdateToastShell toastId={toastId}>
            <div className="flex items-center gap-1 px-3 py-1.5">
              <span
                className="font-medium text-text-label"
                style={{ fontSize: '10px', lineHeight: '16px' }}
              >
                {t('update.ready-to-install')}
              </span>
              <span
                className="cursor-pointer font-medium text-text-primary underline decoration-text-tertiary underline-offset-2 hover:decoration-text-primary"
                style={{ fontSize: '10px', lineHeight: '16px' }}
                onClick={() => window.ipcRenderer.invoke('quit-and-install')}
              >
                {t('update.click-to-restart')}
              </span>
            </div>
          </UpdateToastShell>
        ),
        { id: 'update-downloaded', duration: Infinity }
      );
    },
    [t]
  );

  // ── IPC listeners ───────────────────────────────────────────────
  useEffect(() => {
    if (sessionStorage.getItem('updateElectronShown')) {
      return;
    }
    sessionStorage.setItem('updateElectronShown', '1');

    window.ipcRenderer?.on('update-can-available', onUpdateCanAvailable);
    window.ipcRenderer?.on('update-error', onUpdateError);
    window.ipcRenderer?.on('download-progress', onDownloadProgress);
    window.ipcRenderer?.on('update-downloaded', onUpdateDownloaded);
    checkUpdate();

    return () => {
      window.ipcRenderer?.off('update-can-available', onUpdateCanAvailable);
      window.ipcRenderer?.off('update-error', onUpdateError);
      window.ipcRenderer?.off('download-progress', onDownloadProgress);
      window.ipcRenderer?.off('update-downloaded', onUpdateDownloaded);
    };
  }, [
    onUpdateCanAvailable,
    onUpdateError,
    onDownloadProgress,
    onUpdateDownloaded,
  ]);

  // ── DEV-ONLY: mock triggers for testing toasts from console ─────
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const w = window as any;

    w.__mockUpdateAvailable = () => {
      onUpdateCanAvailable(
        {} as Electron.IpcRendererEvent,
        { update: true, version: '1.0.0', newVersion: '1.1.0' } as VersionInfo
      );
    };

    w.__mockDownloadStart = () => {
      setIsDownloading(true);
      setDownloadProgress(0);
    };

    w.__mockDownloadProgress = (percent: number) => {
      setIsDownloading(true);
      setDownloadProgress(percent);
    };

    w.__mockDownloadComplete = () => {
      onUpdateDownloaded({} as Electron.IpcRendererEvent);
    };

    console.log(
      '%c[Update] Dev helpers ready: __mockUpdateAvailable(), __mockDownloadStart(), __mockDownloadProgress(n), __mockDownloadComplete()',
      'color: #4ade80'
    );

    return () => {
      delete w.__mockUpdateAvailable;
      delete w.__mockDownloadStart;
      delete w.__mockDownloadProgress;
      delete w.__mockDownloadComplete;
    };
  }, [onUpdateCanAvailable, onUpdateDownloaded]);

  return null;
};

export default Update;
