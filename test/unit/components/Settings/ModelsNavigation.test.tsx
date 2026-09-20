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
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  validate: vi.fn(),
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
    models: [
      { id: 'gpt', display_name: 'GPT' },
      { id: 'claude', display_name: 'Claude', min_plan_key: 'plus' },
    ],
    fetchCloudModels: vi.fn().mockResolvedValue([]),
    getModelDisplayName: (id: string) => id,
    getEffectiveModelId: (id: string) => id,
  },
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: mocks.post,
  proxyFetchPut: mocks.put,
  proxyFetchDelete: mocks.remove,
  fetchPost: mocks.validate,
}));
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
vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: async (action: () => void) => {
    action();
    return true;
  },
}));
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

const records = [
  {
    id: 11,
    provider_name: 'openai',
    model_type: 'model-a',
    api_key: 'test-work',
    endpoint_url: 'https://example.com/v1',
    is_valid: 2,
    prefer: false,
  },
  {
    id: 12,
    provider_name: 'openai',
    model_type: 'model-b',
    api_key: 'test-personal',
    endpoint_url: 'https://example.com/v1',
    is_valid: 2,
    prefer: true,
  },
];
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.modelType = 'cloud';
  mocks.auth.user_id = 1;
  mocks.get.mockResolvedValue({ items: records });
  mocks.validate.mockResolvedValue({ is_valid: true, is_tool_calls: true });
  mocks.post.mockResolvedValue({ id: 13 });
  mocks.put.mockResolvedValue({ id: 12 });
  mocks.remove.mockResolvedValue(undefined);
  useSettingsStore.setState({ modelProvider: null });
  useModelVisibilityStore.setState({ hiddenByAccount: {} });
  useUsageNoticeStore.setState({
    account: null,
    credits: 1250,
    refreshing: false,
    subscription: { plan_key: 'free' },
  });
});
function renderPage(provider?: string) {
  return render(
    <MemoryRouter
      initialEntries={[
        `/home?section=settings&tab=models${provider ? `&provider=${provider}` : ''}`,
      ]}
    >
      <SettingModels />
    </MemoryRouter>
  );
}
async function editRecord(model: string) {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('button', { name: `Actions for ${model}` })
  );
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
  return user;
}
async function fillAntLing() {
  renderPage('ant-ling');
  const input = await screen.findByLabelText(/API key setting/i);
  fireEvent.change(input, { target: { value: 'test-only-key' } });
  return input;
}

