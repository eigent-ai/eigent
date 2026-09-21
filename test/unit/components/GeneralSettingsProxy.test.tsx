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

// These tests protect the persisted Network Proxy baseline: loading and saving
// establish it, edits enable Save and Reset, and Reset never writes to disk.
// They also cover disabling an existing proxy and the restart-required action.

import SettingGeneral from '@/components/Settings/General';
import { HostProvider } from '@/host';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencyMocks = vi.hoisted(() => ({
  clearTasks: vi.fn(),
  logout: vi.fn(),
  resetInstallation: vi.fn(),
  setLanguage: vi.fn(),
  setNeedsBackendRestart: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: { clearTasks: dependencyMocks.clearTasks },
  }),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    language: 'en-US',
    setLanguage: dependencyMocks.setLanguage,
  }),
  useAuthStore: () => ({
    email: 'test@example.com',
    language: 'en-US',
    logout: dependencyMocks.logout,
    setLanguage: dependencyMocks.setLanguage,
  }),
}));

vi.mock('@/store/installationStore', () => ({
  useInstallationStore: (
    selector: (state: {
      reset: typeof dependencyMocks.resetInstallation;
      setNeedsBackendRestart: typeof dependencyMocks.setNeedsBackendRestart;
    }) => unknown
  ) =>
    selector({
      reset: dependencyMocks.resetInstallation,
      setNeedsBackendRestart: dependencyMocks.setNeedsBackendRestart,
    }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: dependencyMocks.toastError,
    success: dependencyMocks.toastSuccess,
  },
}));

type ProxyElectronAPI = {
  envRemove: ReturnType<typeof vi.fn>;
  envWrite: ReturnType<typeof vi.fn>;
  readGlobalEnv: ReturnType<typeof vi.fn>;
  restartApp: ReturnType<typeof vi.fn>;
};

function renderProxySettings(
  loadedValue: string | undefined,
  overrides: Partial<ProxyElectronAPI> = {}
) {
  const electronAPI = {
    envRemove: vi.fn().mockResolvedValue({ success: true }),
    envWrite: vi.fn().mockResolvedValue({ success: true }),
    readGlobalEnv: vi.fn().mockResolvedValue({ value: loadedValue }),
    restartApp: vi.fn(),
    ...overrides,
  };

  render(
    <HostProvider host={{ electronAPI, ipcRenderer: null }}>
      <MemoryRouter>
        <SettingGeneral section="network-proxy" />
      </MemoryRouter>
    </HostProvider>
  );

  return electronAPI;
}

describe('General settings Network Proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the saved proxy as the disabled action baseline', async () => {
    const electronAPI = renderProxySettings('http://saved-proxy:8080');

    expect(
      await screen.findByDisplayValue('http://saved-proxy:8080')
    ).toBeEnabled();
    expect(electronAPI.readGlobalEnv).toHaveBeenCalledWith('HTTP_PROXY');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('enables Save and Reset for an edit, then resets without writing', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://edited-proxy:9090');

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    const resetButton = screen.getByRole('button', { name: 'Reset' });
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);

    expect(input).toHaveValue('http://saved-proxy:8080');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(resetButton).toBeDisabled();
    expect(electronAPI.envWrite).not.toHaveBeenCalled();
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
  });

  it('keeps Reset available for a whitespace-only edit', async () => {
    const user = userEvent.setup();
    renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.type(input, '   ');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const resetButton = screen.getByRole('button', { name: 'Reset' });
    expect(resetButton).toBeEnabled();

    await user.click(resetButton);

    expect(input).toHaveValue('http://saved-proxy:8080');
    expect(resetButton).toBeDisabled();
  });

  it('uses a successful save as the new reset baseline', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://new-proxy:9090');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(electronAPI.envWrite).toHaveBeenCalledWith('test@example.com', {
        key: 'HTTP_PROXY',
        value: 'http://new-proxy:9090',
      });
      expect(
        screen.getByRole('button', { name: 'Restart to Apply' })
      ).toBeEnabled();
      expect(
        screen.getByText('Restart required to apply proxy changes.')
      ).toBeInTheDocument();
    });

    await user.clear(input);
    await user.type(input, 'http://another-proxy:7070');
    expect(
      screen.queryByText('Restart required to apply proxy changes.')
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(input).toHaveValue('http://new-proxy:9090');
    expect(electronAPI.envWrite).toHaveBeenCalledTimes(1);
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Restart to Apply' })
    ).toBeEnabled();
    expect(
      screen.getByText('Restart required to apply proxy changes.')
    ).toBeInTheDocument();
  });

  it('rejects an invalid URL without writing or disabling Reset', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'ftp://invalid-proxy');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(dependencyMocks.toastError).toHaveBeenCalledWith(
      'Invalid proxy URL. Must start with http://, https://, socks4://, or socks5://.'
    );
    expect(electronAPI.envWrite).not.toHaveBeenCalled();
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  it('keeps the loaded baseline after a failed save', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const envWrite = vi.fn().mockResolvedValue({ success: false });
    const electronAPI = renderProxySettings('http://saved-proxy:8080', {
      envWrite,
    });
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://failed-proxy:9090');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(dependencyMocks.toastError).toHaveBeenCalledWith(
        'Failed to save proxy configuration.'
      );
    });
    expect(input).toHaveValue('http://failed-proxy:9090');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(input).toHaveValue('http://saved-proxy:8080');
    expect(electronAPI.envWrite).toHaveBeenCalledTimes(1);
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('disables Reset while a save is in flight', async () => {
    const user = userEvent.setup();
    let resolveSave: (result: { success: boolean }) => void = () => {};
    const envWrite = vi.fn(
      () =>
        new Promise<{ success: boolean }>((resolve) => {
          resolveSave = resolve;
        })
    );
    renderProxySettings('http://saved-proxy:8080', { envWrite });
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://pending-proxy:9090');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(envWrite).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();

    await act(async () => {
      resolveSave({ success: true });
    });

    expect(
      await screen.findByRole('button', { name: 'Restart to Apply' })
    ).toBeEnabled();
  });

  it('resets edits to an empty loaded proxy without removing it', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings(undefined);
    const input = screen.getByPlaceholderText('http://127.0.0.1:7890');

    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue('');

    await user.type(input, 'socks5://temporary-proxy:1080');
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(input).toHaveValue('');
    expect(electronAPI.envWrite).not.toHaveBeenCalled();
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves an empty proxy with envRemove and keeps Restart to Apply', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(electronAPI.envRemove).toHaveBeenCalledWith(
        'test@example.com',
        'HTTP_PROXY'
      );
      expect(
        screen.getByRole('button', { name: 'Restart to Apply' })
      ).toBeEnabled();
    });
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });
});
