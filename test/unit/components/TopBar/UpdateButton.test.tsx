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

import UpdateButton from '@/components/TopBar/UpdateButton';
import { HostProvider } from '@/host';
import {
  resetDesktopUpdateStore,
  useDesktopUpdateStore,
} from '@/store/updateStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('TopBar UpdateButton', () => {
  const ipcRenderer = {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };

  const renderButton = () =>
    render(
      <HostProvider host={{ electronAPI: {}, ipcRenderer }}>
        <UpdateButton />
      </HostProvider>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    resetDesktopUpdateStore();
  });

  it('stays hidden until an update is available', () => {
    renderButton();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the update action and starts the download', () => {
    act(() => {
      useDesktopUpdateStore.getState().setAvailable('2.0.0');
    });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-download');
  });

  it('shows persistent download progress', () => {
    act(() => {
      useDesktopUpdateStore.getState().setProgress(42.4);
    });
    renderButton();

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '42');
    expect(progressbar.firstElementChild).toHaveClass(
      'bg-ds-neutral-subtle-default'
    );
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('shows retry after an error', () => {
    act(() => {
      useDesktopUpdateStore.getState().setError('offline');
    });
    renderButton();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Update failed — click to retry',
      })
    );
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('start-download');
  });

  it('shows the install action after the download completes', () => {
    act(() => {
      useDesktopUpdateStore.getState().setDownloaded();
    });
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Launch new version' }));
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('quit-and-install');
  });
});
