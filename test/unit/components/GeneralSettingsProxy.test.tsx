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

// The Network Proxy row exposes a single action button: it reads "Save" while
// the input differs from the persisted baseline and "Reset" once they match,
// where Reset clears the saved proxy. Restarting is offered from the toast and
// echoed by the note under the input, never by the button itself.

import SettingGeneral from '@/components/Settings/General';
import { HostProvider } from '@/host';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const RESTART_NOTE = 'Restart required to apply proxy changes.';

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

/** The row renders exactly one action button, whatever it currently reads. */
function actionButton() {
  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

/** Options passed alongside the most recent success toast. */
function lastSuccessToastAction() {
  const calls = dependencyMocks.toastSuccess.mock.calls;
  const [, options] = calls[calls.length - 1] as [
    string,
    { action?: { label: string; onClick: () => void } } | undefined,
  ];
  return options?.action;
}

describe('General settings Network Proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a single Reset action for a saved proxy', async () => {
    const electronAPI = renderProxySettings('http://saved-proxy:8080');

    expect(
      await screen.findByDisplayValue('http://saved-proxy:8080')
    ).toBeEnabled();
    expect(electronAPI.readGlobalEnv).toHaveBeenCalledWith('HTTP_PROXY');

    const button = actionButton();
    expect(button).toHaveTextContent('Reset');
    expect(button).toBeEnabled();
    expect(screen.queryByText(RESTART_NOTE)).not.toBeInTheDocument();
  });

  it('nests the action inside the input field', async () => {
    renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    // The button sits in the field row beside the <input>, not in a sibling
    // block underneath it.
    const field = input.parentElement;
    expect(field).not.toBeNull();
    expect(field).toContainElement(actionButton());
    // Padding keeps a long URL from sliding under the nested button.
    expect(input).toHaveClass('pr-24');
  });

  it('disables the action when there is no saved proxy to clear', async () => {
    renderProxySettings(undefined);
    const input = screen.getByPlaceholderText('http://127.0.0.1:7890');

    await waitFor(() => expect(input).toBeEnabled());
    expect(input).toHaveValue('');

    const button = actionButton();
    expect(button).toHaveTextContent('Reset');
    expect(button).toBeDisabled();
  });

  it('switches the action to Save while the input is edited', async () => {
    const user = userEvent.setup();
    renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://edited-proxy:9090');

    const button = actionButton();
    expect(button).toHaveTextContent('Save');
    expect(button).toBeEnabled();
  });

  it('treats a whitespace-only edit as Save, never as Reset', async () => {
    const user = userEvent.setup();
    renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.type(input, '   ');

    // Guards the destructive path: the button must not read "Reset" under a
    // field the user has typed into, even when the change trims away to nothing.
    const button = actionButton();
    expect(button).toHaveTextContent('Save');
    expect(button).toBeEnabled();
  });

  it('saves an edit, then returns the action to Reset', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://new-proxy:9090');
    await user.click(actionButton());

    await waitFor(() => {
      expect(electronAPI.envWrite).toHaveBeenCalledWith('test@example.com', {
        key: 'HTTP_PROXY',
        value: 'http://new-proxy:9090',
      });
    });

    expect(dependencyMocks.toastSuccess).toHaveBeenCalledWith(
      'Proxy configuration saved. Restart the app to apply changes.',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Restart to Apply' }),
      })
    );
    // A DsText span on the `meta` role, tinted with the error tone so the
    // pending restart is hard to miss while the field itself stays valid.
    const note = screen.getByText(RESTART_NOTE);
    expect(note.tagName).toBe('SPAN');
    // Both survive tailwind-merge: the role owns the size, the class the color.
    expect(note).toHaveClass('!text-ds-text-meta');
    expect(note).toHaveClass('text-ds-text-status-error-strong-default');
    expect(input).not.toHaveClass(
      'border-ds-border-status-error-default-default'
    );

    const button = actionButton();
    expect(button).toHaveTextContent('Reset');
    expect(button).toBeEnabled();
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
  });

  it('restarts from the toast action rather than the button', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://new-proxy:9090');
    await user.click(actionButton());

    await waitFor(() => expect(electronAPI.envWrite).toHaveBeenCalledTimes(1));

    expect(
      screen.queryByRole('button', { name: 'Restart to Apply' })
    ).not.toBeInTheDocument();

    const action = lastSuccessToastAction();
    expect(action?.label).toBe('Restart to Apply');
    act(() => action?.onClick());
    expect(electronAPI.restartApp).toHaveBeenCalledTimes(1);
  });

  it('clears the saved proxy when Reset is used', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.click(actionButton());

    await waitFor(() => {
      expect(electronAPI.envRemove).toHaveBeenCalledWith(
        'test@example.com',
        'HTTP_PROXY'
      );
    });

    expect(input).toHaveValue('');
    expect(electronAPI.envWrite).not.toHaveBeenCalled();
    expect(dependencyMocks.toastSuccess).toHaveBeenCalledWith(
      'Proxy configuration cleared. Restart the app to apply changes.',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Restart to Apply' }),
      })
    );
    expect(screen.getByText(RESTART_NOTE)).toBeInTheDocument();

    // Baseline is now empty, so there is nothing left to clear.
    const button = actionButton();
    expect(button).toHaveTextContent('Reset');
    expect(button).toBeDisabled();
  });

  it('keeps the saved proxy when the reset write fails', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const envRemove = vi.fn().mockResolvedValue({ success: false });
    renderProxySettings('http://saved-proxy:8080', { envRemove });
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.click(actionButton());

    await waitFor(() => {
      expect(dependencyMocks.toastError).toHaveBeenCalledWith(
        'Failed to reset proxy configuration.'
      );
    });
    expect(input).toHaveValue('http://saved-proxy:8080');
    expect(actionButton()).toHaveTextContent('Reset');
    expect(screen.queryByText(RESTART_NOTE)).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('saves an emptied field with envRemove', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    expect(actionButton()).toHaveTextContent('Save');
    await user.click(actionButton());

    await waitFor(() => {
      expect(electronAPI.envRemove).toHaveBeenCalledWith(
        'test@example.com',
        'HTTP_PROXY'
      );
    });
    expect(input).toHaveValue('');
    expect(actionButton()).toBeDisabled();
  });

  it('rejects an invalid URL without writing', async () => {
    const user = userEvent.setup();
    const electronAPI = renderProxySettings('http://saved-proxy:8080');
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'ftp://invalid-proxy');
    await user.click(actionButton());

    expect(dependencyMocks.toastError).toHaveBeenCalledWith(
      'Invalid proxy URL. Must start with http://, https://, socks4://, or socks5://.'
    );
    expect(electronAPI.envWrite).not.toHaveBeenCalled();
    expect(electronAPI.envRemove).not.toHaveBeenCalled();
    expect(actionButton()).toHaveTextContent('Save');
  });

  it('keeps the edit and the baseline after a failed save', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const envWrite = vi.fn().mockResolvedValue({ success: false });
    renderProxySettings('http://saved-proxy:8080', { envWrite });
    const input = await screen.findByDisplayValue('http://saved-proxy:8080');

    await user.clear(input);
    await user.type(input, 'http://failed-proxy:9090');
    await user.click(actionButton());

    await waitFor(() => {
      expect(dependencyMocks.toastError).toHaveBeenCalledWith(
        'Failed to save proxy configuration.'
      );
    });
    expect(input).toHaveValue('http://failed-proxy:9090');
    expect(actionButton()).toHaveTextContent('Save');
    errorSpy.mockRestore();
  });

  it('disables the action while a save is in flight', async () => {
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
    await user.click(actionButton());

    await waitFor(() => expect(envWrite).toHaveBeenCalledTimes(1));
    expect(actionButton()).toHaveTextContent('Saving...');
    expect(actionButton()).toBeDisabled();

    await act(async () => {
      resolveSave({ success: true });
    });

    await waitFor(() => expect(actionButton()).toHaveTextContent('Reset'));
    expect(actionButton()).toBeEnabled();
  });
});
