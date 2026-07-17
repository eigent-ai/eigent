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

import { buildTaskQuestionsById } from '@/lib/historyPrompts';
import { describe, expect, it } from 'vitest';

describe('buildTaskQuestionsById', () => {
  it('preserves each task prompt by task id', () => {
    expect(
      buildTaskQuestionsById([
        { task_id: 'task-a', question: 'first prompt' },
        { task_id: 'task-b', question: 'follow-up prompt' },
        { task_id: 'task-c', question: 'third prompt' },
      ])
    ).toEqual({
      'task-a': 'first prompt',
      'task-b': 'follow-up prompt',
      'task-c': 'third prompt',
    });
  });

  it('ignores incomplete history rows', () => {
    expect(
      buildTaskQuestionsById([
        { task_id: 'task-a', question: 'first prompt' },
        { task_id: null, question: 'missing id' },
        { task_id: 'task-b', question: '' },
        { task_id: 'task-c' },
      ])
    ).toEqual({
      'task-a': 'first prompt',
    });
  });
});
