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

import SubAgents from '@/components/Settings/SubAgents';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  validate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: mocks.post,
  proxyFetchPut: mocks.put,
  proxyFetchDelete: mocks.remove,
  fetchPost: mocks.validate,
}));
vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { appearance: string }) => unknown) =>
    selector({ appearance: 'light' }),
}));

const geminiRecord = {
  id: 1,
  provider_name: 'gemini_agents',
  enabled: true,
  api_key: 'gemini-key',
  endpoint_url: 'https://generativelanguage.googleapis.com/v1beta',
  agent_name: 'gemini-agent',
  config: { max_wall_time_seconds: 900, poll_interval_seconds: 5 },
};

const modelarkRecord = {
  id: 2,
  provider_name: 'modelark_agents',
  enabled: false,
  api_key: 'ark-key',
  endpoint_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
  agent_name: 'agent-1',
  config: { max_wall_time_seconds: 900, environment_id: 'env-1' },
};

function section(name: string) {
  return screen.getByRole('region', { name });
}

async function renderPage(records: unknown[]) {
  mocks.get.mockResolvedValue(records);
  render(<SubAgents />);
  await waitFor(() =>
    expect(
      within(section('Gemini Agents API')).queryByRole('status')
    ).not.toBeInTheDocument()
  );
}

