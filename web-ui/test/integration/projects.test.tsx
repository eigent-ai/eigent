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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DispatchPage from '@web/pages/DispatchPage';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const fetchGroupedProjects = vi.fn();

vi.mock('@web/api/server', () => ({
  fetchGroupedProjects: (...args: unknown[]) => fetchGroupedProjects(...args),
}));

vi.mock('@web/hooks/useProjectDetail', () => ({
  useProjectDetail: () => ({
    project: {
      projectId: 'p1',
      name: 'Alpha',
      sessionCount: 1,
      totalTokens: 10,
      latestActivity: '2026-05-20T10:00:00Z',
      lastPrompt: 'Do work',
      ongoingCount: 0,
      completedCount: 1,
      sessions: [],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  createEmptyProject: vi.fn(),
}));

vi.mock('@web/hooks/useWebProjectTask', () => ({
  useWebProjectTask: () => ({ loading: false, error: null }),
}));

vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: {
      activeTaskId: 't1',
      tasks: { t1: { messages: [], hasMessages: false } },
    },
    projectStore: {},
  }),
}));

vi.mock('@/components/ChatBox', () => ({
  default: () => <div>Chat workspace</div>,
}));

describe('projects integration', () => {
  it('loads grouped projects and navigates on item click', async () => {
    fetchGroupedProjects.mockResolvedValue([
      {
        project_id: 'p1',
        project_name: 'Alpha',
        total_tokens: 10,
        task_count: 1,
        total_triggers: 0,
        latest_task_date: '2026-05-20T10:00:00Z',
        last_prompt: 'Do work',
        tasks: [
          {
            id: 1,
            task_id: 't1',
            project_id: 'p1',
            question: 'Do work',
            language: 'en',
            model_platform: 'openai',
            model_type: 'gpt',
            max_retries: 0,
            tokens: 10,
            status: 2,
          },
        ],
        total_completed_tasks: 1,
        total_ongoing_tasks: 0,
        average_tokens_per_task: 10,
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<DispatchPage />} />
          <Route path="/projects/:projectId" element={<DispatchPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Alpha'));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Back to projects' })
      ).toBeInTheDocument();
    });
  });
});
