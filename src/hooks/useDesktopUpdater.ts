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

import { useHost } from '@/host';
import { useDesktopUpdateStore } from '@/store/updateStore';
import { useCallback, useEffect } from 'react';

export const AUTO_UPDATE_DOWNLOAD_KEY = 'eigent-update-auto-download-started';

interface UpdateIpc {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on: (channel: string, listener: (...args: any[]) => void) => void;
  off: (channel: string, listener: (...args: any[]) => void) => void;
}

export async function startDesktopUpdateDownload(
  ipc: Pick<UpdateIpc, 'invoke'> | null | undefined
) {
  if (!ipc) return false;

  const state = useDesktopUpdateStore.getState();
  if (state.phase === 'downloading' || state.phase === 'installing') {
    return false;
  }

  state.setDownloading();
  try {
    await ipc.invoke('start-download');
    return true;
  } catch (error) {
    useDesktopUpdateStore
      .getState()
      .setError(error instanceof Error ? error.message : undefined);
    return false;
  }
}

export async function installDesktopUpdate(
  ipc: Pick<UpdateIpc, 'invoke'> | null | undefined
) {
  if (!ipc || useDesktopUpdateStore.getState().phase !== 'downloaded') {
    return false;
  }

  useDesktopUpdateStore.getState().setInstalling();
  try {
    await ipc.invoke('quit-and-install');
    return true;
  } catch (error) {
    useDesktopUpdateStore
      .getState()
      .setError(error instanceof Error ? error.message : undefined);
    return false;
  }
}

function hasAutoDownloadedThisSession() {
  try {
    return sessionStorage.getItem(AUTO_UPDATE_DOWNLOAD_KEY) === '1';
  } catch {
    return true;
  }
}

function rememberAutoDownload() {
  try {
    sessionStorage.setItem(AUTO_UPDATE_DOWNLOAD_KEY, '1');
  } catch {
    // Storage can be unavailable in hardened WebViews. Manual update remains.
  }
}

/** Owns updater IPC for the lifetime of the app shell. */
export function useDesktopUpdater() {
  const ipc = useHost()?.ipcRenderer as UpdateIpc | undefined;
  const phase = useDesktopUpdateStore((state) => state.phase);
  const startDownload = useCallback(
    () => startDesktopUpdateDownload(ipc),
    [ipc]
  );

  useEffect(() => {
    if (!ipc) return;

    const onUpdateCanAvailable = (
      _event: Electron.IpcRendererEvent,
      info: VersionInfo
    ) => {
      const store = useDesktopUpdateStore.getState();
      if (info.update) {
        store.setAvailable(info.newVersion);
      } else if (store.phase !== 'downloaded' && store.phase !== 'installing') {
        store.setIdle();
      }
    };
    const onDownloadProgress = (
      _event: Electron.IpcRendererEvent,
      info?: { percent?: number }
    ) => {
      useDesktopUpdateStore.getState().setProgress(info?.percent ?? 0);
    };
    const onUpdateDownloaded = () => {
      useDesktopUpdateStore.getState().setDownloaded();
    };
    const onUpdateError = (
      _event: Electron.IpcRendererEvent,
      error?: { message?: string }
    ) => {
      useDesktopUpdateStore.getState().setError(error?.message);
    };

    ipc.on('update-can-available', onUpdateCanAvailable);
    ipc.on('download-progress', onDownloadProgress);
    ipc.on('update-downloaded', onUpdateDownloaded);
    ipc.on('update-error', onUpdateError);
    useDesktopUpdateStore.getState().setChecking();
    void ipc.invoke('check-update').then(
      () => {
        const store = useDesktopUpdateStore.getState();
        if (store.phase === 'checking') store.setIdle();
      },
      () => {
        const store = useDesktopUpdateStore.getState();
        if (store.phase === 'checking') store.setIdle();
      }
    );

    return () => {
      ipc.off('update-can-available', onUpdateCanAvailable);
      ipc.off('download-progress', onDownloadProgress);
      ipc.off('update-downloaded', onUpdateDownloaded);
      ipc.off('update-error', onUpdateError);
    };
  }, [ipc]);

  useEffect(() => {
    if (phase !== 'available' || hasAutoDownloadedThisSession()) return;
    rememberAutoDownload();
    void startDownload();
  }, [phase, startDownload]);
}
