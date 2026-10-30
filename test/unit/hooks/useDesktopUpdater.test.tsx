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
  installDesktopUpdate,
  startDesktopUpdateDownload,
  useDesktopUpdater,
} from '@/hooks/useDesktopUpdater';
import { HostProvider } from '@/host';
import {
  resetDesktopUpdateStore,
  useDesktopUpdateStore,
} from '@/store/updateStore';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
