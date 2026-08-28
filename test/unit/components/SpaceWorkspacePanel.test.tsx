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

import { SpaceWorkspacePanel } from '@/components/Workspace/SpaceWorkspacePanel';
import type { Space, SpaceProjectMeta } from '@/store/spaceStore';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type WorkspaceGuideTabId = 'primary' | 'connect-tools' | 'use-cases';

  const authState = {
    email: 'person@example.com',
    user_id: 7,
    workspaceGuideAudience: 'new' as 'new' | 'existing',
    dismissedWorkspaceGuideTabs: [] as WorkspaceGuideTabId[],
    dismissWorkspaceGuideTab: vi.fn(),
    restoreWorkspaceGuideTabs: vi.fn(),
  };
  const spaceState = {
    projectsBySpaceId: {} as Record<string, Record<string, unknown>>,
    shouldSyncProjects: vi.fn(() => false),
    syncProjectsFromServer: vi.fn().mockResolvedValue(undefined),
  };

  return {
    authState,
    fetchGet: vi.fn(),
    fetchHistory: vi.fn(),
    fetchTriggers: vi.fn(),
    spaceState,
  };
});

vi.mock('@/api/http', () => ({ fetchGet: mocks.fetchGet }));

vi.mock('@/service/historyApi', () => ({
  fetchGroupedHistoryProjects: mocks.fetchHistory,
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggers: mocks.fetchTriggers,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks.authState) => unknown) =>
    selector(mocks.authState),
}));

vi.mock('@/store/spaceStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/spaceStore')>();
  const useSpaceStore = Object.assign(
    (selector: (state: typeof mocks.spaceState) => unknown) =>
      selector(mocks.spaceState),
    { getState: () => mocks.spaceState }
  );

  return { ...actual, useSpaceStore };
});

