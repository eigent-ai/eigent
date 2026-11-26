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

import SettingModels from '@/components/Settings/Models';
import { HostProvider } from '@/host/context';
import type { AppHost } from '@/host/types';
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  openSettings: vi.fn(),
  auth: {
    user_id: 1,
    email: '',
    modelType: 'cloud',
    cloud_model_type: 'gpt',
    codex_model_type: 'gpt',
    appearance: 'light',
    setModelType: vi.fn(),
    setCloudModelType: vi.fn(),
  },
  cloud: {
    models: [{ id: 'gpt', display_name: 'GPT' }],
    fetchCloudModels: vi.fn().mockResolvedValue([]),
    getModelDisplayName: (id: string) => id,
    getEffectiveModelId: (id: string) => id,
  },
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: mocks.post,
  proxyFetchPut: vi.fn(),
  proxyFetchDelete: vi.fn(),
  fetchGet: mocks.backendGet,
  fetchPost: mocks.backendPost,
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: Object.assign(() => mocks.auth, { getState: () => mocks.auth }),
  getAuthStore: () => mocks.auth,
}));
vi.mock('@/store/cloudModelStore', () => ({
  useCloudModelStore: (selector: (state: typeof mocks.cloud) => unknown) =>
    selector(mocks.cloud),
}));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({ ipcRenderer: { on: vi.fn(), off: vi.fn() } }),
}));

const STATUS_URL = '/model/apple-intelligence/status';

const ready = {
  provider: 'apple-intelligence',
  available: true,
  reason: null,
  message: null,
  models: [
    {
      id: 'apple-on-device',
      available: true,
      reason: null,
      context_size: 4096,
      capabilities: ['text'],
    },
  ],
};

function unavailable(reason: string) {
  return { ...ready, available: false, reason, models: [] };
}

function host(platform: string | null): AppHost | null {
  if (platform === null) return null;
  return {
    electronAPI: {
      getPlatform: () => platform,
      openAppleIntelligenceSettings: mocks.openSettings,
    },
    ipcRenderer: { on: vi.fn(), off: vi.fn() },
  } as unknown as AppHost;
}

function renderPage(platform: string | null) {
  const page = (
    <MemoryRouter initialEntries={['/settings?tab=models']}>
      <SettingModels />
    </MemoryRouter>
  );
  const value = host(platform);
  return render(
    value ? <HostProvider host={value}>{page}</HostProvider> : page
  );
}

async function openProviderList() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Add model' }));
  return { user, dialog: screen.getByRole('dialog', { name: 'Add provider' }) };
}

async function openAppleIntelligence() {
  const { user, dialog } = await openProviderList();
  await user.click(
    within(dialog).getByRole('button', { name: 'Apple Intelligence' })
  );
  return {
    user,
    dialog: await screen.findByRole('dialog', { name: 'Apple Intelligence' }),
  };
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ items: [] });
  mocks.post.mockResolvedValue({ id: 21 });
  mocks.backendGet.mockResolvedValue(ready);
  mocks.backendPost.mockResolvedValue({ ok: true, elapsed_ms: 1234 });
  useSettingsStore.setState({ modelProvider: null });
  useModelVisibilityStore.setState({ hiddenByAccount: {} });
  useUsageNoticeStore.setState({
    account: null,
    credits: 1250,
    refreshing: false,
    subscription: { plan_key: 'free' },
  });
});

