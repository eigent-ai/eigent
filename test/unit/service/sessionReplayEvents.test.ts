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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchProjectRuns: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: mocks.fetchGet,
  fetchPost: mocks.fetchPost,
}));
vi.mock('@/service/projectRunsApi', () => ({
  fetchProjectRuns: mocks.fetchProjectRuns,
}));

import { loadSessionReplayData } from '@/service/sessionReplayEvents';

function rawEvent(runId: string, sequence: number, eventType: string) {
  return {
    event_id: `${runId}-${sequence}`,
    run_id: runId,
    sequence,
    run_version: sequence,
    event_type: eventType,
    payload: {},
    created_at: `2026-11-01T10:00:0${sequence}Z`,
  };
}

describe('loadSessionReplayData', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
  });

  it('reads finished Runs oldest first, page by page, with GET only', async () => {
    mocks.fetchProjectRuns.mockResolvedValue({
      project_id: 'project-1',
      runs: [
        {
          run_id: 'run-b',
          status: 'failed',
          created_at: '2026-11-02T00:00:00Z',
        },
        {
          run_id: 'run-live',
          status: 'running',
          created_at: '2026-11-03T00:00:00Z',
        },
        {
          run_id: 'run-a',
          status: 'completed',
          created_at: '2026-11-01T00:00:00Z',
        },
      ],
    });
    mocks.fetchGet.mockImplementation(
      async (url: string, params: { after_sequence: number }) => {
        if (url === '/runs/run-a/events' && params.after_sequence === 0) {
          return {
            events: [rawEvent('run-a', 1, 'user.message')],
            has_more: true,
            next_sequence: 1,
          };
        }
        if (url === '/runs/run-a/events') {
          return {
            events: [rawEvent('run-a', 2, 'run.completed')],
            has_more: false,
            next_sequence: 2,
          };
        }
        return {
          events: [rawEvent('run-b', 1, 'run.failed')],
          has_more: false,
          next_sequence: 1,
        };
      }
    );

    const data = await loadSessionReplayData('project-1');

    expect(data.runs.map((run) => run.runId)).toEqual(['run-a', 'run-b']);
    expect(data.events.map((event) => event.eventId)).toEqual([
      'run-a-1',
      'run-a-2',
      'run-b-1',
    ]);
    expect(data.events[0].projectId).toBe('project-1');
    expect(data.unfinishedRunCount).toBe(1);
    expect(data.truncated).toBe(false);
    // Replay never asks Brain to do anything.
    expect(mocks.fetchPost).not.toHaveBeenCalled();
    expect(mocks.fetchGet).not.toHaveBeenCalledWith(
      '/runs/run-live/events',
      expect.anything(),
      undefined,
      expect.anything()
    );
  });

  it('stops at the event cap and says so', async () => {
    mocks.fetchProjectRuns.mockResolvedValue({
      runs: [{ run_id: 'run-a', status: 'completed', created_at: null }],
    });
    mocks.fetchGet.mockResolvedValue({
      events: [
        rawEvent('run-a', 1, 'user.message'),
        rawEvent('run-a', 2, 'assistant.final'),
      ],
      has_more: true,
      next_sequence: 2,
    });
    const data = await loadSessionReplayData('project-1', { maxEvents: 2 });
    expect(data.events).toHaveLength(2);
    expect(data.truncated).toBe(true);
  });

  it('skips malformed events instead of failing the replay', async () => {
    mocks.fetchProjectRuns.mockResolvedValue({
      runs: [{ run_id: 'run-a', status: 'completed' }],
    });
    mocks.fetchGet.mockResolvedValue({
      events: [{ nope: true }, rawEvent('run-a', 1, 'user.message')],
      has_more: false,
    });
    const data = await loadSessionReplayData('project-1');
    expect(data.events).toHaveLength(1);
  });
});
