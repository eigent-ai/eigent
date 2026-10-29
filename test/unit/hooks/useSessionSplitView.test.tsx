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

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  type State = { activeProjectId: string | null };
  let state: State = { activeProjectId: null };
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    set(activeProjectId: string | null) {
      const previous = state;
      state = { activeProjectId };
      listeners.forEach((listener) => listener(state, previous));
    },
    store: {
      getState: () => state,
      subscribe: (listener: (next: State, previous: State) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: runtime.store,
}));
vi.mock('@/store/spaceStore', () => {
  const spaceOf: Record<string, string> = {
    a: 'one',
    b: 'one',
    c: 'one',
    x: 'two',
  };
  const state = {
    projectIdIndex: spaceOf,
    getProjectMeta: (id: string) =>
      spaceOf[id] ? { id, spaceId: spaceOf[id] } : null,
  };
  const useSpaceStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useSpaceStore.getState = () => state;
  return { useSpaceStore };
});

import {
  getSplitViewUnavailableReason,
  useSessionSplitFocusTracking,
  useVisibleSessionPanes,
} from '@/hooks/useSessionSplitView';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';

const panes = () => useSessionSplitViewStore.getState().panesBySpaceId.one;

describe('split view focus tracking', () => {
  beforeEach(() => {
    useSessionSplitViewStore.setState({ panesBySpaceId: { one: ['a', 'b'] } });
    useSessionWindowsStore.setState({ openProjectIds: [] });
    runtime.set('b');
  });

  it('puts a Session selected in the sidebar into the focused pane', () => {
    renderHook(() => useSessionSplitFocusTracking());
    act(() => runtime.set('c'));
    expect(panes()).toEqual(['a', 'c']);
  });

  it('moves focus between panes without changing them', () => {
    renderHook(() => useSessionSplitFocusTracking());
    act(() => runtime.set('a'));
    expect(panes()).toEqual(['a', 'b']);
  });

  it('leaves the split alone for a Session in another Space', () => {
    renderHook(() => useSessionSplitFocusTracking());
    act(() => runtime.set('x'));
    expect(panes()).toEqual(['a', 'b']);
  });

  it('hides panes whose Session is open in its own window', () => {
    useSessionWindowsStore.setState({ openProjectIds: ['b'] });
    const { result } = renderHook(() => useVisibleSessionPanes('one'));
    expect(result.current).toEqual(['a']);
  });

  it('keeps a pane while its Session is briefly missing from the Space', () => {
    useSessionSplitViewStore.setState({
      panesBySpaceId: { one: ['a', 'gone-for-now'] },
    });
    const { result } = renderHook(() => useVisibleSessionPanes('one'));
    expect(result.current).toEqual(['a', 'gone-for-now']);
  });
});

describe('split view availability', () => {
  const base = { anchorId: 'a', panes: [] as string[], windowedIds: [] };

  it('is available beside the open Session and for a Session already shown', () => {
    expect(
      getSplitViewUnavailableReason({ ...base, projectId: 'b' })
    ).toBeNull();
    expect(
      getSplitViewUnavailableReason({
        ...base,
        projectId: 'b',
        panes: ['a', 'b', 'c'],
      })
    ).toBeNull();
  });

  it('says why it is unavailable', () => {
    expect(
      getSplitViewUnavailableReason({ ...base, projectId: 'b', anchorId: null })
    ).toBe('no-session');
    expect(getSplitViewUnavailableReason({ ...base, projectId: 'a' })).toBe(
      'same'
    );
    expect(
      getSplitViewUnavailableReason({
        ...base,
        projectId: 'd',
        panes: ['a', 'b', 'c'],
      })
    ).toBe('full');
    expect(
      getSplitViewUnavailableReason({
        ...base,
        projectId: 'b',
        windowedIds: ['b'],
      })
    ).toBe('in-window');
  });
});
