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

import { proxyFetchDelete, proxyFetchGet } from '@/api/http';
import HomeHubRoot from '@/components/Home';
import { useHomeHub } from '@/components/Home/context';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { app } from 'electron';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileReader } from '../../../electron/main/fileReader';

const mocks = vi.hoisted(() => {
  const auth = { email: 'alex@example.com', user_id: 42 };
  const task = { id: 1, task_id: 'task_a', project_id: 'session-a' };
  const project = {
    project_id: 'session-a',
    space_id: 'space-a',
    project_name: 'Example',
    tasks: [task],
  };
  const meta: Record<string, string> = {
    id: 'session-a',
    spaceId: 'space-a',
    name: 'Example',
    updatedAt: '2026-09-30T00:00:00Z',
  };
  const spaceState = {
    projectsBySpaceId: { 'space-a': [meta] },
    getProjectMeta: () => meta,
  };
  return {
    auth,
    task,
    project,
    spaceState,
    runtime: { removeProject: vi.fn(), peekActiveChatStore: vi.fn() },
    meta,
    invoke: vi.fn(),
    toastError: vi.fn(),
    stop: vi.fn(),
    SessionStopError: class SessionStopError extends Error {},
    workdir: vi.fn(),
    deleteWorkdir: vi.fn(),
  };
});
vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));
vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
  proxyFetchDelete: vi.fn(),
  proxyFetchPut: vi.fn(),
}));
vi.mock('@/host', () => ({
  useHost: () => ({ ipcRenderer: { invoke: mocks.invoke } }),
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => mocks.auth,
  useAuthStore: (selector: any) => selector(mocks.auth),
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: () => mocks.runtime,
}));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: { getState: () => mocks.runtime },
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: Object.assign((selector: any) => selector(mocks.spaceState), {
    getState: () => mocks.spaceState,
  }),
  getVisibleProjectMetasForSpace: () => [mocks.spaceState.getProjectMeta()],
}));
vi.mock('@/service/historyApi', () => ({
  fetchGroupedHistoryTasks: async (setter: any) => setter([mocks.project]),
}));
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({ chatStore: null }),
}));
vi.mock('@/components/Home/hooks/useHomeSection', () => ({
  useHomeSection: () => ({ section: 'projects' }),
}));
vi.mock('@/components/Home/hooks/useHomeHubTriggers', () => ({
  useHomeHubTriggers: () => ({
    triggers: [],
    triggersLoading: false,
    reloadTriggers: vi.fn(),
  }),
}));
vi.mock('@/components/Home/hooks/useHomeHubCounts', () => ({
  useHomeHubCounts: () => ({ projects: 1 }),
}));
vi.mock('@/components/Home/hooks/useNewSpaceCreation', () => ({
  useNewSpaceCreation: () => ({}),
}));
vi.mock('@/components/Home/NewSpaceDialog', () => ({ default: () => null }));
vi.mock('@/components/Home/HomeGreeting', () => ({ default: () => null }));
vi.mock('@/components/Home/HomeHeader', () => ({ default: () => null }));
vi.mock('@/components/Home/HomeSections', () => ({ default: () => null }));
vi.mock('@/components/Home/HomeSidebarNav', () => ({
  HomeSidebarNavGroup: () => null,
}));
vi.mock('@/lib/share', () => ({ share: vi.fn() }));
vi.mock('@/lib/sessionStop', () => ({
  stopSessionAndWait: mocks.stop,
  SessionStopError: mocks.SessionStopError,
}));
vi.mock('@/service/workspaceApi', () => ({
  fetchWorkspaceProjectWorkdir: mocks.workdir,
  deleteWorkspaceProjectWorkdir: mocks.deleteWorkdir,
}));
vi.mock('@/service/spaceApi', () => ({
  proxyFetchSpaceProjectOverlays: async () => ({ overlays: [] }),
}));
vi.mock('@/lib/taskRuntimeControl', () => ({ takeControlOfTask: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

function DeleteAction() {
  const { onProjectDelete } = useHomeHub();
  return (
    <button onClick={() => onProjectDelete('session-a')}>
      Delete selected session
    </button>
  );
}
async function openDialog() {
  render(
    <HomeHubRoot>
      <DeleteAction />
    </HomeHubRoot>
  );
  await act(async () => {});
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete selected session' })
  );
  return screen.getByRole('alertdialog', { name: 'Delete session' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runtime.peekActiveChatStore.mockReset();
  mocks.runtime.removeProject.mockReset();
  mocks.auth.user_id = 42;
  vi.mocked(proxyFetchGet).mockResolvedValue({
    project_id: 'session-a',
    tasks: [mocks.task],
  });
  vi.mocked(proxyFetchDelete).mockResolvedValue(undefined);
  mocks.invoke.mockResolvedValue({ success: true });
  delete mocks.meta.workdirMode;
  mocks.stop.mockResolvedValue(undefined);
  mocks.workdir.mockResolvedValue({ exists: true });
  mocks.deleteWorkdir.mockResolvedValue({ deleted: true });
});

describe('Home Session deletion', () => {
  it('cleans server-omitted local Tasks before removing the selected Session', async () => {
    const home = fs.realpathSync(
      fs.mkdtempSync(path.join(tmpdir(), 'eigent-home-session-delete-'))
    );
    try {
      vi.mocked(app.getPath).mockReturnValue(home);
      const reader = new FileReader(null as never);
      const taskFiles = (projectId: string, taskId: string) => [
        path.join(
          home,
          'eigent',
          'user_42',
          `project_${projectId}`,
          taskId,
          'output.txt'
        ),
        path.join(
          home,
          '.eigent',
          'user_42',
          `project_${projectId}`,
          taskId,
          'camel_logs',
          'log.json'
        ),
      ];
      const selectedFiles = [
        ...taskFiles('session-a', 'task_a'),
        ...taskFiles('session-a', 'task_local'),
      ];
      const otherSessionFiles = taskFiles('session-b', 'task_other');
      for (const file of [...selectedFiles, ...otherSessionFiles]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'keep until its Session is deleted');
      }
      mocks.invoke.mockImplementation(
        async (_channel, email, taskId, projectId, userId, spaceId) =>
          reader.deleteTaskFiles(email, taskId, projectId, userId, spaceId)
      );
      let remainingAtRemoval: string[] | undefined;
      mocks.runtime.removeProject.mockImplementation(() => {
        remainingAtRemoval = selectedFiles.filter((file) =>
          fs.existsSync(file)
        );
      });

      const dialog = await openDialog();
      // Read the selected Session's latest runtime Tasks when deletion is confirmed.
      mocks.runtime.peekActiveChatStore.mockImplementation((projectId) => ({
        getState: () => ({
          tasks:
            projectId === 'session-a'
              ? { task_a: {}, task_local: {} }
              : { task_other: {} },
        }),
      }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
      );

      expect(remainingAtRemoval).toEqual([]);
      expect(mocks.runtime.peekActiveChatStore).toHaveBeenCalledWith(
        'session-a'
      );
      expect(mocks.invoke).toHaveBeenCalledTimes(2);
      for (const taskId of ['task_a', 'task_local']) {
        expect(mocks.invoke).toHaveBeenCalledWith(
          'delete-task-files',
          'alex@example.com',
          taskId,
          'session-a',
          42,
          'space-a'
        );
      }
      expect(proxyFetchDelete).toHaveBeenCalledTimes(1);
      expect(proxyFetchDelete).toHaveBeenCalledWith('/api/v1/chat/history/1');
      otherSessionFiles.forEach((file) =>
        expect(fs.existsSync(file)).toBe(true)
      );
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps the dialog and Session on success:false and lets Retry finish deletion', async () => {
    mocks.invoke.mockResolvedValueOnce({ success: false });
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const retry = await within(dialog).findByRole('button', { name: 'Retry' });
    expect(dialog).toHaveAccessibleDescription(
      /Session deletion could not be completed/
    );
    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining('Retry')
    );
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'delete-task-files',
      'alex@example.com',
      'task_a',
      'session-a',
      42,
      'space-a'
    );
  });

  it('stays open while cleanup is pending and prevents duplicate confirmation/cancel', async () => {
    let finish!: (value: unknown) => void;
    mocks.invoke.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const dialog = await openDialog();
    const confirm = within(dialog).getByRole('button', { name: 'Delete' });
    fireEvent.click(confirm);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('Deleting...');
    fireEvent.click(confirm);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledOnce();
    await act(async () => {
      finish({ success: true });
    });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
  });

  it('allows cancel after failure without removing the Session', async () => {
    mocks.invoke.mockRejectedValue(new Error('IPC failed'));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByRole('button', { name: 'Retry' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    );
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();
  });

  it('stops the Session first and touches nothing when it cannot be stopped', async () => {
    mocks.stop.mockRejectedValueOnce(new mocks.SessionStopError('timeout'));
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await within(dialog).findByRole('button', { name: 'Retry' });
    expect(mocks.stop).toHaveBeenCalledWith('session-a');
    expect(dialog).toHaveAccessibleDescription(/couldn't be stopped/);
    expect(proxyFetchGet).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
    expect(mocks.runtime.removeProject).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(mocks.runtime.removeProject).toHaveBeenCalledWith('session-a')
    );
    expect(mocks.stop.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.invoke.mock.invocationCallOrder[0]
    );
  });

  it('deletes the copy workdir only when the option is checked', async () => {
    mocks.meta.workdirMode = 'copy';
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
  });
});
