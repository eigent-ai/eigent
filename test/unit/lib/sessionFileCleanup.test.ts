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
import { deleteSessionTaskData } from '@/lib/sessionFileCleanup';
import { deleteWorkspaceProjectWorkdir } from '@/service/workspaceApi';
import { app } from 'electron';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileReader } from '../../../electron/main/fileReader';

const auth = vi.hoisted(() => ({ email: 'alex@example.com', user_id: 42 }));
vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => auth }));
vi.mock('@/service/workspaceApi', () => ({
  deleteWorkspaceProjectWorkdir: vi.fn(),
}));
vi.mock('electron', () => ({ app: { getPath: vi.fn() } }));

const tasks = [
  { id: 1, task_id: 'task_a', project_id: 'session-a' },
  { id: 2, task_id: 'task_b', project_id: 'session-a' },
];
const input = {
  projectId: 'session-a',
  spaceId: 'space-a',
  email: 'alex@example.com',
  userId: 42,
};
let home: string;
let reader: FileReader;
const invoke = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  auth.email = input.email;
  auth.user_id = 42;
  home = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), 'eigent-session-delete-'))
  );
  vi.mocked(app.getPath).mockReturnValue(home);
  reader = new FileReader(null as never);
  vi.mocked(proxyFetchGet).mockResolvedValue({
    project_id: 'session-a',
    tasks,
  });
  vi.mocked(proxyFetchDelete).mockResolvedValue(undefined);
  invoke.mockImplementation(
    async (_channel, email, taskId, projectId, userId, spaceId) =>
      reader.deleteTaskFiles(email, taskId, projectId, userId, spaceId)
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});
function run() {
  return deleteSessionTaskData({ ...input, ipcRenderer: { invoke } });
}
function fixture(root: string, taskId = 'task_a') {
  const dir = path.join(home, root, 'user_42/project_session-a', taskId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'output');
  return dir;
}

