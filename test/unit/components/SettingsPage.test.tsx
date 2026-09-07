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

import SettingsSection from '@/components/Settings/SettingsSection';
import SettingsPage from '@/pages/Settings';
import { useSettingsResourceCountsStore } from '@/store/settingsResourceCountsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/brain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/brain')>()),
  skillRead: vi
    .fn()
    .mockResolvedValue({ success: true, content: '# Research' }),
}));

// Navigation-guard persistence has focused tests; layout tests execute the
// approved navigation callback synchronously to avoid timer-dependent waits.
vi.mock(
  '@/lib/workspaceConfigurationNavigationGuard',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/workspaceConfigurationNavigationGuard')
      >();
    return {
      ...actual,
      runAfterWorkspaceConfigurationSave: async (
        action: () => void | Promise<void>
      ) => {
        await action();
        return true;
      },
    };
  }
);

const homeOverviewMocks = vi.hoisted(() => ({
  fetchConnectedProviders: vi.fn(),
  fetchConnectorProviders: vi.fn(),
  fetchConnectorProvider: vi.fn(),
  prefetchConnectorProviders: vi.fn(),
  fetchGet: vi.fn(),
  proxyFetchGet: vi.fn(),
  listMemoryEntries: vi.fn(),
}));

const pageMotionMocks = vi.hoisted(() => ({
  reduced: false,
}));

const platformMocks = vi.hoisted(() => ({
  desktop: true,
}));

vi.mock('@/client/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/platform')>()),
  isDesktop: () => platformMocks.desktop,
}));

// Navigation semantics are asserted below; animation timing has focused tests.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  const React = await import('react');
  const motionProps = new Set([
    'animate',
    'custom',
    'exit',
    'initial',
    'onAnimationComplete',
    'transition',
    'variants',
  ]);
  const createMotionComponent = (tag: 'div' | 'main') => {
    const MotionComponent = React.forwardRef<
      HTMLElement,
      Record<string, unknown>
    >((props, ref) => {
      const domProps = Object.fromEntries(
        Object.entries(props).filter(([key]) => !motionProps.has(key))
      );
      return React.createElement(tag, { ...domProps, ref });
    });
    MotionComponent.displayName = `MockMotion.${tag}`;
    return MotionComponent;
  };

  return {
    ...actual,
    AnimatePresence: ({ children }: { children?: ReactNode }) => children,
    motion: {
      div: createMotionComponent('div'),
      main: createMotionComponent('main'),
    },
    useReducedMotion: () => pageMotionMocks.reduced,
  };
});

vi.mock('@/api/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/connectors')>()),
  fetchConnectedProviders: homeOverviewMocks.fetchConnectedProviders,
  fetchConnectorProviders: homeOverviewMocks.fetchConnectorProviders,
  fetchConnectorProvider: homeOverviewMocks.fetchConnectorProvider,
  prefetchConnectorProviders: homeOverviewMocks.prefetchConnectorProviders,
}));

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  fetchGet: homeOverviewMocks.fetchGet,
  proxyFetchGet: homeOverviewMocks.proxyFetchGet,
}));

vi.mock('@/service/memoryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/memoryApi')>()),
  listMemoryEntries: homeOverviewMocks.listMemoryEntries,
}));

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useUserTriggerCountQuery: () => ({ data: 0 }),
}));

function openDropdown(trigger: HTMLElement) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ctrlKey: false,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(trigger, event);
}

vi.mock('@/service/historyApi', () => ({
  fetchGroupedHistoryTasks: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggers: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/components/Settings/General', () => ({
  default: () => <div data-testid="general-settings" />,
}));

vi.mock('@/components/Settings/Appearance', () => ({
  default: () => <div data-testid="appearance-settings" />,
}));

vi.mock('@/components/Settings/Privacy', () => ({
  default: () => <div data-testid="privacy-settings" />,
}));

// These tests exercise navigation and the real Skills surface, not model APIs.
vi.mock('@/components/Settings/Models', () => ({
  default: () => <div data-testid="models-settings" />,
}));

vi.mock('@/store/authStore', () => {
  const authState = {
    appearance: 'light',
    language: 'en',
    token: 'token',
    username: 'Douglas',
    email: 'douglas@example.com',
    user_id: 7,
  };
  const useAuthStore = (
    selector: (state: typeof authState) => unknown = (state) => state
  ) => selector(authState);

  return {
    getAuthStore: () => authState,
    useAuthStore,
    useWorkerList: () => [],
  };
});

