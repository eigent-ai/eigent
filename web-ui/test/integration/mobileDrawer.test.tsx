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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DispatchPage from '@web/pages/DispatchPage';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@web/hooks/useWebAuth', () => ({
  useIsMobile: () => true,
  useIsTablet: () => false,
  useMediaQuery: () => true,
  useLogout: () => vi.fn(),
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
      sessions: [
        {
          id: 1,
          taskId: 't1',
          projectId: 'p1',
          question: 'Do work',
          status: 'done',
          tokens: 10,
        },
      ],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
  useSessionPanel: () => ({
    panel: null,
    loading: false,
  }),
  createEmptyProject: vi.fn(),
  toWebSession: vi.fn(),
}));

describe('mobile dispatch layout', () => {
  it('shows task panel on mobile and returns to project list', async () => {
    render(
      <MemoryRouter initialEntries={['/projects/p1']}>
        <Routes>
          <Route path="/projects" element={<DispatchPage />} />
          <Route path="/projects/:projectId" element={<DispatchPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Session review')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Back to projects' })
    );
    expect(screen.getByPlaceholderText('Search projects…')).toBeInTheDocument();
  });
});
