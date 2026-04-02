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
import { useHost } from '@/host';
import type { ProgressInfo } from 'electron-updater';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const Update = () => {
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const { t } = useTranslation();

  const checkUpdate = useCallback(() => {
    ipcRenderer?.invoke('check-update');
  }, [ipcRenderer]);

  const onUpdateCanAvailable = useCallback(
    (_event: Electron.IpcRendererEvent, info: VersionInfo) => {
      if (info.update) {
        toast(t('update.new-version-available'), {
          description: `v${info.version} → v${info.newVersion}`,
          action: {
            label: t('update.download'),
            onClick: () => {
              setIsDownloading(true);
              setDownloadProgress(0);
              host?.ipcRenderer?.invoke('start-download');
            },
          },
          duration: Infinity,
        });
      }
    },
    [host?.ipcRenderer, t]
  );

  const onUpdateError = useCallback(
    (_event: Electron.IpcRendererEvent, err: ErrorType) => {
      toast.error(t('update.update-error'), {
        description: err.message,
      });
    },
    [t]
  );

  const onDownloadProgress = useCallback(
    (_event: Electron.IpcRendererEvent, progress: ProgressInfo) => {
      console.log('Download progress received:', progress);
      setDownloadProgress(progress.percent ?? 0);
    },
    []
  );

  // listen to download progress and update toast
  useEffect(() => {
    if (isDownloading) {
      toast.custom(
        (_toastId) => (
          <div className="w-[300px] rounded-lg bg-white-100% p-4 shadow-lg">
            <div className="mb-2 text-sm font-medium">
              {t('update.downloading-update')}
            </div>
            <Progress value={downloadProgress} className="mb-2" />
            <div className="text-xs text-gray-500">
              {Math.round(downloadProgress)}% {t('update.complete')}
            </div>
          </div>
        ),
        {
          id: 'download-progress',
          duration: Infinity,
        }
      );
    }
  }, [downloadProgress, isDownloading, t]);

  const onUpdateDownloaded = useCallback(
    (_event: Electron.IpcRendererEvent) => {
      toast.dismiss('download-progress');
      setIsDownloading(false);
      toast.success(t('update.download-completed'), {
        description: t('update.click-to-install-update'),
        action: {
          label: t('update.install'),
          onClick: () => ipcRenderer?.invoke('quit-and-install'),
        },
        duration: Infinity,
      });
    },
    [ipcRenderer, t]
  );

  useEffect(() => {
    if (!ipcRenderer || sessionStorage.getItem('updateElectronShown')) {
      return;
    }
    sessionStorage.setItem('updateElectronShown', '1');

    ipcRenderer.on('update-can-available', onUpdateCanAvailable);
    ipcRenderer.on('update-error', onUpdateError);
    ipcRenderer.on('download-progress', onDownloadProgress);
    ipcRenderer.on('update-downloaded', onUpdateDownloaded);
    checkUpdate();

    return () => {
      ipcRenderer.off('update-can-available', onUpdateCanAvailable);
      ipcRenderer.off('update-error', onUpdateError);
      ipcRenderer.off('download-progress', onDownloadProgress);
      ipcRenderer.off('update-downloaded', onUpdateDownloaded);
    };
  }, [
    checkUpdate,
    ipcRenderer,
    onUpdateCanAvailable,
    onUpdateError,
    onDownloadProgress,
    onUpdateDownloaded,
  ]);

  return null;
};

export default Update;
