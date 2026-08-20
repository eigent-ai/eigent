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

import Tasks from '@/components/Home/Tasks';
import {
  HomeHubProvider,
  type HomeHubContextValue,
} from '@/components/Home/context';
import { ChatTaskStatus, type ChatTaskStatusType } from '@/types/constants';
import type { ProjectGroup } from '@/types/history';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const task = {
  id: 1,
  task_id: 'task-1',
  project_id: 'project-1',
  space_id: 'space-1',
  question: 'Prepare launch report',
  language: 'en',
  model_platform: 'openai',
  model_type: 'model',
  max_retries: 1,
  tokens: 12,
  status: 1,
};

const project: ProjectGroup = {
  project_id: 'project-1',
  space_id: 'space-1',
  project_name: 'Launch',
  total_tokens: 12,
  task_count: 1,
  total_triggers: 0,
  latest_task_date: '2026-08-19T00:00:00Z',
  last_prompt: task.question,
  tasks: [task],
  total_completed_tasks: 0,
  total_ongoing_tasks: 1,
  average_tokens_per_task: 12,
};

function TasksHarness({
  initialStatus,
  presentation = 'home',
  pauseRequest = async () => {},
  resumeRequest = async () => {},
}: {
  initialStatus: ChatTaskStatusType;
  presentation?: 'home' | 'space-detail';
  pauseRequest?: (taskId: string, projectId: string) => Promise<void>;
  resumeRequest?: (taskId: string, projectId: string) => Promise<void>;
}) {
  const [status, setStatus] = useState(initialStatus);
  const value = useMemo<HomeHubContextValue>(
    () => ({
      sectionCounts: { spaces: 1, projects: 1, tasks: 1, triggers: 0 },
      viewMode: 'grid',
      setViewMode: vi.fn(),
      searchQuery: '',
      setSearchQuery: vi.fn(),
      sortBy: 'created',
      setSortBy: vi.fn(),
      sortDirection: 'desc',
      setSortDirection: vi.fn(),
      projects: [project],
      projectsLoading: false,
      triggers: [],
      triggersLoading: false,
      reloadTriggers: async () => {},
      chatTasks: {
        [task.task_id]: { status },
      } as HomeHubContextValue['chatTasks'],
      onTaskDelete: vi.fn(),
      onTaskShare: vi.fn(),
      onProjectDelete: vi.fn(),
      onProjectRename: vi.fn(),
      onOngoingTaskPause: async (taskId, projectId) => {
        await pauseRequest(taskId, projectId);
        setStatus(ChatTaskStatus.PAUSE);
      },
      onOngoingTaskResume: async (taskId, projectId) => {
        await resumeRequest(taskId, projectId);
        setStatus(ChatTaskStatus.RUNNING);
      },
    }),
    [pauseRequest, resumeRequest, status]
  );

  return (
    <MemoryRouter>
      <HomeHubProvider value={value}>
        <Tasks
          presentation={presentation}
          projectsOverride={
            presentation === 'space-detail' ? [project] : undefined
          }
        />
      </HomeHubProvider>
    </MemoryRouter>
  );
}

describe('Home Tasks runtime controls', () => {
  it('pauses an ongoing task once, disables duplicate requests, then resumes it', async () => {
    const user = userEvent.setup();
    let resolvePause!: () => void;
    const pauseRequest = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePause = resolve;
        })
    );
    const resumeRequest = vi.fn().mockResolvedValue(undefined);
    render(
      <TasksHarness
        initialStatus={ChatTaskStatus.RUNNING}
        pauseRequest={pauseRequest}
        resumeRequest={resumeRequest}
      />
    );

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Pause' }));
    expect(pauseRequest).toHaveBeenCalledWith('task-1', 'project-1');

    const pendingPause = await screen.findByRole('menuitem', { name: 'Pause' });
    expect(pendingPause).toHaveAttribute('data-disabled');
    await user.click(pendingPause);
    expect(pauseRequest).toHaveBeenCalledTimes(1);

    await act(async () => resolvePause());
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Resume' })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole('menuitem', { name: 'Resume' }));
    expect(resumeRequest).toHaveBeenCalledWith('task-1', 'project-1');
  });

  it('provides the same Resume action in the Space detail Tasks list', async () => {
    const user = userEvent.setup();
    const resumeRequest = vi.fn().mockResolvedValue(undefined);
    render(
      <TasksHarness
        initialStatus={ChatTaskStatus.PAUSE}
        presentation="space-detail"
        resumeRequest={resumeRequest}
      />
    );

    const row = screen.getByText(task.question).closest('[role="button"]');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);
    await user.click(await screen.findByRole('menuitem', { name: 'Resume' }));
    expect(resumeRequest).toHaveBeenCalledWith('task-1', 'project-1');
  });

  it('does not expose pause or resume for a completed task', async () => {
    const user = userEvent.setup();
    render(<TasksHarness initialStatus={ChatTaskStatus.FINISHED} />);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).toBeNull();
  });
});
