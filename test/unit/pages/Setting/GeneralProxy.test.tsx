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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingGeneral from '@/pages/Setting/General';

vi.mock('react-i18next', () => ({
  Trans: ({ children }: { children: React.ReactNode }) => children,
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockClearTasks = vi.fn();

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: {
      clearTasks: mockClearTasks,
    },
  }),
}));

const mockResetInstallation = vi.fn();
const mockSetNeedsBackendRestart = vi.fn();

vi.mock('@/store/installationStore', async () => {
  const actual =
    await vi.importActual<typeof import('@/store/installationStore')>(
      '@/store/installationStore'
    );
  return {
    ...actual,
    useInstallationStore: (selector: any) =>
      selector({
        reset: mockResetInstallation,
        setNeedsBackendRestart: mockSetNeedsBackendRestart,
      }),
  };
});

const mockLogout = vi.fn();

vi.mock('@/store/authStore', async () => {
  const actual = await vi.importActual<typeof import('@/store/authStore')>(
    '@/store/authStore'
  );
  return {
    ...actual,
    useAuthStore: () => ({
      email: 'test@example.com',
      appearance: 'dark',
      language: 'system',
      setAppearance: vi.fn(),
      setLanguage: vi.fn(),
      logout: mockLogout,
    }),
    getAuthStore: () => ({
      token: 'token',
    }),
  };
});

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: (msg: string) => toastErrorMock(msg),
    success: (msg: string) => toastSuccessMock(msg),
  },
}));

const navigateMock = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom'
  );
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('SettingGeneral Network Proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (window as any).electronAPI = {
      getPlatform: () => 'linux',
      readGlobalEnv: vi.fn().mockResolvedValue({ value: 'http://proxy:8080' }),
      envWrite: vi.fn().mockResolvedValue({ success: true }),
      envRemove: vi.fn().mockResolvedValue({ success: true }),
      restartApp: vi.fn(),
    };
  });

  it('loads existing proxy value and disables save button until changed', async () => {
    render(<SettingGeneral />);

    const input = await screen.findByPlaceholderText(
      'setting.proxy-placeholder'
    );
    expect((input as HTMLInputElement).value).toBe('http://proxy:8080');

    const button = screen.getByRole('button', { name: 'setting.save' });
    expect(button).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'http://proxy:9090');

    expect(button).not.toBeDisabled();
  });

  it('validates proxy URL and shows error for invalid protocol', async () => {
    render(<SettingGeneral />);

    const input = await screen.findByPlaceholderText(
      'setting.proxy-placeholder'
    );

    await userEvent.clear(input);
    await userEvent.type(input, 'ftp://invalid-proxy');

    const button = screen.getByRole('button', { name: 'setting.save' });
    await userEvent.click(button);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('setting.proxy-invalid-url');
    });
  });

  it('saves proxy URL and requires restart', async () => {
    render(<SettingGeneral />);

    const input = await screen.findByPlaceholderText(
      'setting.proxy-placeholder'
    );

    await userEvent.clear(input);
    await userEvent.type(input, 'http://proxy:9090');

    const button = screen.getByRole('button', { name: 'setting.save' });
    await userEvent.click(button);

    await waitFor(() => {
      expect((window as any).electronAPI.envWrite).toHaveBeenCalledWith(
        'test@example.com',
        {
          key: 'HTTP_PROXY',
          value: 'http://proxy:9090',
        }
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        'setting.proxy-saved-restart-required'
      );
    });

    // Button should now show restart label and trigger restart
    const restartButton = screen.getByRole('button', {
      name: 'setting.restart-to-apply',
    });
    await userEvent.click(restartButton);

    expect((window as any).electronAPI.restartApp).toHaveBeenCalled();
  });
  it('removes proxy when input cleared', async () => {
    // Start with existing value
    render(<SettingGeneral />);

    const input = await screen.findByPlaceholderText(
      'setting.proxy-placeholder'
    );

    await userEvent.clear(input);

    const button = screen.getByRole('button', { name: 'setting.save' });
    await userEvent.click(button);

    await waitFor(() => {
      expect((window as any).electronAPI.envRemove).toHaveBeenCalledWith(
        'test@example.com',
        'HTTP_PROXY'
      );
      expect(toastSuccessMock).toHaveBeenCalledWith(
        'setting.proxy-saved-restart-required'
      );
    });
  });

  it('shows error when electron env APIs are missing', async () => {
    (window as any).electronAPI = {
      getPlatform: () => 'linux',
      readGlobalEnv: vi.fn().mockResolvedValue({ value: '' }),
      // envWrite/envRemove intentionally omitted
    };

    render(<SettingGeneral />);

    const input = await screen.findByPlaceholderText(
      'setting.proxy-placeholder'
    );
    await userEvent.type(input, 'http://proxy:8080');

    const button = screen.getByRole('button', { name: 'setting.save' });
    await userEvent.click(button);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('setting.proxy-save-failed');
    });
  });
});

