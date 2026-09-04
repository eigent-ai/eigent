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
import userEvent, {
  PointerEventsCheckLevel,
} from '@testing-library/user-event';
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

const setupUser = () =>
  userEvent.setup({
    // These behavior tests do not assert CSS hit-testing. Skipping it avoids
    // expensive full-style traversal in GitHub's jsdom runner.
    pointerEventsCheck: PointerEventsCheckLevel.Never,
  });

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
    const mark = (step: string) =>
      console.info(`[ci-timing][home-pause] ${step}`);
    const user = setupUser();
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
    mark('rendered');

    const moreActions = screen.getByRole('button', { name: 'More actions' });
    mark('queried trigger');
    await user.click(moreActions);
    mark('clicked trigger');
    const pauseItem = await screen.findByRole('menuitem', { name: 'Pause' });
    mark('queried pause');
    await user.click(pauseItem);
    mark('clicked pause');
    expect(pauseRequest).toHaveBeenCalledWith('task-1', 'project-1');

    const pendingPause = await screen.findByRole('menuitem', { name: 'Pause' });
    mark('queried pending pause');
    expect(pendingPause).toHaveAttribute('data-disabled');
    await user.click(pendingPause);
    mark('clicked pending pause');
    expect(pauseRequest).toHaveBeenCalledTimes(1);

    await act(async () => resolvePause());
    mark('resolved pause');
    await waitFor(() =>
      expect(
        screen.getByRole('menuitem', { name: 'Resume' })
      ).toBeInTheDocument()
    );
    await user.click(screen.getByRole('menuitem', { name: 'Resume' }));
    mark('clicked resume');
    expect(resumeRequest).toHaveBeenCalledWith('task-1', 'project-1');
  });

  it('provides the same Resume action in the Space detail Tasks list', async () => {
    const mark = (step: string) =>
      console.info(`[ci-timing][space-resume] ${step}`);
    const user = setupUser();
    const resumeRequest = vi.fn().mockResolvedValue(undefined);
    render(
      <TasksHarness
        initialStatus={ChatTaskStatus.PAUSE}
        presentation="space-detail"
        resumeRequest={resumeRequest}
      />
    );
    mark('rendered');

    const row = screen.getByText(task.question).closest('[role="row"]');
    mark('queried row');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);
    mark('opened context menu');
    const resumeItem = await screen.findByRole('menuitem', { name: 'Resume' });
    mark('queried resume');
    await user.click(resumeItem);
    mark('clicked resume');
    expect(resumeRequest).toHaveBeenCalledWith('task-1', 'project-1');
  });

  it('does not expose pause or resume for a completed task', async () => {
    const mark = (step: string) =>
      console.info(`[ci-timing][completed-task] ${step}`);
    const user = setupUser();
    render(<TasksHarness initialStatus={ChatTaskStatus.FINISHED} />);
    mark('rendered');

    const moreActions = screen.getByRole('button', { name: 'More actions' });
    mark('queried trigger');
    await user.click(moreActions);
    mark('clicked trigger');
    expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).toBeNull();
  });
});
