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

import SpaceSidebar from '@/components/SpaceSidebar';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const auth = { email: 'alex@example.com', user_id: 42 };
  const meta = {
    id: 'session-a',
    spaceId: 'space-a',
    name: 'Example',
    workdirMode: 'copy',
  };
  const space = {
    activeSpaceId: 'space-a',
    spaces: {},
    projectsBySpaceId: { 'space-a': [meta] },
    getProjectMeta: () => meta,
    getProjectsForSpace: vi.fn((): (typeof meta)[] => []),
    lastVisitedProjectBySpace: {} as Record<string, string>,
  };
  const runtime = {
    activeProjectId: null as string | null,
    navLeadByProjectId: {},
    historyLoadingProjectIds: {},
    peekActiveChatStore: () => ({
      getState: () => ({ tasks: { task_local: {} } }),
    }),
    removeProject: vi.fn(),
  };
  const page = {
    activeWorkspaceTab: 'project',
    setActiveWorkspaceTab: vi.fn(),
    requestWorkspaceChatFocus: vi.fn(),
    requestOpenTriggerAddDialog: vi.fn(),
    unviewedTabs: new Set(),
    filesUnviewedForProjects: new Set(),
  };
  return {
    auth,
    meta,
    space,
    runtime,
    page,
    invoke: vi.fn(),
    archive: vi.fn(),
    stop: vi.fn(),
    SessionStopError: class SessionStopError extends Error {},
    workdir: vi.fn(),
    deleteWorkdir: vi.fn(),
    overlays: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
});
vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchPut: vi.fn(),
  proxyFetchGet: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));
vi.mock('@/host', () => ({
  useHost: () => ({
    ipcRenderer: { invoke: mocks.invoke, on: () => {}, off: () => {} },
  }),
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => mocks.auth,
  useAuthStore: Object.assign((selector: any) => selector(mocks.auth), {
    getState: () => mocks.auth,
    subscribe: () => () => {},
  }),
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: Object.assign((selector: any) => selector(mocks.space), {
    getState: () => mocks.space,
    subscribe: () => () => {},
  }),
  getVisibleProjectMetasForSpace: () => [mocks.space.getProjectMeta()],
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector?: any) =>
    selector ? selector(mocks.runtime) : mocks.runtime,
}));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: any) => selector(mocks.page),
}));
vi.mock('@/store/triggerStore', () => ({
  useTriggerStore: (selector: any) =>
    selector({ wsConnectionStatus: 'connected' }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (selector: any) => selector({ closeSettings: vi.fn() }),
}));
vi.mock('@/store/sessionExecutionStore', () => ({
  readSessionExecutionRoute: vi.fn(),
}));
vi.mock('@/service/executionApi', () => ({ executionScope: vi.fn() }));
vi.mock('@/service/spaceApi', () => ({
  proxyUpdateSpaceProject: mocks.archive,
  proxyFetchSpaceProjectOverlays: mocks.overlays,
}));
vi.mock('@/service/workspaceApi', () => ({
  fetchWorkspaceProjectWorkdir: mocks.workdir,
  deleteWorkspaceProjectWorkdir: mocks.deleteWorkdir,
}));
vi.mock('@/lib/sessionStop', () => ({
  stopSessionAndWait: mocks.stop,
  SessionStopError: mocks.SessionStopError,
}));
vi.mock('@/lib/projectAchievement', () => ({
  isProjectAchieved: () => false,
  setProjectAchievedState: vi.fn(),
}));
vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: vi.fn(),
}));
vi.mock('@/lib/scratchSpaceWorkspace', () => ({
  ensureScratchSpaceWorkspaceBinding: vi.fn(),
}));
vi.mock('@/lib/spaceLabel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/spaceLabel')>()),
  getFilesTabBindingLabel: () => null,
  isUnboundUntitledSpace: () => false,
}));
vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: vi.fn(),
}));
vi.mock('@/components/GlobalSearch', () => ({
  GlobalSearchDialog: () => null,
}));
vi.mock('@/components/Layout/AppCommandProvider', () => ({
  useAppCommand: () => vi.fn(),
}));
vi.mock('@/components/ui/shortcut-tooltip', () => ({
  ShortcutTooltipContent: () => null,
}));
vi.mock('@/components/SpaceSidebar/TriggerNavTab', () => ({
  NavTabReconnectSuffix: () => null,
  triggerListenerLeadIconClass: () => '',
}));
vi.mock('@/components/Layout/AppSidebar', () => {
  const Container = ({ children }: any) => <div>{children}</div>;
  return {
    SidebarShell: Container,
    SidebarSection: Container,
    SidebarNavGroup: Container,
    SidebarSeparator: () => null,
    NavTab: ({ label, ariaLabel, onClick, endAction, disabled }: any) => (
      <div>
        <button
          type="button"
          aria-label={ariaLabel ?? label}
          onClick={onClick}
          disabled={disabled}
        >
          {label}
        </button>
        {endAction}
      </div>
    ),
  };
});
vi.mock('@/components/SpaceSidebar/SessionNavList', () => ({
  SessionNavList: ({ onDeleteSession }: any) => (
    <button onClick={() => onDeleteSession('session-a')}>
      Delete selected session
    </button>
  ),
}));
vi.mock('sonner', () => ({
  toast: { error: mocks.error, success: mocks.success },
}));

function renderSidebar() {
  render(
    <MemoryRouter>
      <SpaceSidebar chatStore={null} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.activeProjectId = null;
  mocks.space.getProjectsForSpace.mockReturnValue([]);
});

describe('Sidebar Automations entry', () => {
  it('asks for a Session instead of opening Automations in a Space without one', () => {
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Automations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }));

    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledWith('Select a session');
    expect(mocks.page.setActiveWorkspaceTab).not.toHaveBeenCalledWith(
      'triggers'
    );
    expect(mocks.page.requestOpenTriggerAddDialog).not.toHaveBeenCalled();
  });

  it('opens Automations when the Space has a Session but none is selected', () => {
    mocks.space.getProjectsForSpace.mockReturnValue([mocks.meta]);
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Automations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add automation' }));

    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.page.setActiveWorkspaceTab).toHaveBeenCalledWith('triggers');
    expect(mocks.page.requestOpenTriggerAddDialog).toHaveBeenCalledOnce();
  });

  it('opens Automations for the selected Session', () => {
    mocks.runtime.activeProjectId = 'session-a';
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Automations' }));

    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.page.setActiveWorkspaceTab).toHaveBeenCalledWith('triggers');
  });
});
