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

import {
  AUTO_UPDATE_DOWNLOAD_KEY,
  backgroundUpdateSchedule,
  installDesktopUpdate,
  startDesktopUpdateDownload,
  useDesktopUpdater,
} from '@/hooks/useDesktopUpdater';
import { HostProvider } from '@/host';
import { isLocalTaskRunning } from '@/service/updateCheckActivity';
import {
  resetDesktopUpdateStore,
  useDesktopUpdateStore,
} from '@/store/updateStore';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/service/updateCheckActivity', () => ({
  isLocalTaskRunning: vi.fn(async () => false),
}));

describe('useDesktopUpdater', () => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const ipcRenderer = {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      listeners.set(channel, listener);
    }),
    off: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    }),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HostProvider host={{ electronAPI: null, ipcRenderer }}>
      {children}
    </HostProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    sessionStorage.clear();
    resetDesktopUpdateStore();
    ipcRenderer.invoke.mockResolvedValue(undefined);
    vi.mocked(isLocalTaskRunning).mockResolvedValue(false);
  });

  it('auto-downloads an available update only once per app session', async () => {
    renderHook(() => useDesktopUpdater(), { wrapper });

    act(() => {
      listeners.get('update-can-available')?.(
        {},
        {
          update: true,
          newVersion: '2.0.0',
        }
      );
    });

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-download');
    });
    expect(
      ipcRenderer.invoke.mock.calls.filter(
        ([channel]) => channel === 'start-download'
      )
    ).toHaveLength(1);
    expect(sessionStorage.getItem(AUTO_UPDATE_DOWNLOAD_KEY)).toBe('1');

    act(() => {
      useDesktopUpdateStore.getState().setAvailable('2.0.0');
    });
    expect(
      ipcRenderer.invoke.mock.calls.filter(
        ([channel]) => channel === 'start-download'
      )
    ).toHaveLength(1);
  });

  it('tracks progress, error, retry, download completion, and install', async () => {
    sessionStorage.setItem(AUTO_UPDATE_DOWNLOAD_KEY, '1');
    renderHook(() => useDesktopUpdater(), { wrapper });

    act(() => {
      listeners.get('update-can-available')?.(
        {},
        {
          update: true,
          newVersion: '2.0.0',
        }
      );
      listeners.get('download-progress')?.({}, { percent: 42.4 });
    });
    expect(useDesktopUpdateStore.getState()).toMatchObject({
      phase: 'downloading',
      progress: 42.4,
      newVersion: '2.0.0',
    });

    act(() => {
      listeners.get('update-error')?.({}, { message: 'offline' });
    });
    expect(useDesktopUpdateStore.getState()).toMatchObject({
      phase: 'error',
      errorMessage: 'offline',
    });

    await act(async () => {
      await startDesktopUpdateDownload(ipcRenderer);
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-download');

    act(() => {
      listeners.get('update-downloaded')?.();
    });
    expect(useDesktopUpdateStore.getState().phase).toBe('downloaded');

    await act(async () => {
      await installDesktopUpdate(ipcRenderer);
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('quit-and-install');
    expect(useDesktopUpdateStore.getState().phase).toBe('installing');
  });

  it('keeps the downloaded phase when the app-level listener remounts', () => {
    const first = renderHook(() => useDesktopUpdater(), { wrapper });
    act(() => {
      listeners.get('update-downloaded')?.();
    });
    first.unmount();

    renderHook(() => useDesktopUpdater(), { wrapper });
    expect(useDesktopUpdateStore.getState().phase).toBe('downloaded');
  });

  it('is safe without an Electron host', () => {
    expect(() => renderHook(() => useDesktopUpdater())).not.toThrow();
    expect(useDesktopUpdateStore.getState().phase).toBe('idle');
  });
});

describe('useDesktopUpdater background checks', () => {
  const MINUTE = 60_000;
  const listeners = new Map<string, (...args: any[]) => void>();
  let checkResult: unknown;
  const ipcRenderer = {
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'get-update-check-config') return { intervalMinutes: 1 };
      if (channel === 'check-update') return checkResult;
      return undefined;
    }),
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      listeners.set(channel, listener);
    }),
    off: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    }),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HostProvider host={{ electronAPI: null, ipcRenderer }}>
      {children}
    </HostProvider>
  );
  const checkCount = () =>
    ipcRenderer.invoke.mock.calls.filter(
      ([channel]) => channel === 'check-update'
    ).length;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    listeners.clear();
    sessionStorage.clear();
    resetDesktopUpdateStore();
    checkResult = { updateAvailable: false, version: '1.0.0' };
    vi.mocked(isLocalTaskRunning).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a 4 to 6 hour schedule unless a tester overrides it', () => {
    expect(backgroundUpdateSchedule(null)).toMatchObject({
      intervalMs: 4 * 60 * MINUTE,
      jitterMs: 2 * 60 * MINUTE,
    });
    expect(backgroundUpdateSchedule(0)).toMatchObject({
      intervalMs: 4 * 60 * MINUTE,
    });
    expect(backgroundUpdateSchedule(2)).toMatchObject({
      intervalMs: 2 * MINUTE,
      jitterMs: 0,
    });
  });

  it('checks again after the interval while the app stays open', async () => {
    const hook = renderHook(() => useDesktopUpdater(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(checkCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE + 15_000);
    });
    expect(checkCount()).toBe(2);
    expect(useDesktopUpdateStore.getState().phase).toBe('idle');

    hook.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * MINUTE);
    });
    expect(checkCount()).toBe(2);
  });

  it('waits for a running task to finish before checking', async () => {
    vi.mocked(isLocalTaskRunning).mockResolvedValue(true);
    renderHook(() => useDesktopUpdater(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
    });
    // Only the launch check ran.
    expect(checkCount()).toBe(1);
    expect(isLocalTaskRunning).toHaveBeenCalled();

    vi.mocked(isLocalTaskRunning).mockResolvedValue(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(checkCount()).toBe(2);
  });

  it('does not check or prompt again while an update is pending', async () => {
    sessionStorage.setItem(AUTO_UPDATE_DOWNLOAD_KEY, '1');
    renderHook(() => useDesktopUpdater(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    act(() => {
      listeners.get('update-can-available')?.(
        {},
        { update: true, newVersion: '2.0.0' }
      );
      listeners.get('download-progress')?.({}, { percent: 30 });
    });
    // A repeated "available" must not reset the download in progress.
    act(() => {
      listeners.get('update-can-available')?.(
        {},
        { update: true, newVersion: '2.0.0' }
      );
    });
    expect(useDesktopUpdateStore.getState()).toMatchObject({
      phase: 'downloading',
      progress: 30,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
    });
    expect(checkCount()).toBe(1);

    act(() => {
      listeners.get('update-downloaded')?.();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
    });
    expect(checkCount()).toBe(1);
    expect(useDesktopUpdateStore.getState().phase).toBe('downloaded');
    expect(
      ipcRenderer.invoke.mock.calls.filter(
        ([channel]) => channel === 'start-download'
      )
    ).toHaveLength(0);
  });

  it('retries a failed check when the network comes back', async () => {
    checkResult = null;
    renderHook(() => useDesktopUpdater(), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(checkCount()).toBe(1);

    checkResult = { updateAvailable: false, version: '1.0.0' };
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(checkCount()).toBe(2);

    // Once a check succeeded, reconnecting alone does not check again.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(checkCount()).toBe(2);
  });
});
