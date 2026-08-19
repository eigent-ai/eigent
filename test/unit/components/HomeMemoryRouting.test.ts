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
  memoryEditorSearch,
  resolveSpaceDetailMemoryTarget,
} from '@/components/Home/memoryRoute';
import { describe, expect, it } from 'vitest';

const projects = [
  {
    project_id: 'project-1',
    space_id: 'space-1',
    project_name: 'Launch Plan',
    total_tokens: 0,
    task_count: 0,
    total_triggers: 0,
    latest_task_date: '',
    last_prompt: '',
    tasks: [],
    total_completed_tasks: 0,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 0,
  },
];

describe('Home Memory routing', () => {
  it('builds Space and Project Memory editor destinations', () => {
    expect(memoryEditorSearch('space-1')).toBe(
      '?section=spaces&spaceId=space-1&spaceTab=memory'
    );
    expect(memoryEditorSearch('space-1', 'project-1')).toBe(
      '?section=spaces&spaceId=space-1&spaceTab=memory&memoryScope=project&projectId=project-1'
    );
  });

  it('opens a valid Project scope and safely falls back to Space Memory', () => {
    expect(
      resolveSpaceDetailMemoryTarget(
        'space-1',
        new URLSearchParams('memoryScope=project&projectId=project-1'),
        projects
      )
    ).toEqual({
      scope: { type: 'project', id: 'project-1' },
      label: 'Launch Plan',
    });

    expect(
      resolveSpaceDetailMemoryTarget(
        'space-1',
        new URLSearchParams('memoryScope=project&projectId=missing'),
        projects
      )
    ).toEqual({ scope: { type: 'space', id: 'space-1' } });
  });
});