type SettingsInitialEntry =
  | string
  | {
      pathname: string;
      search?: string;
      state?: Record<string, unknown>;
    };

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="settings-location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function renderSettingsPage(
  initialEntry:
    | SettingsInitialEntry
    | SettingsInitialEntry[] = '/home?section=settings&tab=models'
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const initialEntries = Array.isArray(initialEntry)
    ? initialEntry
    : [initialEntry];

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={initialEntries}
        initialIndex={initialEntries.length - 1}
      >
        <SettingsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function getSettingsHeader() {
  const header = document.querySelector('header');
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

describe('SettingsPage', () => {
  beforeEach(() => {
    pageMotionMocks.reduced = false;
    platformMocks.desktop = true;
    window.localStorage.setItem('eigent-home-hub-view-mode', 'grid');
    useSettingsStore.setState({
      activeSection: 'models',
    });
    useSettingsResourceCountsStore.setState({
      counts: { 'browser-connections': null, cookies: null },
    });
    homeOverviewMocks.fetchConnectedProviders.mockResolvedValue([
      { service: 'github' },
      { service: 'notion' },
    ]);
    homeOverviewMocks.fetchConnectorProviders.mockResolvedValue({
      enabled: true,
      source: 'connector_gateway',
      provider_count: 0,
      filtered_count: 0,
      connected_count: 0,
      page: 1,
      page_size: 60,
      total_pages: 1,
      providers: [],
    });
    homeOverviewMocks.fetchConnectorProvider.mockResolvedValue({
      enabled: true,
      source: 'connector_gateway',
      provider: { service: 'github', displayName: 'GitHub', actions: [] },
    });
    homeOverviewMocks.prefetchConnectorProviders.mockResolvedValue(undefined);
    homeOverviewMocks.fetchGet.mockImplementation(async (path: string) => {
      if (path === '/browser/cdp/list') {
        return [
          { id: 'browser-1', port: 9222 },
          { id: 'browser-2', port: 9223 },
        ];
      }
      if (path === '/browser/cookies') {
        return {
          success: true,
          domains: [
            { domain: 'github.com' },
            { domain: 'notion.so' },
            { domain: 'slack.com' },
          ],
        };
      }
      return {};
    });
    homeOverviewMocks.proxyFetchGet.mockImplementation(async (path: string) => {
      if (path === '/api/v1/server/capabilities') {
        return { features: { connector_gateway: { enabled: true } } };
      }
      if (path === '/api/v1/mcp/users' || path === '/api/v1/configs') return [];
      return {};
    });
    homeOverviewMocks.listMemoryEntries.mockResolvedValue({
      scope_state: {
        token_limit: 5000,
        current_token_count: 1000,
      },
      items: [],
    });
  });

  it('hides Desktop-only Agent Plugin import from the web dialog', async () => {
    platformMocks.desktop = false;
    const user = userEvent.setup();
    renderSettingsPage('/home?section=spaces');

    const spacesToolbar = document.querySelector(
      '[data-home-spaces-toolbar]'
    ) as HTMLElement;
    await user.click(
      await within(spacesToolbar).findByRole('button', { name: 'New Space' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Import from Workspace Bundle' })
    );

    const bundleOptions = screen.getByRole('group', {
      name: 'Bundle import options',
    });
    expect(bundleOptions).toHaveClass('grid-cols-1');
    expect(
      within(bundleOptions).queryByRole('button', {
        name: 'Import Agent Plugin as Bundle',
      })
    ).not.toBeInTheDocument();
  });

  it('renders scoped navigation in the shared app shell', async () => {
    renderSettingsPage();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    const sidebar = screen.getByRole('complementary', {
      name: 'Home',
    });
    const contentShell = document.querySelector('.scrollbar-always-visible');
    expect(contentShell).toHaveClass(
      'overflow-y-scroll',
      '[scrollbar-gutter:stable]'
    );
    expect(contentShell?.firstElementChild).toHaveClass('px-8');
    expect(
      within(sidebar).getByRole('navigation', { name: 'Home' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Workspace Bundle' })
    ).not.toBeInTheDocument();
    const selectedTab = screen.getByRole('button', { name: 'Models' });
    const header = getSettingsHeader();
    const heading = within(header).getByRole('heading', {
      name: 'Models',
      level: 1,
    });
    expect(main).toContainElement(header);
    expect(heading).toHaveFocus();
    expect(header).toHaveClass(
      'h-ds-layout-row-header',
      'min-h-ds-layout-row-header'
    );
    expect(within(header).getByText('Models')).toHaveClass(
      'text-ds-text-body-large',
      'font-bold'
    );
    expect(
      within(header).queryByRole('button', {
        name: 'Back',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'layout.workspace-active-scope',
        level: 3,
      })
    ).not.toBeInTheDocument();
    expect(selectedTab).toHaveAttribute('aria-current', 'page');
    expect(selectedTab).toHaveClass(
      'bg-ds-neutral-subtle-default',
      'h-8',
      'w-full'
    );
    const homeLabel = within(sidebar).getByText('Home');
    const globalSettingLabel = within(sidebar).getByText('Global Settings');
    expect(
      homeLabel.compareDocumentPosition(globalSettingLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(sidebar).getByRole('button', { name: 'Spaces' })
    ).toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Sessions' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Tasks' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Automations' })
    ).not.toBeInTheDocument();
    expect(globalSettingLabel).toBeInTheDocument();
    expect(
      globalSettingLabel.compareDocumentPosition(selectedTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getByText('Browser')).toBeInTheDocument();
    expect(screen.getByText('Extension')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Models' }).querySelector('svg')
    ).toHaveClass('lucide-sparkles');
    expect(
      screen.getByRole('button', { name: 'Sub Agents' }).querySelector('svg')
    ).toHaveClass('lucide-bot');
    expect(
      screen.getByRole('button', { name: 'Skills' }).querySelector('svg')
    ).toHaveClass('lucide-wand-sparkles');
    expect(
      screen.getByRole('button', { name: 'Browser' }).querySelector('svg')
    ).toHaveClass('lucide-globe');
    expect(
      screen.getByRole('button', { name: 'Extension' }).querySelector('svg')
    ).toHaveClass('lucide-puzzle');
    expect(
      within(sidebar)
        .getByRole('button', { name: 'Settings' })
        .querySelector('svg')
    ).toHaveClass('lucide-settings');
    expect(
      within(sidebar).queryByRole('button', { name: 'General' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Appearance' })
    ).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole('button', { name: 'Privacy' })
    ).not.toBeInTheDocument();
    expect(await screen.findByTestId('models-settings')).toBeInTheDocument();
  });

  it('shows live resource counts on the Skills, Connectors, Browser, and Cookies tabs', async () => {
    useSkillsStore.setState({
      skills: [
        {
          id: 'research',
          name: 'Research',
          description: 'Find sources',
          filePath: 'research/SKILL.md',
          fileContent: '',
          addedAt: 0,
          scope: { isGlobal: true, selectedAgents: [] },
          enabled: true,
          isExample: false,
        },
      ],
    });

    renderSettingsPage();

    const sidebar = screen.getByRole('complementary', { name: 'Home' });

    await waitFor(() => {
      expect(
        within(
          within(sidebar).getByRole('button', { name: 'Skills' })
        ).getByText('1')
      ).toBeVisible();
      expect(
        within(
          within(sidebar).getByRole('button', { name: 'Connectors' })
        ).getByText('2')
      ).toBeVisible();
      expect(
        within(
          within(sidebar).getByRole('button', { name: 'Browser' })
        ).getByText('2')
      ).toBeVisible();
      expect(
        within(
          within(sidebar).getByRole('button', { name: 'Cookies' })
        ).getByText('3')
      ).toBeVisible();
    });
  });

  it('switches between Home and Settings sections in the same shell', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    const spacesTab = screen.getByRole('button', { name: 'Spaces' });
    const modelsTab = screen.getByRole('button', { name: 'Models' });
    await user.click(spacesTab);

    await waitFor(() => {
      expect(spacesTab).toHaveAttribute('aria-current', 'page');
      expect(modelsTab).not.toHaveAttribute('aria-current');
    });

    const overview = document.querySelector(
      '[data-home-spaces-overview]'
    ) as HTMLElement;
    const toolbar = document.querySelector(
      '[data-home-spaces-toolbar]'
    ) as HTMLElement;
    const collectionHeader = toolbar.closest('header');
    const list = document.querySelector('[data-home-spaces-list]');
    expect(collectionHeader).toHaveClass(
      'min-h-ds-layout-row-header',
      'border-ds-hairline-subtle-default'
    );
    expect(toolbar).toHaveClass('max-w-[1100px]', 'px-ds-32');
    expect(collectionHeader?.nextElementSibling).toContainElement(overview);
    expect(collectionHeader).not.toContainElement(overview);
    expect(overview).toHaveTextContent(/Morning|Good Afternoon|Evening/);
    expect(overview).toHaveTextContent('Douglas');
    expect(within(overview).queryByText('Status')).not.toBeInTheDocument();
    expect(within(overview).queryByText('Tasks')).not.toBeInTheDocument();
    expect(
      within(overview)
        .getByText('Spaces')
        .parentElement?.parentElement?.querySelector('svg')
    ).toHaveClass('lucide-folder');
    expect(
      within(overview)
        .getByText('Connectors')
        .parentElement?.parentElement?.querySelector('svg')
    ).toHaveClass('lucide-cable');
    expect(await within(overview).findByText('2')).toBeInTheDocument();
    expect(
      within(overview)
        .getByText('Skills')
        .parentElement?.parentElement?.querySelector('svg')
    ).toHaveClass('lucide-wand-sparkles');
    expect(
      within(overview)
        .getByText('Memory left')
        .parentElement?.parentElement?.querySelector('svg')
    ).toHaveClass('lucide-brain');
    expect(await within(overview).findByText('4,000')).toBeInTheDocument();
    expect(
      within(toolbar).getByPlaceholderText('Search spaces...')
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole('tab', { name: 'List' })
    ).toBeInTheDocument();
    expect(
      within(toolbar).queryByRole('tab', { name: 'Board' })
    ).not.toBeInTheDocument();
    const newSpaceButton = within(toolbar).getByRole('button', {
      name: 'New Space',
    });
    expect(newSpaceButton.querySelector('svg')).not.toBeInTheDocument();
    expect(
      toolbar.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await user.click(newSpaceButton);
    const newSpaceDialog = await screen.findByRole('dialog', {
      name: 'Create a new Space',
    });
    const newSpaceOptions = within(newSpaceDialog).getByRole('group', {
      name: 'New Space options',
    });
    expect(newSpaceOptions).toHaveClass('grid-cols-3');
    expect(
      within(newSpaceOptions).getByRole('button', {
        name: 'Start from scratch',
      })
    ).toBeInTheDocument();
    expect(
      within(newSpaceOptions).getByRole('button', {
        name: 'Use a local folder',
      })
    ).toBeInTheDocument();
    await user.click(
      within(newSpaceOptions).getByRole('button', {
        name: 'Import from Workspace Bundle',
      })
    );

    const bundleOptionsDialog = await screen.findByRole('dialog', {
      name: 'Import a Bundle',
    });
    const bundleOptions = within(bundleOptionsDialog).getByRole('group', {
      name: 'Bundle import options',
    });
    expect(bundleOptions).toHaveClass('grid-cols-2');
    expect(
      within(bundleOptions).getByRole('button', {
        name: 'Import Agent Plugin as Bundle',
      })
    ).toBeInTheDocument();
    await user.click(
      within(bundleOptions).getByRole('button', {
        name: 'Add Workspace Bundle name',
      })
    );

    const workspaceBundleDialog = await screen.findByRole('dialog', {
      name: 'Import Workspace Bundle',
    });
    expect(
      await within(workspaceBundleDialog).findByRole('textbox', {
        name: 'Workspace Bundle share handle',
      })
    ).toBeInTheDocument();
    await user.click(
      within(workspaceBundleDialog).getByRole('button', { name: 'Close' })
    );

    await user.click(newSpaceButton);
    const reopenedNewSpaceDialog = await screen.findByRole('dialog', {
      name: 'Create a new Space',
    });
    await user.click(
      within(reopenedNewSpaceDialog).getByRole('button', {
        name: 'Import from Workspace Bundle',
      })
    );
    const reopenedBundleOptions = await screen.findByRole('dialog', {
      name: 'Import a Bundle',
    });
    await user.click(
      within(reopenedBundleOptions).getByRole('button', {
        name: 'Import Agent Plugin as Bundle',
      })
    );
    const agentPluginDialog = await screen.findByRole('dialog', {
      name: 'Import Agent Plugin as Bundle',
    });
    expect(
      await within(agentPluginDialog).findByRole('button', {
        name: 'Select directory or archive',
      })
    ).toBeInTheDocument();
    await user.click(
      within(agentPluginDialog).getByRole('button', { name: 'Close' })
    );

    await user.click(modelsTab);

    await waitFor(() => {
      expect(modelsTab).toHaveAttribute('aria-current', 'page');
      expect(spacesTab).not.toHaveAttribute('aria-current');
    });
  });

  it('combines the app settings categories into one vertical page', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    const sidebar = screen.getByRole('complementary', { name: 'Home' });
    await user.click(within(sidebar).getByRole('button', { name: 'Settings' }));

    const general = await screen.findByTestId('general-settings');
    const appearance = screen.getByTestId('appearance-settings');
    const privacy = screen.getByTestId('privacy-settings');
    const about = screen.getByRole('img', { name: 'Eigent' });

    expect(
      general.compareDocumentPosition(appearance) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      appearance.compareDocumentPosition(privacy) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      privacy.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', {
        name: /general|appearance|privacy|about/i,
      })
    ).not.toBeInTheDocument();
  });

  it('shows one Skills overview with source filters instead of ownership tabs', async () => {
    const user = userEvent.setup();
    useSkillsStore.setState({ skills: [] });
    const sync = vi
      .spyOn(useSkillsStore.getState(), 'syncFromDisk')
      .mockResolvedValue();
    renderSettingsPage();
    await user.click(screen.getByRole('button', { name: 'Skills' }));
    expect(
      await screen.findByRole('heading', { name: 'Skills', level: 1 })
    ).not.toHaveClass('sr-only');
    expect(
      screen.queryByRole('tab', { name: 'Your skills' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Example skills' })
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole('combobox', { name: 'Skill source' })
    ).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Search skills…' })
    ).toBeVisible();
    const toolbar = screen.getByRole('region', { name: 'Skills toolbar' });
    const dashboard = screen.getByRole('region', { name: 'Skill overview' });
    const collectionHeader = toolbar.closest('header');
    expect(within(dashboard).getAllByRole('term')).toHaveLength(4);
    expect(collectionHeader).toHaveClass('min-h-ds-layout-row-header');
    expect(toolbar).toHaveClass('max-w-[1100px]', 'px-ds-32');
    expect(collectionHeader?.nextElementSibling?.firstElementChild).toHaveClass(
      'max-w-[1100px]',
      'px-8'
    );
    expect(collectionHeader?.nextElementSibling).toContainElement(dashboard);
    expect(collectionHeader).not.toContainElement(dashboard);
    expect(
      within(toolbar).getByRole('button', { name: 'Add skill' })
    ).toBeVisible();
    expect(
      toolbar.compareDocumentPosition(dashboard) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await user.click(
      within(toolbar).getByRole('button', { name: 'Add skill' })
    );
    const addSkillDialog = await screen.findByRole('dialog', {
      name: 'Add skill',
    });
    await waitFor(() => expect(addSkillDialog).toBeVisible());
    sync.mockRestore();
  });

  it('navigates Skills with the same shell transition and preserves overview filters on return', async () => {
    const user = userEvent.setup();
    const skill: Skill = {
      id: 'disk-research',
      name: 'research',
      skillDirName: 'research',
      description: 'Find sources',
      filePath: 'research/SKILL.md',
      fileContent: '',
      addedAt: 0,
      enabled: true,
      isExample: false,
      scope: { isGlobal: true, selectedAgents: [] },
    };
    useSkillsStore.setState({ skills: [skill] });
    const sync = vi
      .spyOn(useSkillsStore.getState(), 'syncFromDisk')
      .mockResolvedValue();
    const { unmount } = renderSettingsPage(
      '/home?section=settings&tab=skills&skillSearch=research&skillFilter=global'
    );
    const shell = document.querySelector(
      '[data-home-space-sidebar-pane]'
    )?.parentElement;
    const skillLink = await screen.findByRole('link', {
      name: 'research',
      exact: true,
    });
    const skillsTable = screen.getByRole('table', { name: 'Skills' });
    const headerRow = within(skillsTable).getAllByRole('row')[0];
    expect(headerRow).toHaveClass('hover:bg-transparent');
    expect(
      within(headerRow).queryByRole('button', { name: 'Skill' })
    ).not.toBeInTheDocument();
    expect(skillLink).toHaveClass(
      'hover:!text-ds-ink-default-default',
      'hover:no-underline'
    );
    expect(skillLink.closest('td')?.firstElementChild).toHaveClass(
      'flex',
      'flex-col',
      'justify-center'
    );
    expect(skillLink).toHaveAttribute(
      'href',
      '/home?section=settings&tab=skills&skillSearch=research&skillFilter=global&skillId=global%3Aresearch'
    );
    await user.click(skillLink);
    await waitFor(() =>
      expect(document.querySelector('[data-skill-detail]')).toBeInTheDocument()
    );
    const pane = document.querySelector(
      '[data-home-space-sidebar-pane="skill-detail"]'
    );
    expect(pane?.parentElement).toBe(shell);
    expect(pane).toHaveAttribute('data-space-navigation-direction', 'forward');
    expect(pane).toHaveAttribute('data-space-navigation-motion', 'full');
    await waitFor(() =>
      expect(
        screen.getByRole('navigation', { name: 'Select a skill' })
      ).toBeVisible()
    );
    const skillSidebar = screen.getByRole('complementary', { name: 'Skills' });
    const skillSidebarHeader = skillSidebar.querySelector(
      'header'
    ) as HTMLElement;
    expect(skillSidebarHeader).not.toHaveClass('border-b');
    const back = within(skillSidebarHeader).getByRole('button', {
      name: 'Back',
    });
    const addSkill = within(skillSidebarHeader).getByRole('button', {
      name: 'Add skill',
    });
    expect(addSkill).toHaveAttribute('data-variant', 'primary');
    expect(addSkill).toHaveClass('!rounded-full');
    const skillSearch = within(skillSidebar).getByRole('searchbox', {
      name: 'Search skills…',
    });
    expect(skillSearch.closest('.py-ds-8')).not.toHaveClass('px-ds-8');
    expect(
      addSkill.compareDocumentPosition(skillSearch) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(skillSidebar.querySelector('.uppercase')).not.toBeInTheDocument();
    await user.type(skillSearch, 'missing');
    expect(
      within(skillSidebar).queryByRole('button', { name: 'research' })
    ).not.toBeInTheDocument();
    expect(skillSidebar).toHaveTextContent('No skills match your filters.');
    await user.clear(skillSearch);
    fireEvent.keyDown(back, { key: 'Enter' });
    fireEvent.click(back);
    await waitFor(() =>
      expect(
        document.querySelector('[data-home-space-sidebar-pane="home"]')
      ).toHaveAttribute('data-space-navigation-motion', 'instant')
    );
    expect(
      await screen.findByRole('textbox', { name: 'Search skills…' })
    ).toHaveValue('research');
    expect(
      await screen.findByRole('combobox', { name: 'Skill source' })
    ).toHaveTextContent('Global');
    expect(screen.getByTestId('settings-location')).toHaveTextContent(
      '/home?section=settings&tab=skills&skillSearch=research&skillFilter=global'
    );
    unmount();
    sync.mockRestore();
    useSkillsStore.setState({ skills: [] });
  });

  it('removes the Skills toolbar and restores the settings header during a page switch', async () => {
    const user = userEvent.setup();

    renderSettingsPage();

    await user.click(screen.getByRole('button', { name: 'Skills' }));
    const toolbar = await screen.findByRole('region', {
      name: 'Skills toolbar',
    });

    expect(
      within(toolbar).getByRole('button', { name: 'Add skill' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Channels' }));

    await waitFor(() => {
      const header = getSettingsHeader();
      expect(
        screen.queryByRole('region', { name: 'Skills toolbar' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Add skill' })
      ).not.toBeInTheDocument();
      expect(within(header).getByText('Channels')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        document.querySelector('[data-settings-section="channels"]')
      ).toBeInTheDocument();
    });
  });

  it('uses the connector-focused sidebar for the Add connector subpage', async () => {
    renderSettingsPage(
      '/home?section=settings&tab=connectors&connectorView=add&connectorAdd=browse'
    );

    await waitFor(() =>
      expect(document.querySelector('[data-add-connector]')).toBeInTheDocument()
    );
    const sidebarPane = document.querySelector(
      '[data-home-space-sidebar-pane="connector-detail"]'
    );
    expect(sidebarPane).toBeInTheDocument();
    const connectorSidebar = await screen.findByRole('complementary', {
      name: 'Connectors',
    });
    expect(
      within(connectorSidebar).getByRole('button', { name: 'Back' })
    ).toBeVisible();
    expect(
      within(connectorSidebar).getByRole('button', { name: 'Add connector' })
    ).toHaveAttribute('data-variant', 'primary');

    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(
      within(breadcrumb).getByRole('button', { name: 'Connector' })
    ).toBeVisible();
    expect(breadcrumb.querySelector('ol')).not.toBeNull();
    expect(breadcrumb).not.toHaveAttribute('title');
    expect(
      screen.getByRole('heading', {
        name: 'Add connector',
        level: 1,
      })
    ).toBeVisible();
    expect(within(breadcrumb).queryByRole('heading')).toBeNull();
  });

  it('returns from Connector detail to the page that opened it', async () => {
    const user = userEvent.setup();
    renderSettingsPage([
      '/?space=workspace-space',
      {
        pathname: '/home',
        search:
          '?section=settings&tab=connectors&connectorView=add&connectorAdd=browse',
        state: { from: '/?space=workspace-space' },
      },
    ]);

    const connectorSidebar = await screen.findByRole('complementary', {
      name: 'Connectors',
    });
    await user.click(
      within(connectorSidebar).getByRole('button', { name: 'Back' })
    );

    await waitFor(() =>
      expect(screen.getByTestId('settings-location')).toHaveTextContent(
        '/?space=workspace-space'
      )
    );
  });

  it('returns from Space detail to its workspace origin', async () => {
    const user = userEvent.setup();
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'origin-space': {
          id: 'origin-space',
          name: 'Origin Space',
          sourceType: 'folder',
          rootPath: '/work/origin-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'origin-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'origin-space': now,
      },
    }));

    renderSettingsPage([
      '/',
      {
        pathname: '/home',
        search: '?section=spaces&spaceId=origin-space&spaceTab=projects',
        state: { from: '/' },
      },
    ]);

    const spaceSidebar = await screen.findByRole('complementary', {
      name: 'Spaces',
    });
    await user.click(
      within(spaceSidebar).getByRole('button', { name: 'Back' })
    );

    await waitFor(() =>
      expect(screen.getByTestId('settings-location')).toHaveTextContent(/^\/$/)
    );
  });

  it('switches to the Space detail layout without changing the shared shell', () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'space-1': {
          id: 'space-1',
          name: 'Design Space',
          description: 'Product design work',
          sourceType: 'folder',
          rootPath: '/work/design-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
        'legacy-untitled': {
          id: 'legacy-untitled',
          name: 'Untitled Space',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: 1,
          createdAt: now - 1,
          updatedAt: now - 1,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'space-1': {},
        'legacy-untitled': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'space-1': now,
      },
    }));

    const { unmount } = renderSettingsPage('/home?section=spaces');

    const cardWorkspaceButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-home-space-open-workspace][data-layout="card"]'
      )
    );
    expect(cardWorkspaceButtons.length).toBeGreaterThan(0);
    expect(cardWorkspaceButtons[0]).toHaveAttribute('data-variant', 'ghost');
    expect(cardWorkspaceButtons[0]).toHaveClass(
      'cursor-pointer',
      'rounded-lg',
      'font-medium'
    );
    expect(cardWorkspaceButtons[0].parentElement).not.toHaveTextContent(
      'Last updated:'
    );

    const homeSpaceCard = screen
      .getByText('Design Space')
      .closest('button') as HTMLElement;
    expect(homeSpaceCard).toBeInTheDocument();
    fireEvent.pointerDown(homeSpaceCard, { pointerType: 'mouse' });
    fireEvent.click(homeSpaceCard);

    const detailSidebar = screen.getByRole('complementary', {
      name: 'Spaces',
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-direction', 'forward');
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'full');
    const detailContent = document.querySelector(
      '[data-home-space-content-pane="detail"]'
    ) as HTMLElement;
    expect(detailContent).toHaveAttribute(
      'data-space-navigation-motion',
      'full'
    );
    expect(
      within(detailSidebar).getByRole('button', { name: 'Design Space' })
    ).toHaveAttribute('aria-current', 'page');
    const detailSidebarHeader = detailSidebar.querySelector(
      'header'
    ) as HTMLElement;
    expect(detailSidebarHeader).not.toHaveClass('border-b');
    expect(
      within(detailSidebarHeader).getByRole('button', { name: 'Back' })
    ).toBeInTheDocument();
    const newSpaceTab = within(detailSidebarHeader).getByRole('button', {
      name: 'New Space',
    });
    expect(newSpaceTab).toHaveAttribute('data-variant', 'primary');
    expect(newSpaceTab).toHaveClass('!rounded-full');
    expect(newSpaceTab.querySelector('svg')).toHaveClass('lucide-plus');
    const spaceSearch = within(detailSidebar).getByRole('searchbox', {
      name: 'Search spaces...',
    });
    expect(spaceSearch.closest('.py-ds-8')).not.toHaveClass('px-ds-8');
    expect(
      newSpaceTab.compareDocumentPosition(spaceSearch) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(detailSidebar.querySelector('.uppercase')).not.toBeInTheDocument();
    expect(
      within(detailSidebar).queryByRole('button', { name: 'Untitled Space' })
    ).not.toBeInTheDocument();
    fireEvent.change(spaceSearch, { target: { value: 'missing' } });
    expect(
      within(detailSidebar).queryByRole('button', { name: 'Design Space' })
    ).not.toBeInTheDocument();
    expect(detailSidebar).toHaveTextContent('No results match your search.');
    fireEvent.change(spaceSearch, { target: { value: '' } });
    fireEvent.click(newSpaceTab);
    expect(
      screen.getByRole('dialog', { name: 'Create a new Space' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(
      detailSidebar.querySelector('.lucide-check')
    ).not.toBeInTheDocument();
    const designSpaceTab = within(detailSidebar).getByRole('button', {
      name: 'Design Space',
    });
    const spaceMoreButton = within(detailSidebar).getByRole('button', {
      name: 'More actions: Design Space',
    });
    expect(spaceMoreButton.closest('.group')).toContainElement(designSpaceTab);

    openDropdown(spaceMoreButton);
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Rename Space',
      })
    );
    const renameDialog = screen.getByRole('alertdialog', {
      name: 'Rename Space',
    });
    expect(within(renameDialog).getByPlaceholderText('Space name')).toHaveValue(
      'Design Space'
    );
    fireEvent.click(
      within(renameDialog).getByRole('button', { name: 'Cancel' })
    );

    openDropdown(spaceMoreButton);
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Delete',
      })
    );
    const deleteDialog = screen.getByRole('alertdialog', { name: 'Delete' });
    expect(deleteDialog).toHaveTextContent(
      'Are you sure you want to delete this space and all its sessions?'
    );
    fireEvent.click(
      within(deleteDialog).getByRole('button', { name: 'Cancel' })
    );
    const detailHeader = detailContent.querySelector('header') as HTMLElement;
    expect(detailHeader).toHaveClass('px-ds-16');
    const detailHeading = within(detailHeader).getByRole('heading', {
      name: 'Design Space',
      level: 1,
    });
    expect(detailHeading).toHaveClass('!text-ds-text-base');
    const openWorkspaceButton = within(detailHeader).getByRole('button', {
      name: 'Open workspace',
    });
    expect(openWorkspaceButton).toHaveAttribute('data-variant', 'primary');
    expect(openWorkspaceButton).toHaveClass('!rounded-full');
    expect(
      within(detailContent).getByText('Product design work')
    ).toBeInTheDocument();
    expect(within(detailContent).getByText('Local')).toBeInTheDocument();

    for (const tabName of [
      'Sessions',
      'Tasks',
      'Automations',
      'Context',
      'Memory',
      'Space settings',
    ]) {
      expect(screen.getByRole('tab', { name: tabName })).toBeInTheDocument();
    }
    expect(screen.getByRole('tablist', { name: 'Space content' })).toHaveClass(
      'gap-2',
      'pb-2'
    );
    expect(
      within(screen.getByRole('tab', { name: 'Sessions' })).getByText(
        'Sessions'
      )
    ).toHaveClass('!text-ds-text-base', 'font-bold');
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(
      screen.getByRole('tab', { name: 'Sessions' }).querySelector('svg')
    ).toHaveClass('lucide-message-circle');
    expect(
      document.querySelector('[data-space-stat="Sessions"] svg')
    ).toHaveClass('lucide-message-circle');
    expect(
      screen.getByRole('tab', { name: 'Context' }).querySelector('svg')
    ).toHaveClass('lucide-library');
    expect(
      screen.getByRole('tab', { name: 'Space settings' }).querySelector('svg')
    ).toHaveClass('lucide-settings');
    fireEvent.pointerEnter(screen.getByRole('tab', { name: 'Memory' }), {
      pointerType: 'mouse',
    });
    expect(document.querySelector('[data-space-detail-tab-hover]')).toHaveClass(
      'rounded-full',
      'bg-ds-neutral-default-default'
    );
    expect(screen.getByRole('tab', { name: 'Memory' })).toHaveClass(
      'rounded-full'
    );
    const stickyTabs = document.querySelector('[data-space-tabs-sticky]');
    expect(stickyTabs).toHaveClass(
      'sticky',
      '-top-px',
      'border-b-1',
      'bg-ds-neutral-subtle-default'
    );
    const detailRails = [
      document.querySelector('[data-space-detail-summary-rail]'),
      document.querySelector('[data-space-detail-tabs-rail]'),
      document.querySelector('[data-space-detail-content-rail]'),
    ];
    for (const rail of detailRails) {
      expect(rail).toHaveClass('mx-auto', 'w-full', 'max-w-[1100px]');
    }
    expect(detailRails[2]?.parentElement).toHaveClass('px-8');
    expect(detailRails[2]).not.toHaveClass('px-8');
    expect(document.querySelector('[data-space-stat="Status"]')).toHaveClass(
      'items-center'
    );
    unmount();
  });

  it('keeps the workspace action last in a Spaces list row', () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        'list-space': {
          id: 'list-space',
          name: 'List Space',
          sourceType: 'folder',
          rootPath: '/work/list-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: { 'list-space': {} },
      projectsSyncedAt: { 'list-space': now },
    }));
    window.localStorage.setItem('eigent-home-hub-view-mode', 'list');

    const { unmount } = renderSettingsPage('/home?section=spaces');

    const listWorkspaceButton = document.querySelector<HTMLButtonElement>(
      '[data-home-space-open-workspace][data-layout="list"]'
    );
    expect(listWorkspaceButton).toHaveClass(
      'cursor-pointer',
      'rounded-lg',
      'font-medium'
    );
    expect(listWorkspaceButton?.parentElement).toHaveClass('justify-self-end');
    expect(listWorkspaceButton).toHaveAttribute('data-variant', 'ghost');
    expect(listWorkspaceButton?.parentElement?.lastElementChild).toBe(
      listWorkspaceButton
    );
    unmount();
  });

  it('keeps reduced-motion navigation to fades and keyboard navigation instant', () => {
    pageMotionMocks.reduced = true;
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'motion-space': {
          id: 'motion-space',
          name: 'Motion Space',
          description: 'Motion test space',
          sourceType: 'folder',
          rootPath: '/work/motion-space',
          status: 'active',
          schemaVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'motion-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'motion-space': now,
      },
    }));

    const { unmount } = renderSettingsPage('/home?section=spaces');

    const spaceCard = screen
      .getByText('Motion Space')
      .closest('button') as HTMLElement;
    fireEvent.pointerDown(spaceCard, { pointerType: 'mouse' });
    fireEvent.click(spaceCard);

    const detailSidebar = screen.getByRole('complementary', {
      name: 'Spaces',
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'fade');
    expect(
      document.querySelector('[data-home-space-content-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'fade');

    const backButton = within(detailSidebar).getByRole('button', {
      name: 'Back',
    });
    backButton.focus();
    fireEvent.keyDown(backButton, { key: 'Enter' });
    fireEvent.click(backButton);
    expect(
      screen.getByRole('complementary', { name: 'Home' })
    ).toBeInTheDocument();

    expect(
      document.querySelector('[data-home-space-sidebar-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'instant');
    expect(
      document.querySelector('[data-home-space-content-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'instant');
    unmount();
  });

  it('redirects an empty placeholder Space to Home without listing it', async () => {
    const now = Date.now();
    useSpaceStore.setState((state) => ({
      ...state,
      spaces: {
        ...state.spaces,
        'empty-space': {
          id: 'empty-space',
          name: 'Untitled Space',
          sourceType: 'blank',
          status: 'active',
          schemaVersion: 2,
          createdAt: now,
          updatedAt: now,
          metadata: {
            createdFrom: 'space_detail_sidebar',
            autoCreatedPlaceholder: true,
          },
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        'empty-space': {},
      },
      projectsSyncedAt: {
        ...state.projectsSyncedAt,
        'empty-space': now,
      },
    }));

    renderSettingsPage(
      '/home?section=spaces&spaceId=empty-space&spaceTab=projects'
    );

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Home' })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText('Untitled Space')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-home-spaces-list]')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Connect to a local folder' })
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-space-stat]')).not.toBeInTheDocument();
  });

  it('supports horizontal section content while defaulting to vertical', () => {
    const { rerender } = render(
      <SettingsSection title="Section title">
        <span>Section content</span>
      </SettingsSection>
    );

    const getSectionBox = () =>
      screen.getByText('Section title').parentElement?.nextElementSibling;

    expect(getSectionBox()).toHaveClass('flex-col');

    rerender(
      <SettingsSection title="Section title" variant="horizontal">
        <span>Section content</span>
      </SettingsSection>
    );

    expect(getSectionBox()).toHaveClass('flex-row');

    rerender(
      <SettingsSection titleVariant="hidden">
        <span>Section content</span>
      </SettingsSection>
    );

    expect(screen.queryByText('Section title')).not.toBeInTheDocument();
    expect(screen.getByText('Section content').parentElement).toHaveClass(
      'rounded-2xl',
      'border-0',
      'bg-ds-neutral-default-default',
      'p-4'
    );

    rerender(
      <SettingsSection titleVariant="hidden" surface="plain">
        <span>Section content</span>
      </SettingsSection>
    );

    expect(screen.getByText('Section content').parentElement).toHaveClass(
      'bg-transparent'
    );
    expect(screen.getByText('Section content').parentElement).not.toHaveClass(
      'bg-ds-neutral-default-default'
    );
  });
});
