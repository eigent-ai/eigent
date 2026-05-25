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
  buildSessionSidePanel,
  isInternalField,
  normalizeBillingSummary,
  toSessionTimeline,
} from '@web/lib/viewModels';
import { describe, expect, it } from 'vitest';

describe('viewModels', () => {
  it('detects internal fields', () => {
    expect(isInternalField('agent_name')).toBe(true);
    expect(isInternalField('question')).toBe(false);
  });

  it('filters internal step data from timeline', () => {
    const timeline = toSessionTimeline([
      {
        id: 1,
        step: 'message',
        data: { content: 'Hello user' },
        timestamp: 1,
      },
      {
        id: 2,
        step: 'agent_tool_call',
        data: { agent_name: 'secret', tool_name: 'mcp_search' },
        timestamp: 2,
      },
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].label).toBe('Message');
    expect(timeline[0].detail).toBe('Hello user');
  });

  it('builds side panel without internal agent fields', () => {
    const panel = buildSessionSidePanel({
      session: {
        id: 1,
        taskId: 'task-1',
        projectId: 'project-1',
        question: 'Analyze sales',
        status: 'done',
        tokens: 10,
      },
      steps: [
        {
          id: 1,
          step: 'message',
          data: { content: 'Done' },
        },
        {
          id: 2,
          step: 'mcp_result',
          data: { mcp: 'hidden', content: 'should not appear' },
        },
      ],
    });

    expect(panel.timeline.some((item) => item.label.includes('mcp'))).toBe(
      false
    );
  });

  it('normalizes partial billing summary', () => {
    expect(
      normalizeBillingSummary(
        { email: 'a@b.com', credits_total: 5 },
        'fallback@x.com'
      )
    ).toMatchObject({
      email: 'a@b.com',
      credits_total: 5,
      plan_name: 'Free',
    });
  });
});
