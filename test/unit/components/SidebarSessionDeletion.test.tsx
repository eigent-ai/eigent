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

import { fetchDelete, proxyFetchDelete, proxyFetchGet } from '@/api/http';
import SpaceSidebar from '@/components/SpaceSidebar';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
  };
  const runtime = {
    activeProjectId: 'session-a',
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
vi.mock('@/lib/spaceLabel', () => ({
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
    NavTab: () => null,
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

async function openDialog() {
  render(
    <MemoryRouter>
      <SpaceSidebar chatStore={null} />
    </MemoryRouter>
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete selected session' })
  );
  return screen.getByRole('alertdialog', { name: 'Delete session' });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user_id = 42;
  mocks.meta.workdirMode = 'copy';
  mocks.invoke.mockResolvedValue({ success: true });
  mocks.stop.mockResolvedValue(undefined);
  mocks.workdir.mockResolvedValue({ exists: true });
  mocks.deleteWorkdir.mockResolvedValue({ deleted: true });
  mocks.overlays.mockResolvedValue({ overlays: [] });
  vi.mocked(proxyFetchGet).mockResolvedValue({
    project_id: 'session-a',
    space_id: 'space-a',
    tasks: [{ id: 1, task_id: 'task_server', project_id: 'session-a' }],
  });
});

describe('Sidebar Session deletion', () => {
  it('does not remove or archive the Session on cleanup failure and succeeds on Retry', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: false });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const retry = await within(dialog).findByRole('button', { name: 'Retry' });
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(fetchDelete).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(dialog).toHaveAccessibleDescription(/could not be completed/);
    fireEvent.click(retry);
    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'delete-task-files',
      'alex@example.com',
      'task_local',
      'session-a',
      42,
      'space-a'
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'delete-task-files',
      'alex@example.com',
      'task_server',
      'session-a',
      42,
      'space-a'
    );
    expect(mocks.archive).toHaveBeenCalledWith('space-a', 'session-a', {
      status: 'archived',
    });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
  });

  it('blocks a stale confirmation after switching accounts', async () => {
    const dialog = await openDialog();
    mocks.auth.user_id = 99;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByRole('button', { name: 'Retry' });
    expect(proxyFetchGet).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();
  });

  it('does not auto-close while a cleanup is pending', async () => {
    let finish!: (result: unknown) => void;
    mocks.invoke.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    expect(
      within(dialog).getByRole('button', { name: 'Deleting...' })
    ).toBeDisabled();
    expect(dialog).toBeInTheDocument();
    await act(async () => {
      finish({ success: true });
    });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
  });

  it('stops the Session and waits before any cleanup starts', async () => {
    let stopped!: () => void;
    mocks.stop.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        stopped = resolve;
      })
    );
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const stopping = await within(dialog).findByRole('button', {
      name: 'Stopping…',
    });
    expect(stopping).toBeDisabled();
    expect(mocks.stop).toHaveBeenCalledWith('session-a');
    expect(proxyFetchGet).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();

    await act(async () => stopped());
    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
    expect(mocks.stop.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder[0]
    );
  });

  it('touches nothing when the Session cannot be stopped and offers Retry', async () => {
    mocks.stop.mockRejectedValueOnce(new mocks.SessionStopError('timeout'));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const retry = await within(dialog).findByRole('button', { name: 'Retry' });
    expect(dialog).toHaveAccessibleDescription(/couldn't be stopped/);
    expect(proxyFetchGet).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.deleteWorkdir).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
  });

  it('keeps the Session workdir unless the option is checked', async () => {
    const dialog = await openDialog();
    const option = await within(dialog).findByRole('checkbox', {
      name: 'Also delete the session working directory',
    });
    expect(option).not.toBeChecked();
    expect(dialog).toHaveTextContent(/permanently deleted/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
    expect(mocks.deleteWorkdir).not.toHaveBeenCalled();
  });

  it('deletes the workdir through Brain before history when checked', async () => {
    const dialog = await openDialog();
    fireEvent.click(
      await within(dialog).findByRole('checkbox', {
        name: 'Also delete the session working directory',
      })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
    expect(mocks.deleteWorkdir).toHaveBeenCalledWith(
      'space-a',
      'session-a',
      'alex@example.com',
      42
    );
    expect(mocks.deleteWorkdir.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(proxyFetchDelete).mock.invocationCallOrder[0]
    );
  });

  it('keeps history and the Session when the workdir deletion fails', async () => {
    mocks.deleteWorkdir.mockRejectedValueOnce(new Error('project_running'));
    const dialog = await openDialog();
    fireEvent.click(
      await within(dialog).findByRole('checkbox', {
        name: 'Also delete the session working directory',
      })
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await within(dialog).findByRole('button', { name: 'Retry' });
    expect(proxyFetchDelete).not.toHaveBeenCalled();
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();
  });

  it('warns more strongly when the workdir has unpublished changes', async () => {
    mocks.overlays.mockResolvedValue({ overlays: [{ path: 'draft.txt' }] });
    const dialog = await openDialog();

    expect(
      await within(dialog).findByText(/has unpublished changes/)
    ).toBeInTheDocument();
  });

  it.each([
    ['a direct-write Session', 'direct-write', { exists: true }],
    ['a missing workdir', 'copy', { exists: false }],
  ])('offers no workdir option for %s', async (_case, mode, workdir) => {
    mocks.meta.workdirMode = mode;
    mocks.workdir.mockResolvedValue(workdir);
    const dialog = await openDialog();

    await act(async () => {});
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    if (mode === 'direct-write') expect(mocks.workdir).not.toHaveBeenCalled();
  });
});
