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
import {
  createUpdateCheckScheduler,
  DEFAULT_UPDATE_CHECK_INTERVAL_MS,
  DEFAULT_UPDATE_CHECK_JITTER_MS,
  DEFAULT_UPDATE_CHECK_RETRY_MS,
  DEFAULT_UPDATE_CHECK_TICK_MS,
  type UpdateCheckOutcome,
  type UpdateCheckScheduler,
  type UpdateCheckSchedulerOptions,
} from '@/lib/updateCheckScheduler';
import { isLocalTaskRunning } from '@/service/updateCheckActivity';
import {
  useDesktopUpdateStore,
  type DesktopUpdatePhase,
} from '@/store/updateStore';
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

/**
 * Phases in which a background check would duplicate work or prompts: one is
 * already running, or an update is downloading or waiting to be installed.
 */
const BACKGROUND_CHECK_BLOCKING_PHASES: ReadonlySet<DesktopUpdatePhase> =
  new Set(['checking', 'downloading', 'downloaded', 'installing']);

type BackgroundScheduleOptions = Pick<
  UpdateCheckSchedulerOptions,
  'intervalMs' | 'jitterMs' | 'retryMs' | 'tickMs'
>;

/** The production schedule, or a short fixed one when a tester set one. */
export function backgroundUpdateSchedule(
  intervalMinutes: number | null | undefined
): BackgroundScheduleOptions {
  if (
    typeof intervalMinutes !== 'number' ||
    !Number.isFinite(intervalMinutes) ||
    intervalMinutes < 1
  ) {
    return {
      intervalMs: DEFAULT_UPDATE_CHECK_INTERVAL_MS,
      jitterMs: DEFAULT_UPDATE_CHECK_JITTER_MS,
      retryMs: DEFAULT_UPDATE_CHECK_RETRY_MS,
      tickMs: DEFAULT_UPDATE_CHECK_TICK_MS,
    };
  }
  const intervalMs = intervalMinutes * 60_000;
  return {
    intervalMs,
    jitterMs: 0,
    retryMs: Math.min(DEFAULT_UPDATE_CHECK_RETRY_MS, intervalMs),
    tickMs: Math.min(
      DEFAULT_UPDATE_CHECK_TICK_MS,
      Math.max(10_000, Math.floor(intervalMs / 4))
    ),
  };
}

async function readIntervalOverride(
  ipc: Pick<UpdateIpc, 'invoke'>
): Promise<number | null> {
  try {
    const config = (await ipc.invoke('get-update-check-config')) as
      { intervalMinutes?: unknown } | null | undefined;
    return typeof config?.intervalMinutes === 'number'
      ? config.intervalMinutes
      : null;
  } catch {
    return null;
  }
}

/** Runs one check; `failed` when the main process could not reach the feed. */
async function runUpdateCheck(
  ipc: Pick<UpdateIpc, 'invoke'>
): Promise<UpdateCheckOutcome> {
  useDesktopUpdateStore.getState().setChecking();
  try {
    const result = await ipc.invoke('check-update');
    return result ? 'succeeded' : 'failed';
  } catch {
    return 'failed';
  } finally {
    const store = useDesktopUpdateStore.getState();
    if (store.phase === 'checking') store.setIdle();
  }
}

/** A background check waits for idle: no running task, no pending update. */
async function canRunBackgroundCheck() {
  if (
    BACKGROUND_CHECK_BLOCKING_PHASES.has(useDesktopUpdateStore.getState().phase)
  ) {
    return false;
  }
  if (await isLocalTaskRunning()) return false;
  // The phase may have moved while the Run registry answered.
  return !BACKGROUND_CHECK_BLOCKING_PHASES.has(
    useDesktopUpdateStore.getState().phase
  );
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

    // Check at launch, then again every few hours for an app left open for
    // days. Background checks wait while a task runs or an update is pending.
    let disposed = false;
    let scheduler: UpdateCheckScheduler | null = null;
    let launchOutcome: UpdateCheckOutcome | null = null;
    const launchedAt = Date.now();
    void runUpdateCheck(ipc).then((outcome) => {
      if (disposed) return;
      launchOutcome = outcome;
      scheduler?.recordCheck(outcome);
    });
    void readIntervalOverride(ipc).then((intervalMinutes) => {
      if (disposed) return;
      scheduler = createUpdateCheckScheduler({
        ...backgroundUpdateSchedule(intervalMinutes),
        check: () => runUpdateCheck(ipc),
        canCheck: canRunBackgroundCheck,
        onError: (error) =>
          console.warn('[Updater] Background update check failed:', error),
      });
      scheduler.start(launchedAt);
      if (launchOutcome) scheduler.recordCheck(launchOutcome);
    });
    const onOnline = () => {
      void scheduler?.poke();
    };
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      scheduler?.stop();
      window.removeEventListener('online', onOnline);
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
