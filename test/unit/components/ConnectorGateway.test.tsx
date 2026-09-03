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

import ConnectorGateway from '@/components/Settings/Connectors/ConnectorGateway';
import { SettingsHeaderProvider } from '@/components/Settings/SettingsHeaderContext';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  modelType: 'custom',
  configs: [] as Array<Record<string, unknown>>,
  installed: {} as Record<string, boolean>,
  checkAgentTool: vi.fn(),
  fetchCapabilities: vi.fn(),
  fetchInstalled: vi.fn(),
  get: vi.fn(),
  handleUninstall: vi.fn(),
  saveEnvAndConfig: vi.fn(),
  translate: (key: string) =>
    (
      ({
        'layout.connectors': 'Connectors',
        'connectors.connected': 'Connected',
        'connectors.not-connected': 'Not connected',
        'connectors.source-built-in': 'Built-in',
        'connectors.web-search': 'Web search',
        'connectors.web-search-desc':
          'Choose Querit or Google for browser and research tasks.',
        'connectors.querit-configuration-title': 'Querit authentication',
      }) as Record<string, string>
    )[key] || key,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: mocks.translate,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/brain', () => ({
  mcpInstall: vi.fn(),
  mcpRemove: vi.fn(),
  mcpUpdate: vi.fn(),
}));

vi.mock('@/api/connectors', () => ({
  disconnectProvider: vi.fn(),
  fetchConnectedProviders: vi.fn().mockResolvedValue([]),
  fetchConnectorProvider: vi.fn(),
  fetchConnectorProviders: vi.fn().mockResolvedValue({ providers: [] }),
  invalidateConnectorProvidersCache: vi.fn(),
  prefetchConnectorProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/http', () => ({
  fetchPost: vi.fn(),
  proxyFetchDelete: vi.fn(),
  proxyFetchGet: mocks.get,
  proxyFetchPost: vi.fn(),
  proxyFetchPut: vi.fn(),
}));

vi.mock('@/hooks/useIntegrationManagement', () => ({
  useIntegrationManagement: () => ({
    installed: mocks.installed,
    configs: mocks.configs,
    configsLoading: false,
    fetchInstalled: mocks.fetchInstalled,
    saveEnvAndConfig: mocks.saveEnvAndConfig,
    handleUninstall: mocks.handleUninstall,
  }),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({
    checkAgentTool: mocks.checkAgentTool,
    modelType: mocks.modelType,
  }),
}));

vi.mock('@/store/serverCapabilityStore', () => ({
  useServerCapabilityStore: (
    selector: (state: Record<string, unknown>) => unknown
  ) =>
    selector({
      status: 'ready',
      fetchCapabilities: mocks.fetchCapabilities,
      isConnectorGatewayEnabled: () => false,
    }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function renderGateway() {
  return render(
    <MemoryRouter>
      <SettingsHeaderProvider activeSection="connectors">
        <ConnectorGateway />
      </SettingsHeaderProvider>
    </MemoryRouter>
  );
}

describe('ConnectorGateway Web search visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.modelType = 'custom';
    mocks.configs = [];
    mocks.installed = {};
    mocks.fetchCapabilities.mockResolvedValue(undefined);
    mocks.fetchInstalled.mockResolvedValue(undefined);
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/v1/config/info') return Promise.resolve({});
      if (url === '/api/v1/mcp/users') return Promise.resolve([]);
      if (url === '/api/v1/configs') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('keeps unconfigured Web search visible and opens its settings', async () => {
    const user = userEvent.setup();
    renderGateway();

    const webSearch = await screen.findByRole('button', {
      name: 'Web search',
    });
    expect(within(webSearch).getByText('Not connected')).toBeInTheDocument();

    await user.click(webSearch);

    expect(
      await screen.findByRole('heading', { name: 'Querit authentication' })
    ).toBeInTheDocument();
  });

  it('keeps managed-model Web search connected by default', async () => {
    mocks.modelType = 'cloud';
    renderGateway();

    const webSearch = await screen.findByRole('button', {
      name: 'Web search',
    });
    expect(within(webSearch).getByText('Connected')).toBeInTheDocument();
  });
});