describe('Apple Intelligence provider', () => {
  it.each([
    ['Windows', 'win32'],
    ['Linux', 'linux'],
    ['the web client', null],
  ])('is not offered on %s and asks nothing', async (_name, platform) => {
    renderPage(platform);
    const { dialog } = await openProviderList();

    expect(
      within(dialog).queryByRole('button', { name: 'Apple Intelligence' })
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Ollama' })
    ).toBeInTheDocument();
    expect(mocks.backendGet).not.toHaveBeenCalledWith(
      STATUS_URL,
      expect.anything()
    );
    expect(mocks.backendGet).not.toHaveBeenCalledWith(STATUS_URL, undefined);
  });

  it('does not start the bridge until the provider is opened on macOS', async () => {
    renderPage('darwin');
    const { dialog } = await openProviderList();

    expect(
      within(dialog).getByRole('button', { name: 'Apple Intelligence' })
    ).toBeInTheDocument();
    expect(mocks.backendGet).not.toHaveBeenCalled();
  });

  it('adds the on-device model with no endpoint or key when ready', async () => {
    renderPage('darwin');
    const { user, dialog } = await openAppleIntelligence();

    expect(
      await within(dialog).findByText(
        'Apple Intelligence is ready on this Mac.'
      )
    ).toBeInTheDocument();
    expect(mocks.backendGet).toHaveBeenCalledWith(STATUS_URL, undefined);
    expect(within(dialog).getByText('Text only')).toBeInTheDocument();
    expect(within(dialog).getByText('Context 4K')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Add model' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/v1/provider', {
        provider_name: 'apple-intelligence',
        model_type: 'apple-on-device',
        api_key: 'not-required',
        endpoint_url: '',
        is_valid: 2,
        prefer: false,
        encrypted_config: {
          model_platform: 'apple-intelligence',
          model_type: 'apple-on-device',
        },
      })
    );
  });

  it('runs a test generation and shows how long it took', async () => {
    renderPage('darwin');
    const { user, dialog } = await openAppleIntelligence();
    await within(dialog).findByText('Apple Intelligence is ready on this Mac.');

    await user.click(within(dialog).getByRole('button', { name: 'Test' }));

    expect(
      await within(dialog).findByText('Test passed in 1.2 s.')
    ).toBeInTheDocument();
    expect(mocks.backendPost).toHaveBeenCalledWith(
      '/model/apple-intelligence/test'
    );
  });

  it.each([
    [
      'not_apple_silicon',
      'Not available on this Mac. Apple Intelligence needs a Mac with Apple silicon.',
    ],
    ['unsupported_os', 'Requires macOS 26 or later.'],
    ['not_eligible', "This Mac doesn't support Apple Intelligence."],
    ['model_not_ready', 'The model is still downloading.'],
    ['bridge_missing', 'Not available in this build.'],
  ])(
    'shows an unsupported Mac why it cannot run (%s)',
    async (reason, text) => {
      mocks.backendGet.mockResolvedValue(unavailable(reason));
      renderPage('darwin');
      const { dialog } = await openAppleIntelligence();

      expect(await within(dialog).findByText(text)).toBeInTheDocument();
      expect(within(dialog).getByText('Not available')).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: 'Add model' })
      ).toBeDisabled();
      expect(
        within(dialog).getByRole('button', { name: 'Test' })
      ).toBeDisabled();
    }
  );

  it('offers System Settings when Apple Intelligence is off', async () => {
    mocks.backendGet.mockResolvedValue(unavailable('apple_intelligence_off'));
    renderPage('darwin');
    const { user, dialog } = await openAppleIntelligence();

    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Open System Settings',
      })
    );
    expect(mocks.openSettings).toHaveBeenCalledOnce();

    mocks.backendGet.mockResolvedValue(ready);
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(mocks.backendGet).toHaveBeenLastCalledWith(STATUS_URL, {
      refresh: true,
    });
    expect(
      await within(dialog).findByText(
        'Apple Intelligence is ready on this Mac.'
      )
    ).toBeInTheDocument();
  });

  it('keeps Settings usable when the status cannot be read', async () => {
    mocks.backendGet.mockRejectedValue(new Error('offline'));
    renderPage('darwin');
    const { dialog } = await openAppleIntelligence();

    expect(
      await within(dialog).findByText(
        "The Apple Intelligence helper isn't responding."
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Add model' })
    ).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Back' })).toBeEnabled();
  });

  it('names saved Apple Intelligence models', async () => {
    mocks.get.mockResolvedValue({
      items: [
        {
          id: 21,
          provider_name: 'apple-intelligence',
          model_type: 'apple-on-device',
          api_key: 'not-required',
          endpoint_url: '',
          is_valid: 2,
          prefer: false,
        },
      ],
    });
    renderPage('darwin');

    expect(await screen.findByText('apple-on-device')).toBeInTheDocument();
    expect(screen.getAllByText('Apple Intelligence').length).toBeGreaterThan(0);
  });
});
