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

import { act, cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspacePage from '@/pages/Workspace';
import { usePageTabStore } from '@/store/pageTabStore';

type ProjectMeta = { id: string; spaceId: string; name: string };

const mocks = vi.hoisted(() => {
  const spaceState = {
    activeSpaceId: 'space-1' as string | null,
    projectsBySpaceId: {} as Record<string, ProjectMeta[]>,
    lastVisitedProjectBySpace: {} as Record<string, string>,
    getProjectsForSpace: (spaceId?: string | null) =>
      spaceId ? (spaceState.projectsBySpaceId[spaceId] ?? []) : [],
    getProjectMeta: () => null,
  };
  return {
    spaceState,
    projectStore: {
      activeProjectId: null as string | null,
      setActiveProject: vi.fn(),
    },
  };
});

vi.mock('@/store/spaceStore', () => {
  const useSpaceStore = Object.assign(
    (selector: (state: typeof mocks.spaceState) => unknown) =>
      selector(mocks.spaceState),
    { getState: () => mocks.spaceState }
  );
  return { useSpaceStore };
});

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ chatStore: null, projectStore: mocks.projectStore }),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({
      email: 'fixture@example.com',
      user_id: 7,
      workspaceMainBackground: 'empty',
    }),
}));

vi.mock('@/host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/host')>()),
  useHost: () => null,
}));

vi.mock('@/api/http', () => ({ checkLocalServerStale: vi.fn() }));

vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/components/Layout/AppShellLayout', () => ({
  APP_SHELL_CONTENT_CLASS: '',
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/Background', () => ({
  DashedLinesBackground: () => null,
  DotPatternBackground: () => null,
  DottedLinesBackground: () => null,
  GridPatternBackground: () => null,
  RuledLinesBackground: () => null,
}));

vi.mock('@/components/Dispatch', () => ({ WorkspaceDispatch: () => null }));
vi.mock('@/components/Folder', () => ({ default: () => null }));
vi.mock('@/components/Session', () => ({ default: () => null }));
vi.mock('@/components/Session/SidePanel/components/SessionGroup', () => ({
  default: () => null,
}));
vi.mock(
  '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer',
  () => ({ PreviewBrowserLayer: () => null })
);
vi.mock('@/components/SpaceSidebar', () => ({ default: () => null }));
vi.mock('@/components/Workspace', () => ({ default: () => null }));
vi.mock('@/components/Trigger', () => ({
  default: ({ isDialogOpen }: { isDialogOpen: boolean }) => (
    <div
      data-testid="automations-panel"
      data-dialog-open={String(isDialogOpen)}
    />
  ),
}));

describe('Workspace Automations tab without a selected Session', () => {
  beforeEach(() => {
    mocks.projectStore.activeProjectId = null;
    mocks.projectStore.setActiveProject.mockReset();
    mocks.spaceState.activeSpaceId = 'space-1';
    mocks.spaceState.projectsBySpaceId = {};
    mocks.spaceState.lastVisitedProjectBySpace = {};
    usePageTabStore.setState({
      activeWorkspaceTab: 'triggers',
      triggerAddDialogRequestId: 0,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('selects the last visited Session of the Space', () => {
    mocks.spaceState.projectsBySpaceId = {
      'space-1': [
        { id: 'project-1', spaceId: 'space-1', name: 'First' },
        { id: 'project-2', spaceId: 'space-1', name: 'Second' },
      ],
    };
    mocks.spaceState.lastVisitedProjectBySpace = { 'space-1': 'project-2' };

    render(<WorkspacePage />);

    expect(mocks.projectStore.setActiveProject).toHaveBeenCalledWith(
      'project-2'
    );
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('triggers');
  });

  it('returns to the Space workspace when the Space has no Sessions', () => {
    render(<WorkspacePage />);

    expect(mocks.projectStore.setActiveProject).not.toHaveBeenCalled();
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('workforce');
  });

  it('does not reopen a bounced add request once the Space has a Session', async () => {
    usePageTabStore.setState({ activeWorkspaceTab: 'workforce' });
    const { getByTestId } = render(<WorkspacePage />);

    // Adding an automation in a Space with no Sessions returns to the Space
    // workspace instead of opening the Automations tab.
    act(() => {
      usePageTabStore.getState().requestOpenTriggerAddDialog();
    });
    await act(async () => {});
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('workforce');

    // Later, with a Session selected, opening Automations must not pop up
    // the stale add dialog.
    mocks.projectStore.activeProjectId = 'project-1';
    mocks.spaceState.projectsBySpaceId = {
      'space-1': [{ id: 'project-1', spaceId: 'space-1', name: 'First' }],
    };
    act(() => {
      usePageTabStore.getState().setActiveWorkspaceTab('triggers');
    });
    await act(async () => {});

    expect(getByTestId('automations-panel')).toHaveAttribute(
      'data-dialog-open',
      'false'
    );
  });

  it('opens the add dialog when the Space has a Session', async () => {
    mocks.projectStore.activeProjectId = 'project-1';
    mocks.spaceState.projectsBySpaceId = {
      'space-1': [{ id: 'project-1', spaceId: 'space-1', name: 'First' }],
    };
    usePageTabStore.setState({ activeWorkspaceTab: 'workforce' });
    const { getByTestId } = render(<WorkspacePage />);

    act(() => {
      usePageTabStore.getState().requestOpenTriggerAddDialog();
    });
    await act(async () => {});

    expect(getByTestId('automations-panel')).toHaveAttribute(
      'data-dialog-open',
      'true'
    );
  });

  it('keeps the Session that is already selected', async () => {
    mocks.projectStore.activeProjectId = 'project-1';
    mocks.spaceState.projectsBySpaceId = {
      'space-1': [{ id: 'project-1', spaceId: 'space-1', name: 'First' }],
    };

    const { getByTestId } = render(<WorkspacePage />);
    await act(async () => {});

    expect(getByTestId('automations-panel')).toBeInTheDocument();
    expect(mocks.projectStore.setActiveProject).not.toHaveBeenCalled();
    expect(usePageTabStore.getState().activeWorkspaceTab).toBe('triggers');
  });
});
