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

import { filterProjects } from '@web/lib/projectSearch';
import type { WebProject } from '@web/types';
import { describe, expect, it } from 'vitest';

const sampleProjects: WebProject[] = [
  {
    projectId: 'p1',
    name: 'Marketing launch',
    sessionCount: 2,
    totalTokens: 100,
    latestActivity: '2026-05-20T10:00:00Z',
    lastPrompt: 'Draft launch email',
    ongoingCount: 1,
    completedCount: 1,
    sessions: [
      {
        id: 1,
        taskId: 't1',
        projectId: 'p1',
        question: 'Draft launch email',
        status: 'ongoing',
        tokens: 50,
      },
    ],
  },
  {
    projectId: 'p2',
    name: 'Finance review',
    sessionCount: 1,
    totalTokens: 20,
    latestActivity: '2026-05-18T10:00:00Z',
    lastPrompt: 'Summarize Q1 report',
    ongoingCount: 0,
    completedCount: 1,
    sessions: [
      {
        id: 2,
        taskId: 't2',
        projectId: 'p2',
        question: 'Summarize Q1 report',
        status: 'done',
        tokens: 20,
      },
    ],
  },
];

describe('filterProjects', () => {
  it('returns all projects when query is empty', () => {
    expect(filterProjects(sampleProjects, '')).toHaveLength(2);
  });

  it('filters by project name and session question', () => {
    expect(filterProjects(sampleProjects, 'finance')).toHaveLength(1);
    expect(filterProjects(sampleProjects, 'launch email')).toHaveLength(1);
  });
});
