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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const spaces = vi.hoisted(() => {
  type State = {
    projectIdIndex: Record<string, string>;
    getProjectMeta: (id: string) => { id: string; spaceId: string } | null;
  };
  const makeState = (projectIdIndex: Record<string, string>): State => ({
    projectIdIndex,
    getProjectMeta: (id) =>
      projectIdIndex[id] ? { id, spaceId: projectIdIndex[id] } : null,
  });
  const initial = { a: 'one', b: 'one', c: 'one', x: 'two' };
  let state = makeState(initial);
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    initial,
    set(projectIdIndex: Record<string, string>) {
      const previous = state;
      state = makeState(projectIdIndex);
      listeners.forEach((listener) => listener(state, previous));
    },
    getState: () => state,
    subscribe: (listener: (next: State, previous: State) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@/store/spaceStore', () => {
  const useSpaceStore = (
    selector: (s: ReturnType<typeof spaces.getState>) => unknown
  ) => selector(spaces.getState());
  useSpaceStore.getState = spaces.getState;
  useSpaceStore.subscribe = spaces.subscribe;
  return { useSpaceStore };
});

import {
  DELETE_CONFIRM_DELAY_MS,
  getSplitViewUnavailableReason,
  useForgetDeletedSplitSessions,
  useSessionSplitFocusTracking,
  useVisibleSessionPanes,
} from '@/hooks/useSessionSplitView';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';

const panes = () => useSessionSplitViewStore.getState().panesBySpaceId.one;

describe('split view focus tracking', () => {
  beforeEach(() => {
    useSessionSplitViewStore.setState({ panesBySpaceId: { one: ['a', 'b'] } });
    spaces.set(spaces.initial);
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

  it('keeps a pane while its Session is briefly missing from the Space', () => {
    useSessionSplitViewStore.setState({
      panesBySpaceId: { one: ['a', 'gone-for-now'] },
    });
    const { result } = renderHook(() => useVisibleSessionPanes('one'));
    expect(result.current).toEqual(['a', 'gone-for-now']);
  });
});

describe('deleted Sessions in split view', () => {
  const withoutA = Object.fromEntries(
    Object.entries(spaces.initial).filter(([id]) => id !== 'a')
  );

  beforeEach(() => {
    vi.useFakeTimers();
    useSessionSplitViewStore.setState({
      panesBySpaceId: { one: ['a', 'b', 'c'] },
    });
    spaces.set(spaces.initial);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a Session whose entry comes back while its history reloads', () => {
    renderHook(() => useForgetDeletedSplitSessions());
    act(() => spaces.set(withoutA));
    act(() => spaces.set(spaces.initial));
    act(() => vi.advanceTimersByTime(DELETE_CONFIRM_DELAY_MS));
    expect(panes()).toEqual(['a', 'b', 'c']);
  });

  it('forgets a Session that is still missing after the delay', () => {
    renderHook(() => useForgetDeletedSplitSessions());
    act(() => spaces.set(withoutA));
    act(() => vi.advanceTimersByTime(DELETE_CONFIRM_DELAY_MS - 1));
    expect(panes()).toEqual(['a', 'b', 'c']);
    act(() => vi.advanceTimersByTime(1));
    expect(panes()).toEqual(['b', 'c']);
  });
});

describe('split view availability', () => {
  const base = { anchorId: 'a', panes: [] as string[] };

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
  });
});