describe('Models collections and configuration dialogs', () => {
  it('shows model loading beside the Models heading', () => {
    mocks.get.mockReturnValue(new Promise(() => undefined));
    renderPage();

    const toolbar = screen.getByRole('region', { name: 'Models' });
    const heading = within(toolbar).getByRole('heading', { name: 'Models' });
    const loading = within(toolbar).getByRole('status');

    expect(heading.parentElement).toContainElement(loading);
    expect(loading).toHaveTextContent('Loading');
    expect(screen.getAllByRole('status')).toEqual([loading]);
  });

  it('lists every saved record under its provider, not the catalog', async () => {
    renderPage();
    expect(await screen.findByText('model-a')).toBeInTheDocument();
    expect(screen.getByText('model-b')).toBeInTheDocument();
    expect(screen.queryByText('OpenAI | model-a')).not.toBeInTheDocument();
    const toolbar = screen.getByRole('region', { name: 'Models' });
    expect(
      within(toolbar).getByRole('textbox', { name: 'Search configured models' })
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('button', { name: 'Add model' })
    ).toHaveClass('motion-reduce:active:scale-100');
    expect(
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label'))
        .filter(Boolean)
    ).toEqual(['Models', 'All model providers', 'Eigent', 'OpenAI']);
    expect(
      screen.getByRole('region', { name: 'All model providers' })
    ).toBeInTheDocument();
    const eigent = screen.getByRole('region', { name: 'Eigent' });
    expect(within(eigent).getByLabelText('2 Models')).toBeInTheDocument();
    expect(within(eigent).getByLabelText('Credits: 1,250')).toHaveTextContent(
      'Credits:1,250'
    );
    const manageAccount = within(eigent).getByRole('link', {
      name: 'Manage account',
    });
    expect(manageAccount.getAttribute('href')).toMatch(/\/dashboard$/);
    expect(manageAccount).toHaveClass('no-underline', 'hover:no-underline');
    expect(manageAccount.querySelector('svg')).toBeInTheDocument();
    const eigentChevron = within(eigent).getByRole('button', {
      name: 'Eigent',
    });
    expect(eigentChevron.querySelector('svg')).toHaveClass(
      'rotate-90',
      'transition-transform',
      'motion-reduce:transition-none'
    );
    expect(
      eigent.querySelector('header')?.lastElementChild?.lastElementChild
    ).toBe(eigentChevron);
    const defaultEigentRow = within(eigent).getByText('GPT')
      .parentElement as HTMLElement;
    const defaultEigentRowText = defaultEigentRow.textContent ?? '';
    expect(defaultEigentRowText.indexOf('Default')).toBeLessThan(
      defaultEigentRowText.indexOf('Available')
    );
    expect(within(eigent).getByText('Available')).toHaveAttribute(
      'data-tone',
      'success'
    );
    expect(within(eigent).getByText('Unavailable')).toHaveAttribute(
      'data-tone',
      'error'
    );
    const openAi = screen.getByRole('region', { name: 'OpenAI' });
    expect(openAi).toHaveClass('rounded-2xl', 'bg-ds-neutral-default-default');
    expect(within(openAi).getByLabelText('2 Models')).toBeInTheDocument();
    expect(
      within(openAi).queryByText('Your own credentials')
    ).not.toBeInTheDocument();
    const configuredStatuses = within(openAi).getAllByText('Configured');
    expect(configuredStatuses).toHaveLength(2);
    expect(configuredStatuses[0]).toHaveAttribute('data-tone', 'success');
    const modelRow = within(openAi).getByText('model-a')
      .parentElement as HTMLElement;
    expect(modelRow).not.toHaveClass(
      'hover:bg-ds-neutral-default-hover',
      'bg-ds-neutral-subtle-default'
    );
    expect(modelRow.parentElement).toHaveClass(
      'divide-ds-hairline-subtle-disabled',
      'border-ds-hairline-subtle-default'
    );
    expect(screen.queryByText(/Configuration #/)).not.toBeInTheDocument();
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows all provider icons above a Memory-style default model selector', async () => {
    const user = userEvent.setup();
    renderPage();

    const providerBanner = await screen.findByRole('region', {
      name: 'All model providers',
    });
    const defaultTitle = screen.getByText('Default model');
    const defaultSetting = defaultTitle.closest(
      '[data-default-model-setting]'
    ) as HTMLElement;
    expect(providerBanner.parentElement?.parentElement).toHaveClass(
      'gap-ds-24',
      'py-ds-24'
    );
    expect(providerBanner.parentElement).toHaveClass('gap-ds-24');
    expect(defaultSetting).toHaveClass(
      'rounded-2xl',
      'bg-ds-neutral-default-default'
    );

    expect(providerBanner).not.toHaveClass(
      'bg-ds-neutral-default-default',
      'bg-ds-neutral-subtle-default'
    );
    expect(providerBanner).toHaveClass('items-center');
    expect(screen.queryByText('All model providers')).not.toBeInTheDocument();
    expect(within(providerBanner).getByRole('list')).toHaveClass(
      'items-center',
      'gap-ds-12'
    );
    const providerRows = providerBanner.querySelectorAll(
      '[data-provider-icon-row]'
    );
    expect(providerRows).toHaveLength(2);
    expect(
      Math.abs(
        providerRows[0].childElementCount - providerRows[1].childElementCount
      )
    ).toBeLessThanOrEqual(1);
    expect(providerRows[0]).toHaveClass('justify-center', 'gap-ds-12');
    expect(providerRows[1]).toHaveClass('justify-center', 'gap-ds-12');
    expect(
      within(providerBanner).getAllByRole('listitem').length
    ).toBeGreaterThan(1);

    const select = within(defaultSetting).getByRole('button', {
      name: 'Select Default Model: GPT',
    });
    expect(select).toHaveTextContent('GPT');
    expect(select).toHaveClass('bg-ds-neutral-muted-default');
    expect(select.parentElement).toHaveClass('ml-auto');
    await user.click(select);
    const modelMenu = screen.getByRole('menu');
    expect(modelMenu).toHaveAttribute('data-align', 'end');
    expect(modelMenu.querySelector('[data-default-model-options]')).toHaveClass(
      'scrollbar-always-visible',
      'max-h-80',
      'overflow-y-auto'
    );
    expect(
      within(modelMenu)
        .getByRole('group', { name: 'OpenAI' })
        .querySelector('img[alt=""]')
    ).toHaveClass('size-ds-16');
    expect(within(modelMenu).getAllByRole('separator')).toHaveLength(1);
    expect(
      screen.getByRole('menuitemradio', { name: 'model-a' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitemradio', { name: 'Claude' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitemradio', { name: 'model-a' }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/v1/provider/prefer', {
        provider_id: 11,
      })
    );
    const providerIcon = within(providerBanner).getByRole('button', {
      name: 'Anthropic',
    });
    expect(providerIcon).toHaveClass(
      'active:scale-100',
      '!size-[var(--ds-button-xl-height)]'
    );
    expect(providerIcon.querySelector('img')).toHaveClass('size-ds-32');
    await user.click(providerIcon);
    expect(
      await screen.findByRole('dialog', { name: 'Add model · Anthropic' })
    ).toBeInTheDocument();
  });
  it('marks invalid or expired credentials and their model name as errors', async () => {
    mocks.get.mockResolvedValue({
      items: [{ ...records[0], is_valid: 1 }, records[1]],
    });
    renderPage();

    const invalidName = await screen.findByText('model-a');
    const invalidRow = invalidName.parentElement as HTMLElement;
    const invalidStatus = within(invalidRow).getByText('Not configured');

    expect(invalidName).toHaveClass('text-ds-text-error-default-default');
    expect(invalidStatus).toHaveAttribute('data-tone', 'error');
    expect(
      within(invalidRow).queryByText(/Configuration #/)
    ).not.toBeInTheDocument();
  });
  it('edits only the selected configuration ID and preserves its default flag', async () => {
    renderPage();
    await editRecord('model-b');
    expect(screen.getByDisplayValue('test-personal')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Model type setting/i), {
      target: { value: 'model-b-updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        '/api/v1/provider/12',
        expect.objectContaining({
          model_type: 'model-b-updated',
          api_key: 'test-personal',
          prefer: true,
        })
      )
    );
    expect(mocks.post).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });
  it('adds a second model with fresh credentials without replacing the existing model or default', async () => {
    renderPage('openai');
    const input = await screen.findByLabelText(/API key setting/i);
    expect(input).toHaveValue('');
    expect(input).toHaveAttribute('placeholder', 'Enter your API key');
    const modelType = screen.getByLabelText(/Model type setting/i);
    expect(modelType).toHaveAttribute('placeholder', 'Enter your Model Type');
    expect(
      screen.getByLabelText(/Model parameters \(JSON\) \(optional\)/i)
    ).toHaveAttribute(
      'placeholder',
      'Enter model parameters as a JSON object, e.g. {"temperature": 0.7, "top_p": 1, "max_tokens": 4096}'
    );
    fireEvent.change(input, { target: { value: 'test-new-key' } });
    fireEvent.change(modelType, {
      target: { value: 'new-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/api/v1/provider',
        expect.objectContaining({
          model_type: 'new-model',
          api_key: 'test-new-key',
          prefer: false,
        })
      )
    );
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.auth.setModelType).not.toHaveBeenCalled();
  });
  it('saves a local configuration without requiring an API key', async () => {
    renderPage('vllm');
    fireEvent.change(await screen.findByLabelText(/Model type setting/i), {
      target: { value: 'local-model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        '/api/v1/provider',
        expect.objectContaining({
          provider_name: 'vllm',
          api_key: 'not-required',
          model_type: 'local-model',
        })
      )
    );
  });
  it('keeps failed saves open and never persists invalid JSON or thinking effort', async () => {
    renderPage();
    await editRecord('model-a');
    const parameters = screen.getByLabelText(
      /Model parameters \(JSON\) \(optional\)/i
    );
    fireEvent.change(parameters, { target: { value: '{bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid JSON');
    expect(mocks.validate).not.toHaveBeenCalled();
    fireEvent.change(parameters, {
      target: { value: '{"reasoning_effort":"high"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Thinking effort')
    );
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('shows provider search in a dialog and opens the selected configuration dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    const providerSelectionDialog = screen.getByRole('dialog', {
      name: 'Add provider',
    });
    expect(providerSelectionDialog).toHaveClass(
      'data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0',
      'data-[state=closed]:duration-100'
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Search providers' }),
      'anthropic'
    );
    const providerChoice = screen.getByRole('button', { name: 'Anthropic' });
    expect(providerChoice).toHaveClass('active:scale-100');
    await user.click(providerChoice);
    expect(
      await screen.findByRole('dialog', { name: 'Add model · Anthropic' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Add provider' })
    ).not.toBeInTheDocument();
    const configurationDialog = screen.getByRole('dialog', {
      name: 'Add model · Anthropic',
    });
    expect(configurationDialog).toBe(providerSelectionDialog);
    expect(
      within(configurationDialog).getByRole('button', { name: 'Back' })
    ).toHaveAttribute('data-variant', 'ghost');
    expect(
      within(configurationDialog).getByRole('button', { name: 'Cancel' })
    ).toHaveAttribute('data-variant', 'ghost');
    await user.click(
      within(configurationDialog).getByRole('button', { name: 'Back' })
    );
    expect(await screen.findByRole('dialog', { name: 'Add provider' })).toBe(
      providerSelectionDialog
    );
    expect(
      screen.getByRole('textbox', { name: 'Search providers' })
    ).toHaveValue('anthropic');
    expect(
      screen.queryByRole('dialog', { name: 'Add model · Anthropic' })
    ).not.toBeInTheDocument();
  });
  it('hides and restores Eigent models locally, protecting the default', async () => {
    const user = userEvent.setup();
    renderPage();
    const defaultModelSwitch = screen.getByRole('switch', { name: 'GPT' });
    expect(defaultModelSwitch).toBeDisabled();
    expect(defaultModelSwitch.firstElementChild).toHaveClass(
      'motion-reduce:transition-none'
    );
    const claudeRow = within(
      screen.getByRole('region', { name: 'Eigent' })
    ).getByText('Claude').parentElement as HTMLElement;
    await user.click(screen.getByRole('switch', { name: 'Claude' }));
    expect(useModelVisibilityStore.getState().hiddenByAccount['1']).toEqual([
      'claude',
    ]);
    expect(screen.queryByRole('switch', { name: 'Claude' })).toBeNull();
    const viewAll = screen.getByRole('button', { name: 'View all models' });
    expect(viewAll).toHaveClass('!h-[52px]', 'px-ds-8', 'py-ds-16');
    expect(viewAll).toHaveClass('hover:!bg-transparent', 'active:scale-100');
    expect(screen.getByText('View all models')).toHaveClass(
      'group-hover:underline'
    );
    expect(claudeRow).toHaveClass('h-[52px]', 'px-ds-8', 'py-ds-16');
    expect(viewAll.parentElement).toHaveClass(
      'mx-ds-16',
      'divide-ds-hairline-subtle-disabled'
    );
    await user.click(viewAll);
    expect(screen.getByRole('switch', { name: 'Claude' })).not.toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Claude' }));
    expect(useModelVisibilityStore.getState().hiddenByAccount['1']).toEqual([]);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });
  it('confirms deletion and removes only that record', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      await screen.findByRole('button', { name: 'Actions for model-a' })
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' })
    );
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith('/api/v1/provider/11')
    );
  });
  it('keeps routing deep links and replaces a mounted provider dialog', async () => {
    openSettings('models', { modelProvider: 'ant-ling' });
    render(
      <MemoryRouter initialEntries={['/']}>
        <SettingsRouteBridge />
        <Routes>
          <Route path="/" element={<div>Home</div>} />
          <Route path="/home" element={<SettingModels />} />
        </Routes>
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('combobox', { name: 'Ant Ling model type' })
    ).toBeDisabled();
    act(() => openSettings('models', { modelProvider: 'openai' }));
    expect(
      await screen.findByRole('dialog', { name: 'Add model · OpenAI' })
    ).toBeInTheDocument();
    expect(document.getElementById('apiKey-ant-ling')).not.toBeInTheDocument();
  });
  it.each([401, 403, 'network'])(
    'keeps discovery %s separate from the model value',
    async (status) => {
      mocks.validate.mockRejectedValue(
        Object.assign(new Error('Request failed'), { status })
      );
      const input = await fillAntLing();
      fireEvent.click(
        screen.getByRole('button', { name: 'Refresh Ant Ling models' })
      );
      await waitFor(() => expect(mocks.validate).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByRole('combobox')).toHaveAttribute(
          'aria-busy',
          'false'
        )
      );
      expect(input).toHaveAttribute(
        'aria-invalid',
        status === 401 ? 'true' : 'false'
      );
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-invalid',
        'false'
      );
      expect(
        screen.getAllByText(
          status === 401
            ? /Invalid API key/
            : status === 403
              ? /Access denied/
              : /Could not load models/
        ).length
      ).toBeGreaterThan(0);
    }
  );
  it('ignores a stale discovery error after editing credentials', async () => {
    let fail!: (error: unknown) => void;
    mocks.validate.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const input = await fillAntLing();
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    );
    fireEvent.change(input, { target: { value: 'new-test-key' } });
    await act(async () =>
      fail(Object.assign(new Error('old'), { status: 401 }))
    );
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(/Invalid API key/)).not.toBeInTheDocument();
  });
});