vi.mock('sonner', () => {
  const toast = Object.assign(
    vi.fn(() => 'toast-id'),
    {
      dismiss: vi.fn(),
    }
  );
  return { toast };
});

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function makeSpace(id: string, overrides: Partial<Space> = {}): Space {
  const now = Date.now();
  return {
    id,
    name: `Space ${id}`,
    sourceType: 'blank',
    status: 'active',
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSession(
  spaceId: string,
  overrides: Partial<SpaceProjectMeta> = {}
): SpaceProjectMeta {
  const now = Date.now();
  return {
    id: `session-${spaceId}`,
    spaceId,
    name: 'Research session',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function renderPanel(
  space: Space,
  overrides: Partial<ComponentProps<typeof SpaceWorkspacePanel>> = {}
) {
  const props: ComponentProps<typeof SpaceWorkspacePanel> = {
    space,
    onUsePrompt: vi.fn(),
    onConnectApp: vi.fn(),
    onExploreUseCases: vi.fn(),
    onOpenFiles: vi.fn(),
    onOpenFolder: vi.fn(),
    canOpenFolder: true,
    ...overrides,
  };

  return {
    ...render(
      <MemoryRouter>
        <SpaceWorkspacePanel {...props} />
        <LocationProbe />
      </MemoryRouter>
    ),
    props,
  };
}

function setSingleSession(spaceId: string) {
  const session = makeSession(spaceId);
  mocks.spaceState.projectsBySpaceId = {
    [spaceId]: { [session.id]: session },
  };
  return session;
}

function makeHistoryProject(spaceId: string, sessionId: string) {
  const now = new Date().toISOString();
  return {
    project_id: sessionId,
    space_id: spaceId,
    task_count: 1,
    tasks: [{ created_at: now, updated_at: now }],
  };
}

describe('SpaceWorkspacePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authState.workspaceGuideAudience = 'new';
    mocks.authState.dismissedWorkspaceGuideTabs = [];
    mocks.spaceState.projectsBySpaceId = {};
    mocks.spaceState.shouldSyncProjects.mockReturnValue(false);
    mocks.fetchGet.mockResolvedValue([]);
    mocks.fetchHistory.mockResolvedValue([]);
    mocks.fetchTriggers.mockResolvedValue({ items: [], total: 0 });
  });

  it('omits only the prompt guide when the caller cannot use prompts', () => {
    const onConnectApp = vi.fn();
    const onExploreUseCases = vi.fn();

    renderPanel(makeSpace('restricted'), {
      canUsePrompt: false,
      onConnectApp,
      onExploreUseCases,
    });

    expect(
      screen.queryByRole('button', { name: 'Show me how to use Eigent' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect tools' }));
    fireEvent.click(screen.getByRole('button', { name: 'Explore use cases' }));
    expect(onConnectApp).toHaveBeenCalledOnce();
    expect(onExploreUseCases).toHaveBeenCalledOnce();
  });

  it('separates Activity from visible guides and promotes it when none remain', () => {
    const space = makeSpace('section-order');
    const firstPanel = renderPanel(space);

    expect(
      screen.getByRole('heading', { name: 'Activity' }).closest('section')
    ).toHaveClass('border-t', 'py-ds-16');

    firstPanel.unmount();
    mocks.authState.dismissedWorkspaceGuideTabs = [
      'primary',
      'connect-tools',
      'use-cases',
    ];
    renderPanel(space);

    const activitySection = screen
      .getByRole('heading', { name: 'Activity' })
      .closest('section');
    expect(activitySection).toHaveClass('pb-ds-16');
    expect(activitySection).not.toHaveClass('border-t');
  });

  it('does not refetch aggregates when only Session update order changes', async () => {
    const space = makeSpace('stable-project-key');
    const now = Date.now();
    const olderSession = makeSession(space.id, {
      id: 'older-session',
      createdAt: now - 2_000,
      updatedAt: now - 2_000,
    });
    const newerSession = makeSession(space.id, {
      id: 'newer-session',
      createdAt: now - 1_000,
      updatedAt: now - 1_000,
    });
    mocks.spaceState.projectsBySpaceId = {
      [space.id]: {
        [olderSession.id]: olderSession,
        [newerSession.id]: newerSession,
      },
    };

    const { rerender, props } = renderPanel(space);
    await waitFor(() => {
      expect(mocks.fetchTriggers).toHaveBeenCalledTimes(1);
      expect(mocks.fetchGet).toHaveBeenCalledTimes(2);
    });

    mocks.spaceState.projectsBySpaceId = {
      [space.id]: {
        [olderSession.id]: { ...olderSession, updatedAt: now },
        [newerSession.id]: newerSession,
      },
    };
    rerender(
      <MemoryRouter>
        <SpaceWorkspacePanel {...props} />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(mocks.fetchTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.fetchGet).toHaveBeenCalledTimes(2);
  });

  it('uses singular summary fragments and coarse-pointer-safe hit areas', async () => {
    const space = makeSpace('one-of-each', {
      sourceType: 'folder',
      rootPath: '/tmp/one-of-each',
    });
    const session = setSingleSession(space.id);
    mocks.fetchHistory.mockResolvedValue([
      makeHistoryProject(space.id, session.id),
    ]);
    mocks.fetchTriggers.mockResolvedValue({
      items: [{ space_id: space.id }],
      total: 1,
    });

    const { props } = renderPanel(space);

    const sessionHighlight = await screen.findByText('1 Session');
    const summary = sessionHighlight.closest('p');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('1 Task');
    expect(summary).toHaveTextContent('1 automation');
    expect(summary).toHaveTextContent('1 day');
    expect(summary).not.toHaveTextContent('1 Sessions');
    expect(summary).not.toHaveTextContent('1 Tasks');
    expect(summary).not.toHaveTextContent('1 automations');
    expect(summary).not.toHaveTextContent('1 days');
    const highlights = summary?.querySelectorAll('strong') ?? [];
    expect(highlights).toHaveLength(4);
    highlights.forEach((highlight) => {
      expect(highlight).toHaveClass(
        'font-bold',
        'text-ds-accent-default-default'
      );
    });
    expect(
      screen.queryByRole('button', { name: '7 days' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '30 days' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('img', { name: /Tasks over/ })
    ).not.toBeInTheDocument();
    const openFolderButton = screen.getByRole('button', {
      name: 'Open folder',
    });
    expect(openFolderButton).toHaveClass(
      'after:inset-x-0',
      'after:-inset-y-ds-10',
      '[@media(pointer:coarse)]:min-w-ds-48'
    );
    const filesHeading = screen.getByRole('heading', { name: 'Files' });
    const filesLink = screen.getByRole('link', { name: 'Files' });
    const bindingTag = screen.getByText('Local');
    expect(filesHeading.parentElement).toContainElement(bindingTag);
    expect(filesHeading.parentElement).not.toContainElement(openFolderButton);
    expect(bindingTag).toHaveClass(
      'shrink-0',
      'self-stretch',
      '!px-1.5',
      '!py-px'
    );
    fireEvent.click(filesLink);
    expect(props.onOpenFiles).toHaveBeenCalledOnce();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(
      screen.getByRole('button', {
        name: "Hide What's new about Eigent",
      })
    ).toHaveClass('after:-inset-ds-8');
  });

  it('does not count an empty synced Session as activity', async () => {
    const space = makeSpace('empty-session');
    setSingleSession(space.id);

    renderPanel(space);

    const sessionHighlight = await screen.findByText('0 Sessions');
    const summary = sessionHighlight.closest('p');
    expect(summary).toHaveTextContent('0 Tasks');
    expect(summary).not.toHaveTextContent('1 Session');
  });

  it.each(['history', 'automation'] as const)(
    'renders an unavailable summary when the %s aggregate request fails',
    async (failedRequest) => {
      const space = makeSpace(`${failedRequest}-error`);
      const session = setSingleSession(space.id);
      const warn = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      mocks.fetchHistory.mockResolvedValue([
        makeHistoryProject(space.id, session.id),
      ]);
      if (failedRequest === 'history') {
        mocks.fetchHistory.mockRejectedValue(new Error('history unavailable'));
      } else {
        mocks.fetchTriggers.mockRejectedValue(
          new Error('automations unavailable')
        );
      }

      renderPanel(space);

      const unavailableSummary = await screen.findByText(
        'Activity summary is temporarily unavailable.'
      );
      expect(unavailableSummary).toBeInTheDocument();
      expect(unavailableSummary).not.toHaveTextContent(/0 Tasks/);
      expect(unavailableSummary).not.toHaveTextContent(/0 automations/);
      warn.mockRestore();
    }
  );

  it('clears file aggregates before a replacement source finishes loading', async () => {
    const firstSpace = makeSpace('bound-space', {
      sourceType: 'folder',
      rootPath: '/tmp/first',
    });
    const secondSpace = makeSpace('bound-space', {
      sourceType: 'folder',
      rootPath: '/tmp/second',
    });
    let resolveSecondListing: (files: unknown[]) => void = () => undefined;
    const secondListing = new Promise<unknown[]>((resolve) => {
      resolveSecondListing = resolve;
    });
    mocks.fetchGet
      .mockResolvedValueOnce([{ filename: 'brief.pdf' }])
      .mockImplementation(() => secondListing);

    const { rerender, props } = renderPanel(firstSpace);
    expect(await screen.findByText('1 file')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <SpaceWorkspacePanel {...props} space={secondSpace} />
        <LocationProbe />
      </MemoryRouter>
    );

    expect(screen.queryByText('1 file')).not.toBeInTheDocument();
    expect(screen.queryByText('Documents')).not.toBeInTheDocument();

    await act(async () => {
      resolveSecondListing([]);
      await secondListing;
    });
    await waitFor(() => {
      expect(screen.queryByText('1 file')).not.toBeInTheDocument();
    });
  });
});
