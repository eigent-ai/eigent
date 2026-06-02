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

import { buildTurns } from '@/lib/remoteControlTurns';
import { describe, expect, it } from 'vitest';

describe('buildTurns', () => {
  it('uses wait_confirm question text for simple-answer implicit turns', () => {
    const turns = buildTurns(
      [
        {
          step_id: 10,
          task_id: 'task_1',
          project_id: 'project_1',
          step: 'wait_confirm',
          data: {
            question: 'What is this project?',
            content: 'This project is a remote control surface.',
          },
          timestamp: 123,
        },
      ],
      []
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: 'turn-pre-10',
      userQuery: 'What is this project?',
      status: 'done',
    });
    expect(turns[0]?.agentResponse?.step).toBe('wait_confirm');
  });
});
