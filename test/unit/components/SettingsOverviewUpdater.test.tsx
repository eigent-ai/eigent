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

import { AboutSettings } from '@/components/Settings/SettingsOverview';
import { HostProvider } from '@/host';
import {
  resetDesktopUpdateStore,
  useDesktopUpdateStore,
} from '@/store/updateStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/use-app-version', () => ({ default: () => '1.9.0' }));

describe('Settings Overview updater', () => {
  const ipcRenderer = {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  const renderAbout = (withIpc = true) =>
    render(
      <HostProvider
        host={{
          electronAPI: withIpc ? {} : null,
          ipcRenderer: withIpc ? ipcRenderer : null,
        }}
      >
        <AboutSettings />
      </HostProvider>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    resetDesktopUpdateStore();
  });

  it('renders update, progress, retry, and install actions from global state', () => {
    act(() => {
      useDesktopUpdateStore.getState().setAvailable('2.0.0');
    });
    const view = renderAbout();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-download');

    act(() => {
      useDesktopUpdateStore.getState().setProgress(37);
    });
    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '37');
    expect(progressbar.firstElementChild).toHaveClass(
      'bg-ds-neutral-subtle-default'
    );

    act(() => {
      useDesktopUpdateStore.getState().setError('offline');
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Update failed — click to retry',
      })
    );
    expect(
      ipcRenderer.invoke.mock.calls.filter(
        ([channel]) => channel === 'start-download'
      )
    ).toHaveLength(2);

    act(() => {
      useDesktopUpdateStore.getState().setDownloaded();
    });
    view.unmount();
    renderAbout();
    fireEvent.click(screen.getByRole('button', { name: 'Launch new version' }));
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('quit-and-install');
  });

  it('falls back to the version action without Electron IPC', () => {
    renderAbout(false);
    expect(screen.getByRole('button', { name: 'Version' })).toHaveTextContent(
      '1.9.0'
    );
  });
});
