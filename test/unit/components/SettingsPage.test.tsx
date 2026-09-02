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
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/brain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/brain')>()),
  skillRead: vi
    .fn()
    .mockResolvedValue({ success: true, content: '# Research' }),
}));

const homeOverviewMocks = vi.hoisted(() => ({
  fetchConnectedProviders: vi.fn(),
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

vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => pageMotionMocks.reduced,
}));

vi.mock('@/api/connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/connectors')>()),
  fetchConnectedProviders: homeOverviewMocks.fetchConnectedProviders,
}));

vi.mock('@/service/memoryApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/memoryApi')>()),
  listMemoryEntries: homeOverviewMocks.listMemoryEntries,
}));

vi.mock('@/hooks/queries/useTriggerQueries', () => ({
  useUserTriggerCountQuery: () => ({ data: 0 }),
}));

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

function renderSettingsPage(
  initialEntry = '/home?section=settings&tab=models'
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SettingsPage />
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
    useSettingsStore.setState({
      activeSection: 'models',
    });
    homeOverviewMocks.fetchConnectedProviders.mockResolvedValue([
      { service: 'github' },
      { service: 'notion' },
    ]);
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

    await user.click(await screen.findByRole('button', { name: 'New Space' }));
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
    const list = document.querySelector('[data-home-spaces-list]');
    expect(toolbar).toHaveClass(
      'sticky',
      '-top-px',
      'z-20',
      'bg-ds-neutral-subtle-default'
    );
    expect(document.querySelector('main > header')).not.toBeInTheDocument();
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
    expect(within(dashboard).getAllByRole('term')).toHaveLength(4);
    expect(screen.getByRole('main').querySelector('header')).toBeNull();
    expect(
      within(toolbar).getByRole('button', { name: 'Add skill' })
    ).toBeVisible();
    expect(
      dashboard.compareDocumentPosition(toolbar) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await user.click(
      within(toolbar).getByRole('button', { name: 'Add skill' })
    );
    expect(
      await screen.findByRole('dialog', { name: 'Add skill' })
    ).toBeVisible();
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
    const back = within(
      screen.getByRole('complementary', { name: 'Skills' })
    ).getByRole('button', { name: 'Back to Skills' });
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

  it('switches to the Space detail layout without changing the shared shell', async () => {
    const user = userEvent.setup();
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

    renderSettingsPage('/home?section=spaces');

    const homeSpaceCard = (await screen.findByText('Design Space')).closest(
      '[role="button"]'
    ) as HTMLElement;
    expect(homeSpaceCard).toBeInTheDocument();
    await user.click(homeSpaceCard);

    const detailSidebar = await screen.findByRole('complementary', {
      name: 'Spaces',
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-direction', 'forward');
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'full');
    expect(
      document.querySelector('[data-home-space-content-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'full');
    expect(
      within(detailSidebar).getByRole('button', { name: 'Design Space' })
    ).toHaveAttribute('aria-current', 'page');
    expect(
      within(detailSidebar).getByRole('button', { name: 'Back to Home' })
    ).toBeInTheDocument();
    const newSpaceTab = within(detailSidebar).getByRole('button', {
      name: 'New Space',
    });
    expect(newSpaceTab.querySelector('svg')).toHaveClass('lucide-plus');
    expect(
      newSpaceTab.compareDocumentPosition(
        within(detailSidebar).getByText('Spaces')
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(detailSidebar).queryByRole('button', { name: 'Untitled Space' })
    ).not.toBeInTheDocument();
    await user.click(newSpaceTab);
    expect(
      await screen.findByRole('dialog', { name: 'Create a new Space' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
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

    await user.click(spaceMoreButton);
    await user.click(
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
    await user.click(
      within(renameDialog).getByRole('button', { name: 'Cancel' })
    );

    await user.click(spaceMoreButton);
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Delete',
      })
    );
    const deleteDialog = screen.getByRole('alertdialog', { name: 'Delete' });
    expect(deleteDialog).toHaveTextContent(
      'Are you sure you want to delete this space and all its sessions?'
    );
    await user.click(
      within(deleteDialog).getByRole('button', { name: 'Cancel' })
    );
    const detailHeader = document.querySelector('main header');
    expect(detailHeader).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByText('Design Space')
    ).toHaveClass('!text-ds-text-section');
    expect(screen.getByText('Product design work')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();

    for (const tabName of [
      'Sessions',
      'Tasks',
      'Automations',
      'Context',
      'Memory',
      'Space Settings',
    ]) {
      expect(screen.getByRole('tab', { name: tabName })).toBeInTheDocument();
    }
    expect(screen.getByRole('tablist', { name: 'Space content' })).toHaveClass(
      'gap-2',
      'pb-2'
    );
    const spaceTabRow = screen.getByRole('tablist', {
      name: 'Space content',
    }).parentElement;
    expect(spaceTabRow).toHaveClass('justify-between');
    const openWorkspaceButton = within(spaceTabRow as HTMLElement).getByRole(
      'button',
      {
        name: 'Open Workspace',
      }
    );
    expect(openWorkspaceButton).toHaveAttribute('data-variant', 'primary');
    expect(openWorkspaceButton).toHaveClass('!rounded-full');
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
      screen.getByRole('tab', { name: 'Space Settings' }).querySelector('svg')
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

    await user.click(screen.getByRole('tab', { name: 'Tasks' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    });
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    await user.click(
      within(detailSidebar).getByRole('button', { name: 'Back to Home' })
    );

    await waitFor(() => {
      expect(
        screen.getByRole('complementary', { name: 'Home' })
      ).toBeInTheDocument();
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="home"]')
    ).toHaveAttribute('data-space-navigation-direction', 'back');
    expect(
      document.querySelector('[data-home-space-sidebar-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'full');
    expect(
      document.querySelector('[data-home-space-content-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'full');
    expect(screen.getByRole('button', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spaces' })).toHaveAttribute(
      'aria-current',
      'page'
    );

    const cardWorkspaceButtons = await waitFor(() => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-home-space-open-workspace][data-layout="card"]'
        )
      );
      expect(buttons.length).toBeGreaterThan(0);
      return buttons;
    });
    expect(cardWorkspaceButtons[0]).toHaveAttribute('data-variant', 'ghost');
    expect(cardWorkspaceButtons[0]).toHaveClass(
      'cursor-pointer',
      'rounded-lg',
      'font-medium'
    );
    expect(
      cardWorkspaceButtons[0].closest('[role="button"]')
    ).not.toHaveTextContent('Last updated:');

    const homeToolbar = document.querySelector(
      '[data-home-spaces-toolbar]'
    ) as HTMLElement;
    await user.click(within(homeToolbar).getByRole('tab', { name: 'List' }));
    const listWorkspaceButtons = await waitFor(() => {
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[data-home-space-open-workspace][data-layout="list"]'
        )
      );
      expect(buttons.length).toBeGreaterThan(0);
      return buttons;
    });
    expect(listWorkspaceButtons[0]).toHaveClass(
      'justify-self-end',
      'cursor-pointer',
      'rounded-lg',
      'font-medium'
    );
    expect(listWorkspaceButtons[0]).toHaveAttribute('data-variant', 'ghost');
    expect(listWorkspaceButtons[0].parentElement?.lastElementChild).toBe(
      listWorkspaceButtons[0]
    );
    await user.click(within(homeToolbar).getByRole('tab', { name: 'Grid' }));
  });

  it('keeps reduced-motion navigation to fades and keyboard navigation instant', async () => {
    pageMotionMocks.reduced = true;
    const user = userEvent.setup();
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

    renderSettingsPage('/home?section=spaces');

    const spaceCard = (await screen.findByText('Motion Space')).closest(
      '[role="button"]'
    ) as HTMLElement;
    await user.click(spaceCard);

    const detailSidebar = await screen.findByRole('complementary', {
      name: 'Spaces',
    });
    expect(
      document.querySelector('[data-home-space-sidebar-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'fade');
    expect(
      document.querySelector('[data-home-space-content-pane="detail"]')
    ).toHaveAttribute('data-space-navigation-motion', 'fade');

    const backButton = within(detailSidebar).getByRole('button', {
      name: 'Back to Home',
    });
    backButton.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('complementary', { name: 'Home' });

    expect(
      document.querySelector('[data-home-space-sidebar-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'instant');
    expect(
      document.querySelector('[data-home-space-content-pane="home"]')
    ).toHaveAttribute('data-space-navigation-motion', 'instant');
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
  });
});