describe('Settings → Sub-agents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validate.mockResolvedValue({ is_valid: true, message: 'ok' });
    mocks.post.mockResolvedValue({});
    mocks.put.mockResolvedValue({});
    mocks.remove.mockResolvedValue({});
  });

  it('lists both providers with their status', async () => {
    await renderPage([geminiRecord]);

    const gemini = section('Gemini Agents API');
    expect(within(gemini).getByText('Configured')).toBeInTheDocument();
    expect(within(gemini).getByText('In use')).toBeInTheDocument();
    expect(within(gemini).getByText('gemini-agent')).toBeInTheDocument();
    expect(
      within(gemini).getByRole('switch', { name: 'Use Gemini Agents API' })
    ).toBeChecked();

    const modelark = section('ModelArk Managed Agents');
    expect(within(modelark).getByText('Not configured')).toBeInTheDocument();
    expect(
      within(modelark).getByRole('switch', {
        name: 'Use ModelArk Managed Agents',
      })
    ).not.toBeChecked();
    expect(mocks.get).toHaveBeenCalledWith(
      '/api/v1/remote-sub-agent-providers'
    );
  });

  it('opens setup instead of switching on a provider with no settings', async () => {
    const user = userEvent.setup();
    await renderPage([]);

    await user.click(
      within(section('ModelArk Managed Agents')).getByRole('switch')
    );

    expect(
      await screen.findByRole('dialog', {
        name: 'Set up ModelArk Managed Agents',
      })
    ).toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('checks and saves ModelArk settings with the environment ID', async () => {
    const user = userEvent.setup();
    await renderPage([]);

    await user.click(
      within(section('ModelArk Managed Agents')).getByRole('button', {
        name: 'Set up',
      })
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('API host')).toHaveValue(
      'https://ark.ap-southeast.bytepluses.com/api/v3'
    );
    expect(
      within(dialog).queryByLabelText('Poll interval (seconds)')
    ).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('API key'), 'ark-key');
    await user.type(within(dialog).getByLabelText('Agent ID'), 'agent-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      within(dialog).getByText(
        'Enter the API key, API host, agent ID, and environment ID.'
      )
    ).toBeInTheDocument();
    expect(mocks.validate).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText('Environment ID'), 'env-1');
    mocks.get.mockResolvedValue([{ ...modelarkRecord, id: 3, enabled: true }]);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(mocks.validate).toHaveBeenCalledWith('/remote-sub-agent/validate', {
      provider: 'modelark_agents',
      api_key: 'ark-key',
      base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
      agent_name: 'agent-1',
      environment_id: 'env-1',
    });
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/remote-sub-agent-providers',
      {
        provider_name: 'modelark_agents',
        enabled: true,
        api_key: 'ark-key',
        endpoint_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
        agent_name: 'agent-1',
        model_name: '',
        config: { max_wall_time_seconds: 900, environment_id: 'env-1' },
      }
    );
    expect(
      await within(section('ModelArk Managed Agents')).findByText('In use')
    ).toBeInTheDocument();
  });

  it('saves a new provider switched off while another one is in use', async () => {
    const user = userEvent.setup();
    await renderPage([geminiRecord]);

    await user.click(
      within(section('ModelArk Managed Agents')).getByRole('button', {
        name: 'Set up',
      })
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('API key'), 'ark-key');
    await user.type(within(dialog).getByLabelText('Agent ID'), 'agent-1');
    await user.type(within(dialog).getByLabelText('Environment ID'), 'env-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ enabled: false });
  });

  it('keeps the dialog open with the provider message when the check fails', async () => {
    const user = userEvent.setup();
    mocks.validate.mockResolvedValue({
      is_valid: false,
      message: "ModelArk environment 'env-x' was not found.",
    });
    await renderPage([
      { ...modelarkRecord, config: { environment_id: 'env-x' } },
    ]);

    await user.click(
      within(section('ModelArk Managed Agents')).getByRole('button', {
        name: 'Edit',
      })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Edit ModelArk Managed Agents',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByText(
        "ModelArk environment 'env-x' was not found."
      )
    ).toBeInTheDocument();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('checks the connection before switching a configured provider on', async () => {
    const user = userEvent.setup();
    await renderPage([geminiRecord, modelarkRecord]);
    mocks.get.mockResolvedValue([
      { ...geminiRecord, enabled: false },
      { ...modelarkRecord, enabled: true },
    ]);

    await user.click(
      within(section('ModelArk Managed Agents')).getByRole('switch')
    );

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        '/api/v1/remote-sub-agent-providers/2',
        expect.objectContaining({ enabled: true })
      )
    );
    expect(mocks.validate).toHaveBeenCalledWith(
      '/remote-sub-agent/validate',
      expect.objectContaining({ provider: 'modelark_agents' })
    );
    await waitFor(() =>
      expect(
        within(section('Gemini Agents API')).getByRole('switch')
      ).not.toBeChecked()
    );
    expect(
      within(section('ModelArk Managed Agents')).getByRole('switch')
    ).toBeChecked();
  });

  it('switches a provider off without a connection check', async () => {
    const user = userEvent.setup();
    await renderPage([geminiRecord]);
    mocks.get.mockResolvedValue([{ ...geminiRecord, enabled: false }]);

    await user.click(within(section('Gemini Agents API')).getByRole('switch'));

    await waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith(
        '/api/v1/remote-sub-agent-providers/1',
        expect.objectContaining({ enabled: false })
      )
    );
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it('removes saved settings after confirmation', async () => {
    const user = userEvent.setup();
    await renderPage([modelarkRecord]);
    mocks.get.mockResolvedValue([]);

    await user.click(
      within(section('ModelArk Managed Agents')).getByRole('button', {
        name: 'Actions for ModelArk Managed Agents',
      })
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Remove ModelArk Managed Agents settings?',
    });
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith(
        '/api/v1/remote-sub-agent-providers/2'
      )
    );
    expect(
      await within(section('ModelArk Managed Agents')).findByText(
        'Not configured'
      )
    ).toBeInTheDocument();
  });

  it('offers a retry when the providers cannot be loaded', async () => {
    const user = userEvent.setup();
    mocks.get.mockRejectedValueOnce(new Error('offline'));
    render(<SubAgents />);

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Could not load sub-agent providers.')
    ).toBeInTheDocument();

    mocks.get.mockResolvedValue([geminiRecord]);
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(
      await within(section('Gemini Agents API')).findByText('In use')
    ).toBeInTheDocument();
  });
});
