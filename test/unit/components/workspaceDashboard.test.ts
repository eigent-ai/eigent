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
  getWorkspaceDashboardFileId,
  parseWorkspaceMarkdownTasks,
  readWorkspaceDashboardConfig,
  updateWorkspaceDashboardSources,
} from '@/components/Workspace/workspaceDashboardModel';
import { describe, expect, it } from 'vitest';

describe('workspace dashboard file mapping', () => {
  it('reads valid per-section file links and ignores invalid metadata', () => {
    expect(
      readWorkspaceDashboardConfig({
        workspaceDashboard: {
          sources: {
            overview: ['clients/acme.md', 'clients/acme.md'],
            todos: ['todo-list.md'],
            unknown: ['ignored.md'],
            risks: 'not-an-array',
          },
        },
      })
    ).toEqual({
      version: 1,
      sources: {
        overview: ['clients/acme.md'],
        todos: ['todo-list.md'],
      },
    });
  });

  it('updates one section without changing the other mappings', () => {
    const next = updateWorkspaceDashboardSources(
      {
        version: 1,
        sources: { overview: ['overview.md'], todos: ['old.md'] },
      },
      'todos',
      ['todo-list.md']
    );

    expect(next.sources).toEqual({
      overview: ['overview.md'],
      todos: ['todo-list.md'],
    });
  });

  it('uses project and workspace-relative path as the remote file identity', () => {
    expect(
      getWorkspaceDashboardFileId({
        name: 'todo.md',
        type: 'md',
        path: 'https://example.com/todo.md',
        relativePath: 'Acme/todo.md',
        project_id: 'project-1',
      })
    ).toBe('project-1:todo.md');
  });
});

describe('workspace Markdown tasks', () => {
  it('parses open and completed tasks under their nearest heading', () => {
    const tasks = parseWorkspaceMarkdownTasks(
      [
        '# Delivery',
        '- [ ] Send sample',
        '- [x] Confirm scope',
        '',
        '## Launch',
        '  * [X] Publish assets',
        '- regular bullet',
      ].join('\n'),
      'project.md'
    );

    expect(tasks).toEqual([
      {
        id: 'project.md:2',
        checked: false,
        text: 'Send sample',
        heading: 'Delivery',
        line: 2,
      },
      {
        id: 'project.md:3',
        checked: true,
        text: 'Confirm scope',
        heading: 'Delivery',
        line: 3,
      },
      {
        id: 'project.md:6',
        checked: true,
        text: 'Publish assets',
        heading: 'Launch',
        line: 6,
      },
    ]);
  });
});
