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
  buildWorkspaceTimelineEvents,
  classifyWorkspaceCommit,
  resolveWorkspaceCommitInitiator,
} from '@/components/Workspace/WorkspaceCommitTimeline';
import { describe, expect, it } from 'vitest';

describe('workspace commit timeline', () => {
  it('fails closed to Agent when legacy history lacks provenance', () => {
    expect(resolveWorkspaceCommitInitiator(undefined)).toBe('agent');
    expect(resolveWorkspaceCommitInitiator('agent')).toBe('agent');
    expect(resolveWorkspaceCommitInitiator('user')).toBe('user');
  });

  it('classifies merge commits by their graph parents', () => {
    expect(
      classifyWorkspaceCommit({
        parent_oids: ['parent-a', 'parent-b'],
        subject: 'Custom integration message',
      })
    ).toBe('merge');
  });

  it('recognizes user save points and internal checkpoints', () => {
    expect(
      classifyWorkspaceCommit({
        parent_oids: ['parent-a'],
        subject: 'Save progress',
      })
    ).toBe('save_point');
    expect(
      classifyWorkspaceCommit({
        parent_oids: ['parent-a'],
        subject: 'Checkpoint bounded workspace process delta',
      })
    ).toBe('checkpoint');
  });

  it('places user pushes alongside commits in chronological order', () => {
    const events = buildWorkspaceTimelineEvents(
      [
        {
          oid: 'a'.repeat(40),
          parent_oids: [],
          author: 'Eigent',
          committed_at: 10,
          subject: 'Initialize workspace',
          kind: 'commit',
          initiated_by: 'agent',
        },
      ],
      [
        {
          operation_id: 'push-1',
          kind: 'push',
          initiated_by: 'user',
          occurred_at: 20,
          head_oid: 'a'.repeat(40),
          remote_name: 'origin',
        },
      ]
    );

    expect(events.map((event) => event.type)).toEqual(['operation', 'commit']);
  });
});
