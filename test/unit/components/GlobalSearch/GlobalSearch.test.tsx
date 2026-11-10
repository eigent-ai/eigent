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

// Load the HTTP client first, as the app does at boot, so the auth store
// and i18n settle their import cycle in the same order.
import '@/api/http';

import {
  GlobalSearchButton,
  GlobalSearchHost,
} from '@/components/GlobalSearch';
import { useGlobalSearchStore } from '@/components/GlobalSearch/globalSearchStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeAppCommand: vi.fn(),
  openSpaceView: vi.fn(),
  switchToSpace: vi.fn(),
  openSessionInShell: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/host', async (importOriginal) => {
  const host = {
    ipcRenderer: { invoke: mocks.invoke, on: vi.fn(), off: vi.fn() },
  };
  return {
    ...(await importOriginal<typeof import('@/host')>()),
    useHost: () => host,
  };
});

vi.mock('@/components/Home', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/Home/hooks/useHomeHubProjects', () => ({
  useHomeHubProjects: () => ({
    projects: [
      {
        project_id: 'session-1',
        latest_task_date: '2026-11-01T10:00:00',
        tasks: [{ task_id: 'task-1', question: 'Draft the launch plan' }],
      },
    ],
  }),
}));
vi.mock('@/components/Home/hooks/useHomeHubTriggers', () => ({
  useHomeHubTriggers: () => ({
    triggers: [{ id: 7, name: 'Morning digest', space_id: 'space-ops' }],
  }),
}));
vi.mock('@/components/Layout/AppCommandProvider', () => ({
  useAppCommand: () => mocks.executeAppCommand,
}));
vi.mock('@/hooks/useSpaceSwitch', () => ({
  useSpaceSwitch: () => ({
    openSpaceView: mocks.openSpaceView,
    switchToSpace: mocks.switchToSpace,
  }),
}));
vi.mock('@/lib/sessionOpen', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sessionOpen')>()),
  openSessionInShell: mocks.openSessionInShell,
}));
vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: async (
    action: () => void | Promise<void>
  ) => {
    await action();
    return true;
  },
}));

const space = (id: string, name: string): Space => ({
  id,
  name,
  sourceType: 'folder',
  rootPath: `/work/${id}`,
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 1,
});

function renderSearch() {
  return render(
    <MemoryRouter>
      <GlobalSearchButton />
      <GlobalSearchHost />
    </MemoryRouter>
  );
}

describe('global search', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.switchToSpace.mockResolvedValue(true);
    mocks.openSessionInShell.mockResolvedValue(undefined);
    mocks.invoke.mockResolvedValue([]);
    useGlobalSearchStore.setState({ open: false });
    useProjectRuntimeStore.setState({ activeProjectId: null });
    useSpaceStore.setState({
      activeSpaceId: 'space-research',
      spaces: {
        'space-research': space('space-research', 'Research'),
        'space-ops': space('space-ops', 'Ops'),
      },
      projectsBySpaceId: {
        'space-research': {
          'session-1': {
            id: 'session-1',
            spaceId: 'space-research',
            name: 'Launch notes',
            status: 'active',
            createdAt: 1,
            updatedAt: 2,
            metadata: { historyId: 'history-1' },
          },
        },
        'space-ops': {},
      },
      projectIdIndex: { 'session-1': 'space-research' },
    });
  });

  it('is a transparent button as wide as its content, opening the dialog as ⌘K does', async () => {
    const user = userEvent.setup();
    renderSearch();

    const button = document.querySelector(
      '[data-global-search-button]'
    ) as HTMLElement;
    expect(button).toHaveClass('w-fit', 'bg-transparent');
    await user.click(button);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => useGlobalSearchStore.setState({ open: false }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it("does not show the last Session's files while the next ones load", async () => {
    const user = userEvent.setup();
    mocks.invoke.mockResolvedValueOnce([{ name: 'plan.md', path: '/s1/plan' }]);
    act(() => {
      useProjectRuntimeStore.setState({ activeProjectId: 'session-1' });
      useGlobalSearchStore.setState({ open: true });
    });
    renderSearch();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Files' }));
    expect(await within(dialog).findByText('plan.md')).toBeInTheDocument();

    mocks.invoke.mockReturnValueOnce(new Promise(() => undefined));
    act(() =>
      useProjectRuntimeStore.setState({ activeProjectId: 'session-2' })
    );

    expect(within(dialog).queryByText('plan.md')).toBeNull();
  });

  it('has every type, Recents and New session', async () => {
    act(() => useGlobalSearchStore.setState({ open: true }));
    renderSearch();
    const dialog = await screen.findByRole('dialog');

    expect(
      within(within(dialog).getByRole('group', { name: 'Search' }))
        .getAllByRole('button')
        .map((button) => button.textContent)
    ).toEqual([
      'All',
      'Spaces',
      'Sessions',
      'Tasks',
      'Files',
      'Automations',
      'Dispatch',
    ]);
    expect(within(dialog).getByText('Recents')).toBeInTheDocument();
    expect(within(dialog).getByText('Launch notes')).toBeInTheDocument();
    expect(within(dialog).getByText('New session')).toBeInTheDocument();
  });

  it('filters by type and query, and changes type with the arrow keys', async () => {
    const user = userEvent.setup();
    act(() => useGlobalSearchStore.setState({ open: true }));
    renderSearch();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Tasks' }));
    expect(within(dialog).getByText('Draft the launch plan')).toBeVisible();
    expect(within(dialog).queryByText('Launch notes')).toBeNull();

    const input = within(dialog).getByRole('combobox');
    await user.click(input);
    await user.keyboard('{ArrowRight}');
    expect(
      within(dialog).getByRole('button', { name: 'Files' })
    ).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await user.type(input, 'digest');
    expect(within(dialog).getByText('Morning digest')).toBeVisible();
  });

  it('opens a Session in its Space, and a Space in its view', async () => {
    const user = userEvent.setup();
    act(() => useGlobalSearchStore.setState({ open: true }));
    renderSearch();
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByText('Launch notes'));
    await vi.waitFor(() =>
      expect(mocks.openSessionInShell).toHaveBeenCalledWith('session-1')
    );
    expect(useGlobalSearchStore.getState().open).toBe(false);

    act(() => useGlobalSearchStore.setState({ open: true }));
    const reopened = await screen.findByRole('dialog');
    await user.click(within(reopened).getByRole('button', { name: 'Spaces' }));
    await user.click(within(reopened).getByText('Ops'));
    expect(mocks.openSpaceView).toHaveBeenCalledWith('space-ops');
  });
});
