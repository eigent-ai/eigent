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
// Licensed under the Apache License, Version 2.0 (the "License");

import {
  getCachedProject,
  putCachedProject,
  type CachedProject,
} from '@/lib/projectCache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entries = new Map<string, CachedProject>();
const scope = { userId: 'cache-test-user', projectId: 'cache-test-project' };
const cacheKey = `${scope.userId}|${scope.projectId}`;

function successfulRequest<T>(result: T): IDBRequest<T> {
  const request = { result } as IDBRequest<T>;
  queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
  return request;
}

beforeEach(() => {
  entries.clear();
  // Exercise the real cache API while keeping all database operations in memory.
  const store = {
    get: (key: string) => successfulRequest(entries.get(key)),
    put: (value: CachedProject, key: string) => {
      entries.set(key, value);
      return successfulRequest(key);
    },
    delete: (key: string) => {
      entries.delete(key);
      return successfulRequest(undefined);
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () =>
      successfulRequest({
        transaction: () => ({ objectStore: () => store }),
      }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project cache projection version', () => {
  const historicalProjection = {
    serverUpdatedAt: 1_787_011_800_000,
    localCanonicalUpdatedAt: null,
    taskIds: ['legacy-failed-run'],
    tasks: {
      'legacy-failed-run': {
        taskState: {
          status: 'finished',
          durableRunStatus: 'failed',
          elapsed: 0,
          taskTime: 0,
          messages: [{ role: 'user', content: 'Build a report' }],
        },
      },
    },
  };

  it('rejects and discards a version 9 legacy failure cached with zero duration', async () => {
    entries.set(cacheKey, {
      ...historicalProjection,
      schemaVersion: 9,
      cachedAt: 1_787_011_800_000,
    });

    expect(await getCachedProject(scope)).toBeNull();
    await vi.waitFor(() => expect(entries.has(cacheKey)).toBe(false));
  });

  it('writes and reads version 10 with the reconstructed historical duration', async () => {
    const restoredProjection = {
      ...historicalProjection,
      tasks: {
        'legacy-failed-run': {
          taskState: {
            ...historicalProjection.tasks['legacy-failed-run'].taskState,
            elapsed: 600_000,
          },
        },
      },
    };
    await putCachedProject(scope, restoredProjection);

    expect(await getCachedProject(scope)).toEqual({
      ...restoredProjection,
      schemaVersion: 10,
      cachedAt: expect.any(Number),
    });
    expect(entries.has(cacheKey)).toBe(true);
  });
});
