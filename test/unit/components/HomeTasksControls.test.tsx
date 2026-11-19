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
import { fireEvent, render, screen } from '@testing-library/react';
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

function openDropdown(trigger: HTMLElement) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    ctrlKey: false,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(trigger, event);
}

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
  it('pauses an ongoing task once and disables duplicate requests', () => {
    const pauseRequest = vi.fn(
      () =>
        new Promise<void>(() => {
          // Keep the request pending so duplicate-action behavior is stable.
        })
    );
    const { unmount } = render(
      <TasksHarness
        initialStatus={ChatTaskStatus.RUNNING}
        pauseRequest={pauseRequest}
      />
    );

    const moreActions = screen.getByRole('button', { name: 'More actions' });
    openDropdown(moreActions);
    const pauseItem = screen.getByRole('menuitem', { name: 'Pause' });
    fireEvent.click(pauseItem);
    expect(pauseRequest).toHaveBeenCalledWith('task-1', 'project-1');

    const pendingPause = screen.getByRole('menuitem', { name: 'Pause' });
    expect(pendingPause).toHaveAttribute('data-disabled');
    fireEvent.click(pendingPause);
    expect(pauseRequest).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('provides the same Resume action in the Space detail Tasks list', () => {
    const resumeRequest = vi.fn(
      () =>
        new Promise<void>(() => {
          // Invocation is the behavior under test; completion is irrelevant.
        })
    );
    const { unmount } = render(
      <TasksHarness
        initialStatus={ChatTaskStatus.PAUSE}
        presentation="space-detail"
        resumeRequest={resumeRequest}
      />
    );

    const row = screen.getByText(task.question).closest('[role="row"]');
    expect(row).not.toBeNull();
    fireEvent.contextMenu(row!);
    const resumeItem = screen.getByRole('menuitem', { name: 'Resume' });
    fireEvent.click(resumeItem);
    expect(resumeRequest).toHaveBeenCalledWith('task-1', 'project-1');
    unmount();
  });

  it('does not expose pause or resume for a completed task', () => {
    const { unmount } = render(
      <TasksHarness initialStatus={ChatTaskStatus.FINISHED} />
    );

    const moreActions = screen.getByRole('button', { name: 'More actions' });
    openDropdown(moreActions);
    expect(screen.queryByRole('menuitem', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Resume' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    unmount();
  });
});
