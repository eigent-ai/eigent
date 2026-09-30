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
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const auth = { email: 'alex@example.com', user_id: 42 };
  const task = { id: 1, task_id: 'task_a', project_id: 'session-a' };
  const project = {
    project_id: 'session-a',
    space_id: 'space-a',
    project_name: 'Example',
    tasks: [task],
  };
  const meta = {
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
    runtime: { removeProject: vi.fn() },
    invoke: vi.fn(),
    toastError: vi.fn(),
  };
});
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
  mocks.auth.user_id = 42;
  vi.mocked(proxyFetchGet).mockResolvedValue({
    project_id: 'session-a',
    tasks: [mocks.task],
  });
  vi.mocked(proxyFetchDelete).mockResolvedValue(undefined);
  mocks.invoke.mockResolvedValue({ success: true });
});

describe('Home Session deletion', () => {
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
});
