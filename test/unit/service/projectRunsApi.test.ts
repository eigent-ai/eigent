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

import { fetchGet, fetchPost } from '@/api/http';
import {
  ACTIVE_DURABLE_RUN_STATUSES,
  cancelProjectRun,
  fetchActiveProjectRuns,
  fetchProjectRuns,
} from '@/service/projectRunsApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn(), fetchPost: vi.fn() }));

const fetchGetMock = vi.mocked(fetchGet);
const fetchPostMock = vi.mocked(fetchPost);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('project Runs API', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
    fetchPostMock.mockReset();
  });

  it('shares concurrent reads and clears the request after it settles', async () => {
    const firstResponse = deferred<{ project_id: string; runs: never[] }>();
    fetchGetMock.mockReturnValueOnce(firstResponse.promise);

    const legacyProjection = fetchProjectRuns('project-1', 100);
    const eventProjection = fetchProjectRuns('project-1', 100);

    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    expect(fetchGetMock).toHaveBeenCalledWith(
      '/runs',
      {
        project_id: 'project-1',
        limit: 100,
      },
      undefined,
      { signal: expect.any(AbortSignal) }
    );

    const payload = { project_id: 'project-1', runs: [] as never[] };
    firstResponse.resolve(payload);
    await expect(legacyProjection).resolves.toBe(payload);
    await expect(eventProjection).resolves.toBe(payload);

    fetchGetMock.mockResolvedValueOnce(payload);
    await fetchProjectRuns('project-1', 100);
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
  });

  it('lets one caller abort without cancelling the shared request', async () => {
    const response = deferred<{ project_id: string; runs: never[] }>();
    fetchGetMock.mockReturnValueOnce(response.promise);
    const controller = new AbortController();

    const cancelled = fetchProjectRuns('project-abort', 100, controller.signal);
    const remaining = fetchProjectRuns('project-abort', 100);
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchGetMock.mock.calls[0]?.[3]?.signal.aborted).toBe(false);
    const payload = { project_id: 'project-abort', runs: [] as never[] };
    response.resolve(payload);
    await expect(remaining).resolves.toBe(payload);
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
  });

  it('aborts an orphaned shared read and lets the next Space start fresh', async () => {
    const abandonedResponse = deferred<{
      project_id: string;
      runs: never[];
    }>();
    fetchGetMock.mockReturnValueOnce(abandonedResponse.promise);
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = fetchProjectRuns(
      'project-abandoned',
      100,
      firstController.signal
    );
    const second = fetchProjectRuns(
      'project-abandoned',
      100,
      secondController.signal
    );
    const sharedSignal = fetchGetMock.mock.calls[0]?.[3]?.signal;

    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignal?.aborted).toBe(true);

    const payload = { project_id: 'project-abandoned', runs: [] as never[] };
    fetchGetMock.mockResolvedValueOnce(payload);
    await expect(fetchProjectRuns('project-abandoned', 100)).resolves.toBe(
      payload
    );
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
  });

  it('asks the canonical registry only for active Run states', async () => {
    const controller = new AbortController();
    const payload = { project_id: 'project-1', runs: [] as never[] };
    fetchGetMock.mockResolvedValueOnce(payload);

    await expect(
      fetchActiveProjectRuns('project-1', controller.signal)
    ).resolves.toBe(payload);

    expect(fetchGetMock).toHaveBeenCalledWith(
      '/runs',
      {
        project_id: 'project-1',
        status: ACTIVE_DURABLE_RUN_STATUSES,
        limit: 1,
      },
      undefined,
      { signal: controller.signal }
    );
  });

  it('cancels the exact encoded Run with the caller-owned request id', async () => {
    fetchPostMock.mockResolvedValue(undefined);

    await cancelProjectRun(
      'run/with scope',
      'cancel:run-1:stable',
      'explicit_stop_from_event_native_chatbox'
    );

    expect(fetchPostMock).toHaveBeenCalledWith(
      '/runs/run%2Fwith%20scope/cancel',
      {
        request_id: 'cancel:run-1:stable',
        reason: 'explicit_stop_from_event_native_chatbox',
      }
    );
  });
});
