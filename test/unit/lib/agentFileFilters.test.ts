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

import { describe, expect, it } from 'vitest';

import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';

describe('filterVisibleAgentFiles', () => {
  it('keeps only user-visible output files', () => {
    const files = [
      {
        name: 'index.html',
        path: '/Users/test/eigent/user/project_p/task_1/index.html',
        relativePath: 'task_1/index.html',
      },
      {
        name: 'task_1',
        path: '/Users/test/eigent/user/project_p/task_1',
        relativePath: 'task_1',
        isFolder: true,
      },
      {
        name: 'task_1784197841790-917',
        path: '/Users/test/eigent/user/project_p/task_1784197841790-917',
        relativePath: 'task_1784197841790-917',
      },
      {
        name: 'task_task_9cf6edb4be72400eb48338bb387',
        path: '/Users/test/eigent/user/project_p/task_task_9cf6edb4be72400eb48338bb387',
        relativePath: 'task_task_9cf6edb4be72400eb48338bb387',
      },
      {
        name: 'events.jsonl',
        path: '/Users/test/.eigent/user/project_p/task_1/camel_logs/events.jsonl',
        relativePath: 'task_1/camel_logs/events.jsonl',
      },
      {
        name: 'trace.jsonl',
        path: '/Users/test/.eigent/user/project_p/task_1/trace.jsonl',
        source: 'camel_log',
      },
    ];

    expect(filterVisibleAgentFiles(files)).toEqual([files[0]]);
  });
});
