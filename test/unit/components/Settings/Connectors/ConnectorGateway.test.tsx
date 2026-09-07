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
import { ConnectorsNavigationProvider } from '@/components/Settings/Connectors/ConnectorsNavigationContext';
import ConnectorDetailSidebar from '@/components/Settings/Connectors/components/ConnectorDetailSidebar';
import { SettingsHeaderProvider } from '@/components/Settings/SettingsHeaderContext';
import { useAuthStore } from '@/store/authStore';
import { useServerCapabilityStore } from '@/store/serverCapabilityStore';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectorMocks = vi.hoisted(() => ({
  fetchConnectedProviders: vi.fn(),
  fetchConnectorProvider: vi.fn(),
  fetchConnectorProviders: vi.fn(),
  prefetchConnectorProviders: vi.fn(),
  proxyFetchGet: vi.fn(),
  refreshBuiltIns: vi.fn(),
  saveBuiltInValue: vi.fn(),
  uninstallBuiltIn: vi.fn(),
  installedBuiltIns: { Search: true },
  integrationConfigs: [] as unknown[],
}));

vi.mock('@/api/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/connectors')>()),
  fetchConnectedProviders: connectorMocks.fetchConnectedProviders,
  fetchConnectorProvider: connectorMocks.fetchConnectorProvider,
  fetchConnectorProviders: connectorMocks.fetchConnectorProviders,
  prefetchConnectorProviders: connectorMocks.prefetchConnectorProviders,
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  proxyFetchGet: connectorMocks.proxyFetchGet,
  proxyFetchPost: vi.fn(),
  proxyFetchPut: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));

vi.mock('@/hooks/useIntegrationManagement', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/hooks/useIntegrationManagement')
  >()),
  useIntegrationManagement: () => ({
    installed: connectorMocks.installedBuiltIns,
    configs: connectorMocks.integrationConfigs,
    configsLoading: false,
    fetchInstalled: connectorMocks.refreshBuiltIns,
    saveEnvAndConfig: connectorMocks.saveBuiltInValue,
    handleUninstall: connectorMocks.uninstallBuiltIn,
  }),
}));

const connectedProvider = {
  service: 'google_drive',
  displayName: 'Google Drive',
  description: 'Read and manage Drive files.',
  connection: {
    service: 'google_drive',
    connectionName: 'primary',
    authType: 'oauth2',
    configured: true,
    virtual: false,
    default: true,
    profile: { displayName: 'douglas@example.com' },
  },
  actions: [{ id: 'files-list', name: 'List files' }],
};

const recommendedProvider = {
  service: 'slack',
  displayName: 'Slack',
  description: 'Send and read messages.',
  homepageUrl: 'https://slack.com',
  connection: null,
  auth: [{ type: 'oauth2' }],
  actions: [{ id: 'messages-send', name: 'Send message' }],
};

function renderGateway(initialEntry = '/home?section=settings&tab=connectors') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SettingsHeaderProvider activeSection="connectors">
        <ConnectorsNavigationProvider>
          <ConnectorGateway />
        </ConnectorsNavigationProvider>
      </SettingsHeaderProvider>
    </MemoryRouter>
  );
}

function renderGatewayWithSidebar() {
  return render(
    <MemoryRouter
      initialEntries={[
        '/home?section=settings&tab=connectors&connectorId=open%3Agoogle_drive',
      ]}
    >
      <SettingsHeaderProvider activeSection="connectors">
        <ConnectorsNavigationProvider>
          <ConnectorDetailSidebar
            selectedConnectorId="open:google_drive"
            onBack={vi.fn()}
            onAddConnector={vi.fn()}
            onSelectConnector={vi.fn()}
          />
          <ConnectorGateway />
        </ConnectorsNavigationProvider>
      </SettingsHeaderProvider>
    </MemoryRouter>
  );
}

