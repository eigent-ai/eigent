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
  getProjectEventStore,
  resetProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useProjectEventView } from './useProjectEventView';

describe('useProjectEventView', () => {
  afterEach(() => resetProjectEventStoresForTests());

  it('keeps a same-id consumer on the reset Project event store', () => {
    const store = getProjectEventStore('project-1');
    const { result, unmount } = renderHook(() =>
      useProjectEventView('project-1')
    );
    act(() => {
      store.replaceSnapshot({
        project_id: 'project-1',
        current_cursor: 0,
        runs: [
          {
            run_id: 'run-1',
            status: 'completed',
            expected_next_run_sequence: 1,
            updated_at: '2026-08-11T10:00:00.000Z',
          },
        ],
        recent_events: [],
      });
    });
    expect(result.current.view.runs['run-1']).toBeDefined();
    const previousIncarnation = store.getSnapshot().incarnation;

    act(() => resetProjectEventStore('project-1'));

    expect(getProjectEventStore('project-1')).toBe(store);
    expect(result.current.incarnation).toBe(previousIncarnation + 1);
    expect(result.current.view.runs).toEqual({});
    expect(result.current.hasHydratedSnapshot).toBe(false);
    const replacement = store.beginSnapshotReplacement();
    expect(replacement).not.toBeNull();
    if (replacement) store.cancelSnapshotReplacement(replacement);

    unmount();
  });
});
