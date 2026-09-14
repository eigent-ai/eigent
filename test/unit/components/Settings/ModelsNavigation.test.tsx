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

import { SettingsRouteBridge } from '@/components/Layout';
import SettingModels from '@/components/Settings/Models';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
  auth: {
    modelType: 'cloud',
    cloud_model_type: 'gpt-5.5',
    email: '',
    appearance: 'light',
  },
  cloud: {
    models: [],
    fetchCloudModels: vi.fn().mockResolvedValue([]),
    getModelDisplayName: (id: string) => id,
    getEffectiveModelId: (id: string) => id,
  },
}));
// Keep t stable like react-i18next so provider hydration does not rerun on each keystroke.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const i18next = (await import('i18next')).default;
  const translation = { t: i18next.t.bind(i18next), i18n: i18next };
  return { ...actual, useTranslation: () => translation };
});
vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    dismiss: mocks.toastDismiss,
  },
}));
vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: async (action: () => void) => {
    action();
    return true;
  },
}));
// The route bridge is real; installation and shell UI are outside this test.
vi.mock('@/components/InstallStep/InstallDependencies', () => ({
  InstallDependencies: () => null,
}));
vi.mock(
  '@/components/InstallStep/InstallationErrorDialog/InstallationErrorDialog',
  () => ({ default: () => null })
);
vi.mock('@/components/TopBar', () => ({ default: () => null }));
vi.mock('@/hooks/useChatStoreAdapter', () => ({ default: vi.fn() }));
vi.mock('@/hooks/useDesktopUpdater', () => ({ useDesktopUpdater: vi.fn() }));
vi.mock('@/hooks/useInstallationSetup', () => ({
  useInstallationSetup: vi.fn(),
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn().mockResolvedValue([]),
  fetchPost: vi.fn(),
  proxyFetchPost: vi.fn(),
  proxyFetchPut: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(() => mocks.auth, { getState: () => mocks.auth }),
}));
vi.mock('@/store/cloudModelStore', () => ({
  useCloudModelStore: (selector: (state: typeof mocks.cloud) => unknown) =>
    selector(mocks.cloud),
}));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({ ipcRenderer: { on: vi.fn(), off: vi.fn() } }),
}));

describe('Models provider navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.toastError.mockReset().mockReturnValue('model-error-toast');
    mocks.toastDismiss.mockReset();
    useSettingsStore.setState({ modelProvider: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens Ant Ling configuration and handles another request while mounted', async () => {
    openSettings('models', { modelProvider: 'ant-ling' });
    render(
      <MemoryRouter initialEntries={['/']}>
        <SettingsRouteBridge />
        <Routes>
          <Route path="/" element={<div>Home input</div>} />
          <Route path="/home" element={<SettingModels />} />
        </Routes>
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('combobox', { name: 'Ant Ling model type' })
    ).toBeDisabled();
    expect(document.getElementById('apiKey-ant-ling')).toBeInTheDocument();
    await waitFor(() =>
      expect(useSettingsStore.getState().modelProvider).toBeNull()
    );
    act(() => openSettings('models', { modelProvider: 'openai' }));
    await waitFor(() =>
      expect(document.getElementById('apiKey-openai')).toBeInTheDocument()
    );
    expect(document.getElementById('apiKey-ant-ling')).not.toBeInTheDocument();
  });
  async function renderAntLing() {
    openSettings('models', { modelProvider: 'ant-ling' });
    render(
      <MemoryRouter initialEntries={['/home?section=settings&tab=models']}>
        <SettingsRouteBridge />
        <SettingModels />
      </MemoryRouter>
    );
    await screen.findByRole('combobox', { name: 'Ant Ling model type' });
    const input = document.getElementById(
      'apiKey-ant-ling'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bad-key' } });
    return input;
  }

  it('notifies the full authentication error, marks the key and recovers after editing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [{ id: 'ling-chat' }] }),
        })
    );
    const input = await renderAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    const message =
      'Invalid API key. Check your API key and click Refresh again.';
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(message));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(message);
    expect(
      screen.queryByText(
        'Enter your API key, click Refresh, then select a model from the dropdown.'
      )
    ).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-invalid',
      'false'
    );
    fireEvent.change(input, { target: { value: 'corrected-key' } });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it.each([403, 'network'])(
    'notifies %s failures without marking the key invalid',
    async (failure) => {
      const fetchMock = vi.fn();
      if (failure === 'network')
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      else fetchMock.mockResolvedValue({ ok: false, status: failure });
      vi.stubGlobal('fetch', fetchMock);
      const input = await renderAntLing();
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh Ant Ling models' })
      );
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(
          failure === 'network'
            ? 'Could not load models. Check your connection and API host, then click Refresh again.'
            : 'Access denied. Check your API key permissions and account access, then click Refresh again.'
        )
      );
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-invalid',
        'false'
      );
    }
  );

  it('ignores an old authentication failure after the key is edited', async () => {
    let finish!: (response: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
    );
    const input = await renderAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    fireEvent.change(input, { target: { value: 'new-key' } });
    await act(async () => finish({ ok: false, status: 401 }));
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
  it('clears failed Refresh feedback and notifications on Reset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 })
    );
    const input = await renderAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(
      'Enter your API key, click Refresh, then select a model from the dropdown.'
    );
    expect(mocks.toastDismiss).toHaveBeenCalledWith('model-error-toast');
  });

  it('clears loaded models and their cache on Reset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'ling-chat' }] }),
      })
    );
    const input = await renderAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(input).toHaveValue(''));
    fireEvent.change(input, { target: { value: 'new-key' } });
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(
      localStorage.getItem('eigent-provider-models-v1:ant-ling')
    ).toBeNull();
  });

  it.each([401, 200])(
    'ignores a pending Refresh returning %s after Reset',
    async (status) => {
      let finish!: (response: unknown) => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        )
      );
      const input = await renderAntLing();
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh Ant Ling models' })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await waitFor(() => expect(input).toHaveValue(''));
      await act(async () =>
        finish({
          ok: status === 200,
          status,
          json: async () => ({ data: [{ id: 'ling-chat' }] }),
        })
      );
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-busy',
        'false'
      );
      expect(screen.getByRole('combobox')).toHaveAccessibleDescription(
        'Enter your API key, click Refresh, then select a model from the dropdown.'
      );
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(
        localStorage.getItem('eigent-provider-models-v1:ant-ling')
      ).toBeNull();
    }
  );
});
