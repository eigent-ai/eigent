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

import { normalizeLocalRunEvent } from '@/lib/projector';
import { ProjectEventStore } from '@/store/projectEventStore';
import { describe, expect, it } from 'vitest';

describe('Session semantic history retention', () => {
  it('keeps 4,201 known receipts and dialogue beyond 8 MiB', () => {
    const events = Array.from({ length: 4_201 }, (_, index) =>
      normalizeLocalRunEvent(
        {
          event_id: `history-${index}`,
          run_id: 'run-1',
          sequence: index + 1,
          run_version: index + 1,
          event_type:
            index === 0
              ? 'user.message'
              : index === 1
                ? 'assistant.final'
                : 'legacy.terminal',
          payload: {
            content:
              index < 2 ? `Dialogue ${index}` : 'Frame details '.repeat(120),
          },
          created_at: 1_786_441_600 + index,
        },
        'project-1'
      )
    );
    const store = new ProjectEventStore('project-1');
    store.replaceSnapshot({
      project_id: 'project-1',
      current_cursor: 0,
      recent_events: events,
    });
    const { chat } = store.getSnapshot();
    expect(chat.nodes).toHaveLength(4_201);
    expect(chat.nodes.slice(0, 2).map((node) => node.kind)).toEqual([
      'message',
      'message',
    ]);
    expect(JSON.stringify(chat.nodes).length * 2).toBeGreaterThan(
      8 * 1024 * 1024
    );
  });
});
