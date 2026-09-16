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
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
  fetchPost: vi.fn(),
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

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
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
  fetchPost: mocks.fetchPost,
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
    mocks.fetchPost.mockReset();
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

  it('opens an unconfigured local model on its settings tab', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      })
    );
    openSettings('models', { modelProvider: 'ollama' });
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
      await screen.findByDisplayValue('http://localhost:11434/v1')
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(useSettingsStore.getState().modelProvider).toBeNull()
    );
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
    mocks.fetchPost
      .mockRejectedValueOnce(
        Object.assign(new Error('backend error'), { status: 401 })
      )
      .mockResolvedValueOnce({ data: [{ id: 'ling-chat' }] });
    const input = await renderAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    const message =
      'Invalid API key. Check your API key and click Refresh again.';
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(message));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox')).not.toHaveAccessibleDescription(
      message
    );
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(
      screen.queryByText(
        'Enter your API key, click Refresh, then select a model from the dropdown.'
      )
    ).toBeInTheDocument();
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

  it('dismisses a failed Refresh toast after a successful retry', async () => {
    mocks.fetchPost
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: [{ id: 'ling-chat' }] });
    await renderAntLing();
    const refresh = screen.getByRole('button', {
      name: 'Refresh Ant Ling models',
    });
    fireEvent.click(refresh);
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    mocks.toastDismiss.mockClear();
    fireEvent.click(refresh);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
    expect(mocks.toastDismiss).toHaveBeenCalledWith('model-error-toast');
  });

  it('keeps a Save validation error while the model list refreshes', async () => {
    localStorage.setItem(
      'eigent-provider-models-v1:ant-ling',
      JSON.stringify([{ provider: 'other', models: [{ id: 'ling-chat' }] }])
    );
    mocks.fetchPost.mockImplementation((url: string) =>
      url === '/model/validate'
        ? Promise.resolve({
            is_valid: false,
            is_tool_calls: false,
            message: 'Model does not support tools',
          })
        : Promise.resolve({ data: [{ id: 'ling-chat' }] })
    );
    const input = await renderAntLing();
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'ling-chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    await waitFor(() =>
      expect(mocks.fetchPost).toHaveBeenCalledWith(
        '/model/list',
        expect.any(Object)
      )
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Model does not support tools')
    ).toBeInTheDocument();
  });

  it('keeps the required API-key error when only the API host changes', async () => {
    const input = await renderAntLing();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(document.getElementById('apiHost-ant-ling')!, {
      target: { value: 'https://example.com/v1' },
    });
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([403, 'network'])(
    'notifies %s failures without marking the key invalid',
    async (failure) => {
      const fetchMock = mocks.fetchPost;
      if (failure === 'network')
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      else
        fetchMock.mockRejectedValue(
          Object.assign(new Error('backend error'), { status: failure })
        );
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
    let fail!: (error: unknown) => void;
    mocks.fetchPost.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const input = await renderAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    fireEvent.change(input, { target: { value: 'new-key' } });
    await act(async () =>
      fail(Object.assign(new Error('backend error'), { status: 401 }))
    );
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
  it('clears failed Refresh feedback and notifications on Reset', async () => {
    mocks.fetchPost.mockRejectedValue(
      Object.assign(new Error('backend error'), { status: 401 })
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
    mocks.fetchPost.mockResolvedValue({ data: [{ id: 'ling-chat' }] });
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
      let fail!: (error: unknown) => void;
      mocks.fetchPost.mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            finish = resolve;
            fail = reject;
          })
      );
      const input = await renderAntLing();
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh Ant Ling models' })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      await waitFor(() => expect(input).toHaveValue(''));
      await act(async () => {
        if (status === 200) finish({ data: [{ id: 'ling-chat' }] });
        else fail(Object.assign(new Error('backend error'), { status }));
      });
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
