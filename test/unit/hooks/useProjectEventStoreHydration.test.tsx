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

import { useProjectEventStoreHydration } from '@/hooks/useProjectEventStoreHydration';
import { resetProjectEventStoresForTests } from '@/store/projectEventStore';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
}));

vi.mock('@/service/projectEventStoreHydration', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/service/projectEventStoreHydration')
    >();
  return {
    ...original,
    hydrateProjectEventStore: mocks.hydrate,
  };
});

const hydrated = {
  projectId: 'project-1',
  runCount: 0,
  eventCount: 0,
  pageCount: 1,
  byteCount: 0,
  eventsTruncated: false,
};

async function flushHydration(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useProjectEventStoreHydration', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    vi.clearAllMocks();
    resetProjectEventStoresForTests();
  });

  it('blocks automatic retries when the replay API is unsupported', async () => {
    vi.useFakeTimers();
    mocks.hydrate.mockRejectedValue(
      Object.assign(new Error('Not found'), {
        status: 404,
      })
    );

    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await flushHydration();

    expect(result.current).toMatchObject({
      status: 'error',
      errorCode: 'unsupported',
    });
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await flushHydration();
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
  });

  it('keeps bounded backoff for transient request failures', async () => {
    vi.useFakeTimers();
    mocks.hydrate
      .mockRejectedValueOnce(
        Object.assign(new Error('Unavailable'), {
          status: 503,
        })
      )
      .mockResolvedValueOnce(hydrated);

    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await flushHydration();

    expect(result.current.status).toBe('retrying');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushHydration();

    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });
});
