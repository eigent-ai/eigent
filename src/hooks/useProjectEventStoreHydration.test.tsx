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

import { fetchGet } from '@/api/http';
import {
  getProjectEventStore,
  resetProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectEventStoreHydration } from './useProjectEventStoreHydration';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn() }));

const fetchGetMock = vi.mocked(fetchGet);

describe('useProjectEventStoreHydration', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
    resetProjectEventStoresForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetProjectEventStoresForTests();
  });

  it('retries a contract-blocked hydration after a same-id store reset', async () => {
    const consoleWarn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    fetchGetMock.mockResolvedValueOnce({
      project_id: 'project-1',
      runs: 'invalid',
    });

    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );

    await waitFor(() =>
      expect(result.current).toMatchObject({
        status: 'error',
        errorCode: 'invalid_response',
      })
    );

    fetchGetMock
      .mockResolvedValueOnce({
        project_id: 'project-1',
        runs: [
          {
            run_id: 'run-1',
            status: 'completed',
            version: 0,
            origin: 'local',
            resume_blocked_reason: null,
            updated_at: 1_786_441_602,
          },
        ],
      })
      .mockResolvedValueOnce({
        run_id: 'run-1',
        next_sequence: 0,
        has_more: false,
        events: [],
      });

    const store = getProjectEventStore('project-1');
    const previousIncarnation = store.getSnapshot().incarnation;
    act(() => resetProjectEventStore('project-1'));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(store.getSnapshot().incarnation).toBe(previousIncarnation + 1);
    expect(store.getSnapshot().hasHydratedSnapshot).toBe(true);
    expect(fetchGetMock).toHaveBeenCalledTimes(3);
    consoleWarn.mockRestore();
  });
});