describe('Session deletion orchestration', () => {
  it('passes exact user/Session/Space identity and cleans all files before deleting history', async () => {
    const dirs = [
      fixture('eigent'),
      fixture('.eigent'),
      fixture('eigent', 'task_b'),
    ];
    vi.mocked(proxyFetchDelete).mockImplementation(async () => {
      dirs.forEach((dir) => expect(fs.existsSync(dir)).toBe(false));
    });
    await run();
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'delete-task-files',
      input.email,
      'task_a',
      'session-a',
      42,
      'space-a'
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'delete-task-files',
      input.email,
      'task_b',
      'session-a',
      42,
      'space-a'
    );
    expect(proxyFetchDelete).toHaveBeenCalledTimes(2);
  });

  it('retains history on a real partial filesystem failure, then completes on retry', async () => {
    const output = fixture('eigent');
    const logs = fixture('.eigent');
    const remove = fs.rmSync;
    const failingRemove = vi
      .spyOn(fs, 'rmSync')
      .mockImplementation((target, options) => {
        if (String(target).includes('/.eigent/')) throw new Error('locked');
        remove(target, options);
      });
    await expect(run()).rejects.toThrow('file cleanup failed');
    expect(proxyFetchDelete).not.toHaveBeenCalled();
    expect(fs.existsSync(output)).toBe(false);
    expect(fs.existsSync(logs)).toBe(true);
    failingRemove.mockRestore();
    await run();
    expect(fs.existsSync(logs)).toBe(false);
    expect(proxyFetchDelete).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, {}, { success: false }, { success: 'true' }])(
    'rejects incomplete/failed IPC response %j without deleting history',
    async (response) => {
      invoke.mockResolvedValue(response);
      await expect(run()).rejects.toThrow('file cleanup failed');
      expect(proxyFetchDelete).not.toHaveBeenCalled();
    }
  );

  it('keeps history if a later cleanup fails or IPC rejects', async () => {
    invoke
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('IPC disconnected'));
    await expect(run()).rejects.toThrow('IPC disconnected');
    expect(proxyFetchDelete).not.toHaveBeenCalled();
  });

  it('propagates history service failures and tolerates 404 on retry', async () => {
    vi.mocked(proxyFetchDelete)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ status: 503 });
    await expect(run()).rejects.toEqual({ status: 503 });
    vi.mocked(proxyFetchDelete)
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(undefined);
    await expect(run()).resolves.toBeUndefined();
  });

  it('does not mistake a failed history lookup for a Session with no files', async () => {
    vi.mocked(proxyFetchGet).mockRejectedValue({ status: 503 });
    await expect(run()).rejects.toEqual({ status: 503 });
    expect(invoke).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
  });

  it.each([
    { tasks: null },
    { tasks, project_id: 'another-session' },
    { tasks: [{ ...tasks[0], project_id: 'another-session' }] },
    { tasks: [{ id: 1 }] },
  ])('rejects malformed or cross-Session history %j', async (response) => {
    vi.mocked(proxyFetchGet).mockResolvedValue(response);
    await expect(run()).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
  });

  it('uses known local tasks when server history is already absent', async () => {
    const output = fixture('eigent');
    vi.mocked(proxyFetchGet).mockRejectedValue({ status: 404 });
    await deleteSessionTaskData({
      ...input,
      knownTasks: [{ task_id: 'task_a' }],
      ipcRenderer: { invoke },
    });
    expect(fs.existsSync(output)).toBe(false);
    expect(proxyFetchDelete).not.toHaveBeenCalled();
  });

  it('deduplicates history/local task IDs and accepts absent task files', async () => {
    await deleteSessionTaskData({
      ...input,
      knownTasks: tasks,
      ipcRenderer: { invoke },
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(proxyFetchDelete).toHaveBeenCalledTimes(2);
  });

  it('supports the web host without local IPC', async () => {
    await deleteSessionTaskData(input);
    expect(proxyFetchDelete).toHaveBeenCalledTimes(2);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses the authoritative Space when the caller only knows the Session', async () => {
    vi.mocked(proxyFetchGet).mockResolvedValue({ tasks, space_id: 'space-a' });
    await deleteSessionTaskData({
      ...input,
      spaceId: undefined,
      ipcRenderer: { invoke },
    });
    expect(invoke).toHaveBeenCalledWith(
      'delete-task-files',
      input.email,
      'task_a',
      'session-a',
      42,
      'space-a'
    );
  });

  it('rejects a conflicting Space before deleting anything', async () => {
    vi.mocked(proxyFetchGet).mockResolvedValue({ tasks, space_id: 'space-b' });
    await expect(run()).rejects.toThrow('another Space');
    expect(invoke).not.toHaveBeenCalled();
    expect(proxyFetchDelete).not.toHaveBeenCalled();
  });

  it.each(['before', 'history', 'cleanup'])(
    'stops if the account changes %s',
    async (when) => {
      if (when === 'before') auth.user_id = 99;
      if (when === 'history')
        vi.mocked(proxyFetchGet).mockImplementation(async () => {
          auth.user_id = 99;
          return { tasks };
        });
      if (when === 'cleanup')
        invoke.mockImplementation(async () => {
          auth.user_id = 99;
          return { success: true };
        });
      await expect(run()).rejects.toThrow('account changed');
      expect(proxyFetchDelete).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledTimes(when === 'cleanup' ? 1 : 0);
    }
  );

  it('deletes the Session workdir after local files and before history only on request', async () => {
    await run();
    expect(deleteWorkspaceProjectWorkdir).not.toHaveBeenCalled();

    await deleteSessionTaskData({
      ...input,
      deleteWorkdir: true,
      ipcRenderer: { invoke },
    });
    expect(deleteWorkspaceProjectWorkdir).toHaveBeenCalledWith(
      'space-a',
      'session-a',
      'alex@example.com',
      42
    );
    const workdirOrder = vi.mocked(deleteWorkspaceProjectWorkdir).mock
      .invocationCallOrder[0];
    expect(invoke.mock.invocationCallOrder.at(-1)).toBeLessThan(workdirOrder);
    expect(
      vi.mocked(proxyFetchDelete).mock.invocationCallOrder.at(-1)
    ).toBeGreaterThan(workdirOrder);
  });

  it('keeps history when the Session workdir cannot be deleted', async () => {
    vi.mocked(deleteWorkspaceProjectWorkdir).mockRejectedValue(
      Object.assign(new Error('workspace_workdir_unsafe'), { status: 409 })
    );
    await expect(
      deleteSessionTaskData({
        ...input,
        deleteWorkdir: true,
        ipcRenderer: { invoke },
      })
    ).rejects.toThrow('workspace_workdir_unsafe');
    expect(proxyFetchDelete).not.toHaveBeenCalled();
  });
});