describe('ConnectorGateway presentation', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({ email: 'douglas@example.com', modelType: 'cloud' });
    useServerCapabilityStore.setState({
      status: 'ready',
      lastFetchedAt: Date.now(),
      capabilities: {
        features: {
          connector_gateway: { enabled: true, provider: 'test' },
        },
      },
      error: null,
    });
    connectorMocks.fetchConnectedProviders.mockResolvedValue([
      connectedProvider,
    ]);
    connectorMocks.fetchConnectorProvider.mockImplementation(
      async (service: string) => ({
        enabled: true,
        source: 'connector_gateway',
        provider:
          service === recommendedProvider.service
            ? recommendedProvider
            : connectedProvider,
      })
    );
    connectorMocks.fetchConnectorProviders.mockResolvedValue({
      enabled: true,
      source: 'connector_gateway',
      provider_count: 1,
      filtered_count: 1,
      connected_count: 0,
      page: 1,
      page_size: 60,
      total_pages: 1,
      providers: [recommendedProvider],
    });
    connectorMocks.prefetchConnectorProviders.mockResolvedValue(undefined);
    connectorMocks.refreshBuiltIns.mockResolvedValue(undefined);
    connectorMocks.proxyFetchGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/config/info') return {};
      if (path === '/api/v1/configs') return [];
      if (path === '/api/v1/mcp/users') {
        return [
          {
            id: 41,
            mcp_id: 41,
            mcp_name: 'local toolbox',
            mcp_key: 'local-toolbox',
            mcp_desc: 'Local tools',
            status: 1,
            type: 1,
            command: 'npx',
          },
        ];
      }
      return {};
    });
  });

  it('uses one toolbar, one installed table, and a remembered recommendation banner', async () => {
    const user = userEvent.setup();
    const { unmount } = renderGateway();

    const toolbar = await screen.findByRole('region', {
      name: 'Connector tools',
    });
    const collectionHeader = toolbar.closest('header');
    expect(collectionHeader).toHaveClass('min-h-ds-layout-row-header');
    expect(toolbar).toHaveClass('max-w-[1100px]', 'px-ds-32');
    expect(collectionHeader?.nextElementSibling?.firstElementChild).toHaveClass(
      'max-w-[1100px]',
      'px-8'
    );
    expect(
      within(toolbar).getByRole('button', { name: 'Add connector' })
    ).toBeVisible();
    expect(
      within(toolbar).queryByRole('button', { name: 'Browse connectors' })
    ).not.toBeInTheDocument();

    const table = await screen.findByRole('table', { name: 'Connectors' });
    expect(collectionHeader?.nextElementSibling).toContainElement(table);
    expect(collectionHeader).not.toContainElement(table);
    expect(within(table).getByText('Google Drive')).toBeVisible();
    expect(within(table).getByText('Local toolbox')).toBeVisible();
    const headerRow = within(table).getAllByRole('row')[0];
    expect(headerRow).toHaveClass('hover:bg-transparent');
    const customTypeTag = within(table).getByText('Custom local');
    expect(customTypeTag).toHaveClass('whitespace-nowrap', 'px-2');
    expect(customTypeTag).not.toHaveAttribute('data-size', 'xs');

    const dismiss = await screen.findByRole('button', {
      name: 'Dismiss recommended connectors',
    });
    await user.click(dismiss);
    expect(dismiss).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(
        'eigent.connectors.recommendations-dismissed.v1'
      )
    ).toBe('true');

    unmount();
    renderGateway();
    await screen.findByRole('table', { name: 'Connectors' });
    expect(
      screen.queryByRole('button', {
        name: 'Dismiss recommended connectors',
      })
    ).not.toBeInTheDocument();
  });

  it('opens the Add connector directory and routes card selection to a detail subpage', async () => {
    const user = userEvent.setup();
    renderGateway();

    await user.click(
      await screen.findByRole('button', { name: 'Add connector' })
    );
    const addPage = await waitFor(() => {
      const page = document.querySelector('[data-add-connector]');
      expect(page).not.toBeNull();
      return page as HTMLElement;
    });
    const browseTab = within(addPage).getByRole('tab', {
      name: 'Browse connectors',
    });
    expect(browseTab).toBeVisible();
    expect(browseTab).toHaveClass('flex-1', '!text-ds-text-base');
    expect(
      within(addPage).getByRole('tab', { name: 'Custom local' })
    ).toBeVisible();
    expect(
      within(addPage).getByRole('tab', { name: 'Custom remote' })
    ).toBeVisible();
    const toolbarRow = browseTab.closest('.justify-between') as HTMLElement;
    expect(toolbarRow).not.toBeNull();
    expect(
      within(toolbarRow).getByRole('textbox', {
        name: 'Search connectors',
      })
    ).toBeVisible();

    await user.click(
      await within(addPage).findByRole('button', { name: /Slack/ })
    );
    const connectorSubpage = await waitFor(() => {
      const page = document.querySelector('[data-connector-browser-detail]');
      expect(page).not.toBeNull();
      return page as HTMLElement;
    });
    const breadcrumb = within(connectorSubpage).getByRole('navigation', {
      name: 'Breadcrumb',
    });
    expect(
      within(breadcrumb).getByRole('button', { name: 'Connector' })
    ).toBeVisible();
    expect(
      within(breadcrumb).getByRole('button', { name: 'Add connector' })
    ).toBeVisible();
    expect(within(breadcrumb).getByText('Slack')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      within(breadcrumb).queryByRole('heading', { name: 'Slack', level: 1 })
    ).not.toBeInTheDocument();
    const masthead = connectorSubpage.querySelector(
      '[data-connector-profile-masthead]'
    ) as HTMLElement;
    expect(masthead).not.toBeNull();
    const connectorTitle = within(masthead).getByRole('heading', {
      name: 'Slack',
      level: 1,
    });
    expect(connectorTitle).toHaveClass('!text-ds-text-section');
    await waitFor(() => expect(connectorTitle).toHaveFocus());
    expect(
      within(masthead).getByRole('button', { name: 'Install' })
    ).toBeVisible();
    expect(
      within(masthead).getByRole('link', { name: 'Provider website' })
    ).toHaveAttribute('href', 'https://slack.com');
    expect(
      within(connectorSubpage).getByRole('heading', {
        name: 'Authentication',
        level: 2,
      })
    ).toBeVisible();
    expect(
      within(connectorSubpage).getByRole('heading', {
        name: 'Supported actions',
        level: 2,
      })
    ).toBeVisible();
    expect(
      within(connectorSubpage).queryByRole('button', { name: 'Cancel' })
    ).not.toBeInTheDocument();
    expect(
      within(connectorSubpage).getAllByRole('heading', { level: 1 })
    ).toHaveLength(1);
    expect(
      within(connectorSubpage).queryByRole('tab', {
        name: 'Browse connectors',
      })
    ).not.toBeInTheDocument();

    await user.click(
      within(breadcrumb).getByRole('button', { name: 'Add connector' })
    );
    await waitFor(() =>
      expect(
        document.querySelector('[data-connector-browser-detail]')
      ).not.toBeInTheDocument()
    );
    expect(
      screen.getByRole('tab', { name: 'Browse connectors' })
    ).toBeVisible();
  });

  it('returns an unresolved connector target to the Add connector directory', async () => {
    connectorMocks.fetchConnectorProvider.mockImplementation(
      async (service: string) => {
        if (service === 'missing') throw new Error('missing provider');
        return {
          enabled: true,
          source: 'connector_gateway',
          provider:
            service === recommendedProvider.service
              ? recommendedProvider
              : connectedProvider,
        };
      }
    );
    renderGateway(
      '/home?section=settings&tab=connectors&connectorView=add&connectorAdd=browse&connectorTarget=open%3Amissing'
    );

    expect(
      await screen.findByRole('tab', { name: 'Browse connectors' })
    ).toBeVisible();
    expect(
      document.querySelector('[data-connector-browser-detail]')
    ).not.toBeInTheDocument();
  });

  it('renders the installed connector breadcrumb from a URL selection', async () => {
    renderGateway(
      '/home?section=settings&tab=connectors&connectorId=open%3Agoogle_drive'
    );

    const detail = await waitFor(() => {
      const page = document.querySelector('[data-connector-detail]');
      expect(page).not.toBeNull();
      return page as HTMLElement;
    });
    expect(detail.querySelector('header')).toHaveClass('px-ds-16');
    const breadcrumb = within(detail).getByRole('navigation', {
      name: 'Breadcrumb',
    });
    expect(
      within(breadcrumb).getByRole('button', { name: 'Home' })
    ).toBeVisible();
    expect(
      within(breadcrumb).getByRole('button', { name: 'Connector' })
    ).toBeVisible();
    expect(breadcrumb.querySelector('ol')).not.toBeNull();
    expect(
      within(detail).getByRole('heading', {
        name: 'Google Drive',
        level: 1,
      })
    ).toBeVisible();
    expect(within(breadcrumb).queryByRole('heading')).toBeNull();
  });

  it('uses the shared detail-sidebar pattern for the full installed list', async () => {
    const user = userEvent.setup();
    renderGatewayWithSidebar();

    const sidebar = screen.getByRole('complementary', { name: 'Connectors' });
    const header = sidebar.querySelector('header') as HTMLElement;
    expect(within(header).getByRole('button', { name: 'Back' })).toBeVisible();
    expect(
      within(header).getByRole('button', { name: 'Add connector' })
    ).toHaveAttribute('data-variant', 'primary');
    const search = within(sidebar).getByRole('searchbox', {
      name: 'Search your connectors',
    });
    expect(search.closest('.py-ds-8')).not.toHaveClass('px-ds-8');
    expect(
      await within(sidebar).findByRole('button', { name: 'Google Drive' })
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(sidebar).getByRole('button', { name: 'Local toolbox' })
    ).toBeVisible();

    await user.type(search, 'missing');
    expect(
      within(sidebar).queryByRole('button', { name: 'Google Drive' })
    ).not.toBeInTheDocument();
    expect(sidebar).toHaveTextContent('No matching connectors.');
  });
});
