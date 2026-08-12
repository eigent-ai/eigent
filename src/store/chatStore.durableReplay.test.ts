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

import { describe, expect, it, vi } from 'vitest';
import {
  acceptCanonicalRunEvent,
  admitDurableRunResume,
  canonicalRunEventToLegacyMessage,
  createCanonicalRunEventCursor,
  mergeFileInfoLists,
  normalizeTaskArtifactFileList,
  removeResolvedInteractionMessages,
} from './chatStore';

describe('canonical Run replay projection', () => {
  it('surfaces Resume admission failures before execution starts', async () => {
    const error = Object.assign(new Error('Unsafe tool outcome'), {
      status: 409,
    });
    const post = vi.fn().mockRejectedValue(error);

    await expect(
      admitDurableRunResume('run/unsafe', 'resume-request-1', post)
    ).rejects.toBe(error);
    expect(post).toHaveBeenCalledWith('/runs/run%2Funsafe/resume', {
      request_id: 'resume-request-1',
      reason: 'explicit_resume',
    });
  });

  it('unwraps legacy UI events and projects approval decisions', () => {
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'legacy.end',
        legacy_step: 'end',
        payload: { message: 'finished' },
        created_at: 1_786_026_414.75,
      })
    ).toEqual({
      step: 'end',
      data: { message: 'finished' },
      timestamp: 1_786_026_414.75,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'approval.decided',
        legacy_step: null,
        payload: {
          interaction_id: 'approval-1',
          decision: 'approved',
        },
        created_at: 1_786_026_415,
      })
    ).toEqual({
      step: 'human_reply',
      data: {
        interaction_id: 'approval-1',
        decision: 'approved',
        __durable_interaction_resolution: true,
      },
      timestamp: 1_786_026_415,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'tool.completed',
        legacy_step: null,
        payload: { outcome: 'completed' },
      })
    ).toBeNull();
    expect(
      canonicalRunEventToLegacyMessage({
        run_id: 'run-1',
        after_sequence: 3,
      })
    ).toBeNull();
  });

  it('removes only the message for the resolved interaction', () => {
    const messages = [
      {
        id: 'approval-card',
        role: 'agent' as const,
        content: 'Approve?',
        interaction: {
          interaction_id: 'approval-1',
          interaction_type: 'approval' as const,
          run_id: 'run-1',
          version: 0,
        },
      },
      {
        id: 'other-card',
        role: 'agent' as const,
        content: 'Other question',
        interaction: {
          interaction_id: 'question-2',
          interaction_type: 'question' as const,
          run_id: 'run-1',
          version: 0,
        },
      },
    ];

    expect(removeResolvedInteractionMessages(messages, 'approval-1')).toEqual([
      messages[1],
    ]);
  });

  it('deduplicates reconnect replay by sequence and event_id', () => {
    const cursor = createCanonicalRunEventCursor();
    const first = { sequence: 1, event_id: 'event-1' };

    expect(acceptCanonicalRunEvent(cursor, first, '1')).toBe(true);
    expect(acceptCanonicalRunEvent(cursor, first, '1')).toBe(false);
    expect(
      acceptCanonicalRunEvent(cursor, {
        sequence: 2,
        event_id: 'event-1',
      })
    ).toBe(false);
    expect(
      acceptCanonicalRunEvent(cursor, {
        sequence: 2,
        event_id: 'event-2',
      })
    ).toBe(true);
    expect(cursor.lastSequence).toBe(2);
  });

  it('keeps same-named files when their workspace-relative paths differ', () => {
    const artifacts = Array.from({ length: 21 }, (_, index) => ({
      filename: 'index.html',
      path: `/workspace/chapter-2/lesson-${index + 1}/index.html`,
      relativePath: `chapter-2/lesson-${index + 1}/index.html`,
      changeType: 'generated',
    }));

    const files = normalizeTaskArtifactFileList(artifacts);

    expect(files).toHaveLength(21);
    expect(files[0]).toEqual(
      expect.objectContaining({
        relativePath: 'chapter-2/lesson-1/index.html',
        artifactChange: 'generated',
      })
    );
    expect(files[20]).toEqual(
      expect.objectContaining({
        relativePath: 'chapter-2/lesson-21/index.html',
        artifactChange: 'generated',
      })
    );

    expect(mergeFileInfoLists([], files)).toHaveLength(21);

    expect(
      mergeFileInfoLists(
        [
          {
            name: 'index.html',
            type: 'html',
            path: '/workspace/chapter-2/lesson-1/index.html',
          },
        ],
        [files[0]]
      )
    ).toHaveLength(1);
  });

  it('matches URL-encoded stream paths and legacy x-prefixed paths', () => {
    expect(
      mergeFileInfoLists(
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: '/files/stream?path=reports%2Freport.csv&project_id=1',
            isRemote: true,
          },
        ],
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: '/workspace/reports/report.csv',
            relativePath: 'reports/report.csv',
            artifactChange: 'changed',
          },
        ]
      )
    ).toMatchObject([
      {
        path: '/files/stream?path=reports%2Freport.csv&project_id=1',
        artifactChange: 'changed',
      },
    ]);

    expect(
      mergeFileInfoLists(
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: 'x:/Users/test/report.csv',
          },
        ],
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: '/Users/test/report.csv',
          },
        ]
      )
    ).toHaveLength(1);
  });
});
