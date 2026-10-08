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

import Projects from '@/components/Home/Projects';
import Tasks from '@/components/Home/Tasks';
import {
  HomeHubProvider,
  type HomeHubContextValue,
} from '@/components/Home/context';
import type { HistoryTask, ProjectGroup } from '@/types/history';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

function session(
  projectId: string,
  projectName: string,
  tasks: HistoryTask[] = []
): ProjectGroup {
  return {
    project_id: projectId,
    space_id: 'space-1',
    project_name: projectName,
    total_tokens: 0,
    task_count: tasks.length,
    total_triggers: 0,
    latest_task_date: '2026-10-01T00:00:00Z',
    last_prompt: '',
    tasks,
    total_completed_tasks: 0,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 0,
  };
}

const task = {
  id: 1,
  task_id: 'task-1',
  project_id: 'session-default',
  space_id: 'space-1',
  question: 'Draft the launch note',
  language: 'en',
  model_platform: 'openai',
  model_type: 'model',
  max_retries: 1,
  tokens: 0,
  status: 2,
} as HistoryTask;

const defaultSession = session('session-default', 'new project');
const namedSession = session('session-named', 'Launch plan');

function renderWithHub(
  children: ReactNode,
  overrides: Partial<HomeHubContextValue> = {}
) {
  const value: HomeHubContextValue = {
    sectionCounts: { spaces: 1, projects: 2, tasks: 0, triggers: 0 },
    viewMode: 'list',
    setViewMode: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    sortBy: 'created',
    setSortBy: vi.fn(),
    sortDirection: 'desc',
    setSortDirection: vi.fn(),
    openNewSpaceDialog: vi.fn(),
    projects: [defaultSession, namedSession],
    projectsLoading: false,
    triggers: [],
    triggersLoading: false,
    reloadTriggers: async () => {},
    onTaskDelete: vi.fn(),
    onTaskShare: vi.fn(),
    onProjectDelete: vi.fn(),
    onProjectRename: vi.fn(),
    ...overrides,
  };

  return render(
    <MemoryRouter>
      <HomeHubProvider value={value}>{children}</HomeHubProvider>
    </MemoryRouter>
  );
}

describe('Home Session names', () => {
  it('labels a Session with the system default name as New session in Space detail', () => {
    renderWithHub(
      <Projects
        presentation="space-detail"
        projectsOverride={[defaultSession, namedSession]}
      />
    );

    const table = screen.getByRole('table', { name: 'Sessions' });
    expect(
      within(table).getByRole('button', { name: 'New session' })
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('button', { name: 'Launch plan' })
    ).toBeInTheDocument();
    expect(within(table).queryByText(/new project/i)).not.toBeInTheDocument();
  });

  it('matches the visible New session label when searching Sessions', () => {
    renderWithHub(<Projects />, { searchQuery: 'new session' });

    const table = screen.getByRole('table', { name: 'Sessions' });
    expect(
      within(table).getByRole('button', { name: 'New session' })
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole('button', { name: 'Launch plan' })
    ).not.toBeInTheDocument();
  });

  it('shows New session as the Session of a Task in a default-named Session', () => {
    const sessionWithTask = session('session-default', 'new project', [task]);
    renderWithHub(<Tasks />, {
      viewMode: 'grid',
      projects: [sessionWithTask],
    });

    expect(screen.getByText('Draft the launch note')).toBeInTheDocument();
    expect(screen.getByText('New session')).toBeInTheDocument();
    expect(screen.queryByText(/new project/i)).not.toBeInTheDocument();
  });
});
