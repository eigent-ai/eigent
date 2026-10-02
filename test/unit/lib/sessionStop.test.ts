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

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';
import { SessionStopError, stopSessionAndWait } from '@/lib/sessionStop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchDelete: vi.fn(),
}));
vi.mock('@/lib/authEnvironment', () => ({
  getAccountEnvironmentKey: () => 'account-42',
  getAuthEnvironmentKey: () => 'auth-env-test',
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => ({}) }));

const project = 'session-a';
let route: 'legacy' | 'managed';
let activeRuns: Array<{ run_id: string; status: string }>;

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

beforeEach(() => {
  vi.useFakeTimers();
  route = 'legacy';
  activeRuns = [{ run_id: 'run-1', status: 'running' }];
  vi.mocked(fetchGet).mockImplementation(async (url: string) => {
    if (url === `/projects/${project}/execution-route`)
      return { project_id: project, route };
    if (url === `/projects/${project}/follow-ups`)
      return { items: [{ request_id: 'follow-up-1' }] };
    if (url === `/projects/${project}/executions`)
      return {
        project_id: project,
        next_cursor: null,
        items: [
          {
            request_id: 'execution-open',
            project_id: project,
            queue_seq: 1,
            status: 'admitted',
            settlement: null,
          },
          {
            request_id: 'execution-settled',
            project_id: project,
            queue_seq: 2,
            status: 'admitted',
            settlement: 'settled',
          },
        ],
      };
    if (url === '/runs') return { project_id: project, runs: activeRuns };
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(fetchDelete).mockResolvedValue({
    request_id: 'follow-up-1',
    content: '',
  });
  vi.mocked(fetchPost).mockImplementation(async () => {
    // Run cancel awaits the execution, which then leaves the active list.
    activeRuns = [];
    return {};
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function settle<T>(work: Promise<T>, ms: number) {
  const outcome = work.then(
    () => 'resolved',
    (error: unknown) => error
  );
  await vi.advanceTimersByTimeAsync(ms);
  return outcome;
}

describe('stopSessionAndWait', () => {
  it('cancels queued follow-ups and active Runs, then waits for an empty Run list', async () => {
    let resolved = false;
    const work = stopSessionAndWait(project).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(900);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await work;

    expect(fetchDelete).toHaveBeenCalledWith(
      `/projects/${project}/follow-ups/follow-up-1`
    );
    expect(fetchPost).toHaveBeenCalledWith('/runs/run-1/cancel', {
      request_id: 'session-delete:run-1',
      reason: 'session_deleted',
    });
    expect(
      vi
        .mocked(fetchDelete)
        .mock.calls.filter(([url]) => url === `/chat/${project}`)
    ).toHaveLength(1);
  });

  it('keeps polling until the Run actually leaves the active list', async () => {
    vi.mocked(fetchPost).mockResolvedValue({});
    const work = stopSessionAndWait(project);
    await vi.advanceTimersByTimeAsync(1_600);
    activeRuns = [];

    expect(await settle(work, 2_000)).toBe('resolved');
    expect(
      vi.mocked(fetchGet).mock.calls.filter(([url]) => url === '/runs').length
    ).toBeGreaterThan(3);
  });

  it('treats a 409 or 404 cancel response as an already ended Run', async () => {
    vi.mocked(fetchPost).mockImplementation(async () => {
      activeRuns = [];
      throw httpError(409);
    });
    vi.mocked(fetchDelete).mockImplementation(async (url: string) => {
      if (url.includes('/follow-ups/')) throw httpError(404);
      return undefined;
    });

    expect(await settle(stopSessionAndWait(project), 2_000)).toBe('resolved');
  });

  it('gives up after 30 seconds while a Run is still active', async () => {
    vi.mocked(fetchPost).mockResolvedValue({});

    const outcome = await settle(stopSessionAndWait(project), 30_000);

    expect(outcome).toBeInstanceOf(SessionStopError);
  });

  it('fails instead of continuing when a stop request fails unexpectedly', async () => {
    vi.mocked(fetchPost).mockRejectedValue(httpError(500));

    const outcome = await settle(stopSessionAndWait(project), 2_000);

    expect(outcome).toBeInstanceOf(SessionStopError);
    expect((outcome as SessionStopError).cause).toMatchObject({ status: 500 });
  });

  it('cancels open managed executions without the legacy stop routes', async () => {
    route = 'managed';
    vi.mocked(fetchDelete).mockImplementation(async (url: string) => {
      if (url === '/executions/execution-open') activeRuns = [];
      return { request_id: 'execution-open', project_id: project };
    });

    expect(await settle(stopSessionAndWait(project), 2_000)).toBe('resolved');
    expect(fetchDelete).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchDelete).mock.calls[0][0]).toBe(
      '/executions/execution-open'
    );
    expect(fetchPost).not.toHaveBeenCalled();
  });
});
