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
  useHomeVisitStore,
  useHomeVisitTracking,
} from '@/components/Home/homeVisit';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const space = (id: string, updatedAt = 1): Space =>
  ({ id, name: id, status: 'active', createdAt: 1, updatedAt }) as Space;

describe('useHomeVisitTracking', () => {
  beforeEach(() => {
    useSpaceStore.setState({ spaces: {}, projectsBySpaceId: {} });
    useHomeVisitStore.setState({
      visit: 0,
      activity: { spaces: {}, sessions: {} },
    });
  });

  it('sorts the first Spaces to arrive, without starting another visit', () => {
    renderHook(() => useHomeVisitTracking(true));
    expect(useHomeVisitStore.getState().visit).toBe(1);

    act(() => useSpaceStore.setState({ spaces: { a: space('a') } }));

    expect(useHomeVisitStore.getState().activity.spaces).toHaveProperty('a');
    expect(useHomeVisitStore.getState().visit).toBe(1);
  });

  it('then leaves the order alone for the rest of the visit', () => {
    renderHook(() => useHomeVisitTracking(true));
    act(() => useSpaceStore.setState({ spaces: { a: space('a', 1) } }));
    const sorted = useHomeVisitStore.getState().activity;

    act(() =>
      useSpaceStore.setState({
        spaces: { a: space('a', 99), b: space('b', 99) },
      })
    );

    expect(useHomeVisitStore.getState().activity).toBe(sorted);
  });

  it('waits for nothing when Spaces are already here', () => {
    useSpaceStore.setState({ spaces: { a: space('a') } });
    renderHook(() => useHomeVisitTracking(true));
    const sorted = useHomeVisitStore.getState().activity;
    expect(sorted.spaces).toHaveProperty('a');

    act(() =>
      useSpaceStore.setState({ spaces: { a: space('a'), b: space('b') } })
    );

    expect(useHomeVisitStore.getState().activity).toBe(sorted);
  });

  it('stops waiting when Home is left', () => {
    const { rerender } = renderHook(
      ({ selected }) => useHomeVisitTracking(selected),
      { initialProps: { selected: true } }
    );
    rerender({ selected: false });

    act(() => useSpaceStore.setState({ spaces: { a: space('a') } }));

    expect(useHomeVisitStore.getState().activity.spaces).toEqual({});
  });
});
