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

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchAvailability: vi.fn(),
  save: vi.fn(),
  revealHarborTask: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/service/workspaceGitApi', () => ({
  fetchRunHarborTaskAvailability: mocks.fetchAvailability,
  saveRunHarborTask: mocks.save,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ email: 'user@example.com', user_id: 7 }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({
      getProjectMeta: (projectId: string) =>
        projectId === 'project-1' ? { spaceId: 'space-1' } : undefined,
    }),
}));

vi.mock('@/host', () => ({
  useHost: () => ({
    electronAPI: {
      getPlatform: () => 'darwin',
      revealHarborTask: mocks.revealHarborTask,
    },
  }),
}));

import {
  resetHarborTaskAvailabilityCache,
  SaveAsHarborTaskButton,
} from '@/components/ChatBox/MessageItem/SaveAsHarborTaskButton';

const LABEL = 'Save as Harbor task';

describe('SaveAsHarborTaskButton', () => {
  beforeEach(() => {
    resetHarborTaskAvailabilityCache();
    mocks.fetchAvailability.mockResolvedValue({
      run_id: 'run-1',
      available: true,
      reason: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('stays hidden and asks nothing until the Task completes', () => {
    render(
      <SaveAsHarborTaskButton
        runId="run-1"
        projectId="project-1"
        completed={false}
      />
    );

    expect(screen.queryByLabelText(LABEL)).toBeNull();
    expect(mocks.fetchAvailability).not.toHaveBeenCalled();
  });

  it('stays hidden when the Task changed no files', async () => {
    mocks.fetchAvailability.mockResolvedValue({
      run_id: 'run-1',
      available: false,
      reason: 'run_changed_no_files',
    });

    render(
      <SaveAsHarborTaskButton runId="run-1" projectId="project-1" completed />
    );

    await waitFor(() =>
      expect(mocks.fetchAvailability).toHaveBeenCalledWith('run-1')
    );
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  it('saves the Task and offers to show the folder', async () => {
    mocks.save.mockResolvedValue({
      run_id: 'run-1',
      name: 'eigent/task-run-1',
      path: '/Users/me/Downloads/eigent-harbor-tasks/task-run-1',
      notes: [],
    });

    render(
      <SaveAsHarborTaskButton runId="run-1" projectId="project-1" completed />
    );
    fireEvent.click(await screen.findByLabelText(LABEL));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(mocks.save).toHaveBeenCalledWith('run-1', 'space-1', {
      email: 'user@example.com',
      userId: 7,
    });
    const [title, options] = mocks.toastSuccess.mock.calls[0];
    expect(title).toBe('Saved as Harbor task');
    expect(options.description).toBe(
      '/Users/me/Downloads/eigent-harbor-tasks/task-run-1'
    );
    expect(options.action.label).toBe('Show in Finder');
    options.action.onClick();
    expect(mocks.revealHarborTask).toHaveBeenCalledWith(
      '/Users/me/Downloads/eigent-harbor-tasks/task-run-1'
    );
  });

  it('explains a workspace it cannot save', async () => {
    mocks.save.mockRejectedValue({
      response: { data: { detail: { code: 'unsupported_file_type' } } },
    });

    render(
      <SaveAsHarborTaskButton runId="run-1" projectId="project-1" completed />
    );
    fireEvent.click(await screen.findByLabelText(LABEL));

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Couldn't save as Harbor task",
        {
          description:
            "The workspace has symbolic links or submodules, which aren't supported yet.",
        }
      )
    );
    expect(screen.getByLabelText(LABEL)).toBeEnabled();
  });

  it('checks again while a just-completed Task settles', async () => {
    vi.useFakeTimers();
    mocks.fetchAvailability
      .mockResolvedValueOnce({
        run_id: 'run-1',
        available: false,
        reason: 'run_git_not_finalized',
      })
      .mockResolvedValueOnce({
        run_id: 'run-1',
        available: true,
        reason: null,
      });

    render(
      <SaveAsHarborTaskButton runId="run-1" projectId="project-1" completed />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(mocks.fetchAvailability).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(LABEL)).toBeInTheDocument();
  });
});
