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

const channel = vi.hoisted(() => ({ post: vi.fn() }));
const space = vi.hoisted(() => {
  type State = { projectIdIndex: Record<string, string> };
  let state: State = { projectIdIndex: {} };
  const listeners = new Set<(next: State, previous: State) => void>();
  return {
    setIndex(projectIdIndex: Record<string, string>) {
      const previous = state;
      state = { projectIdIndex };
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

vi.mock('@/lib/sessionWindows', () => ({
  listOpenSessionWindows: vi.fn().mockResolvedValue(null),
  onSessionWindowMessage: vi.fn(() => () => undefined),
  postSessionWindowMessage: channel.post,
}));
vi.mock('@/store/spaceStore', () => ({ useSpaceStore: space.store }));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: { getState: () => ({ activeProjectId: null }) },
}));
vi.mock('@/store/sessionControlsStore', () => ({
  useSessionControlsStore: { getState: () => ({}) },
}));

import {
  DELETE_CONFIRM_DELAY_MS,
  useMainWindowSessionWindows,
} from '@/hooks/useSessionWindows';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';

const panes = () => useSessionSplitViewStore.getState().panesBySpaceId.one;

describe('main window Session deletion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    channel.post.mockClear();
    space.setIndex({ a: 'one', b: 'one' });
    useSessionSplitViewStore.setState({ panesBySpaceId: { one: ['a', 'b'] } });
    useSessionWindowsStore.setState({ openProjectIds: ['b'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a pane whose Session is recreated while its history reloads', () => {
    renderHook(() => useMainWindowSessionWindows());
    // loadProjectFromHistory: removeProject(id) then createProject(id).
    act(() => space.setIndex({ a: 'one' }));
    act(() => space.setIndex({ a: 'one', b: 'one' }));
    act(() => vi.advanceTimersByTime(DELETE_CONFIRM_DELAY_MS));
    expect(panes()).toEqual(['a', 'b']);
    expect(channel.post).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'close-window' })
    );
  });

  it('drops a deleted Session from the split and closes its window', () => {
    renderHook(() => useMainWindowSessionWindows());
    act(() => space.setIndex({ a: 'one' }));
    expect(panes()).toEqual(['a', 'b']);
    act(() => vi.advanceTimersByTime(DELETE_CONFIRM_DELAY_MS));
    expect(panes()).toBeUndefined();
    expect(channel.post).toHaveBeenCalledWith({
      type: 'close-window',
      spaceId: 'one',
      projectId: 'b',
    });
  });
});
