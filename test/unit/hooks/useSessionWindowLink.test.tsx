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

const h = vi.hoisted(() => {
  const listeners = new Set<(message: unknown) => void>();
  return {
    post: vi.fn(),
    listeners,
    deliver: (message: unknown) => listeners.forEach((l) => l(message)),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    setIncomplete: vi.fn(),
    auth: { token: 't1', user_id: 7, email: 'a@x' } as Record<string, unknown>,
    authListeners: new Set<(state: Record<string, unknown>) => void>(),
  };
});

vi.mock('@/lib/sessionWindows', () => ({
  listOpenSessionWindows: vi.fn().mockResolvedValue(null),
  onSessionWindowMessage: (listener: (message: unknown) => void) => {
    h.listeners.add(listener);
    return () => h.listeners.delete(listener);
  },
  postSessionWindowMessage: h.post,
}));
vi.mock('@/lib/projectRuntimeHydration', () => ({
  ensureProjectRuntimeLoaded: h.ensureLoaded,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => h.auth,
    subscribe: (listener: (state: Record<string, unknown>) => void) => {
      h.authListeners.add(listener);
      return () => h.authListeners.delete(listener);
    },
  },
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: {
    getState: () => ({
      navLeadByProjectId: {},
      setHistoryLoadIncomplete: h.setIncomplete,
    }),
    subscribe: () => () => undefined,
  },
}));
vi.mock('@/store/sessionControlsStore', () => ({
  useSessionControlsStore: {
    getState: () => ({ request: null, refreshPinned: vi.fn() }),
    subscribe: () => () => undefined,
  },
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: {
    getState: () => ({ projectIdIndex: { p1: 's1', p2: 's1' } }),
    subscribe: () => () => undefined,
  },
}));

import {
  notifySessionWindowOfRun,
  useSessionWindowLink,
} from '@/hooks/useSessionWindows';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';

const target = { spaceId: 's1', projectId: 'p1' };
const setAuth = (next: Record<string, unknown>) =>
  act(() => h.authListeners.forEach((listener) => listener(next)));

describe('Session window link', () => {
  let close: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    h.listeners.clear();
    h.authListeners.clear();
    close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });
  afterEach(() => close.mockRestore());

  it('announces itself and answers a roll call', () => {
    renderHook(() => useSessionWindowLink(target));
    act(() => h.deliver({ type: 'who-is-open' }));
    expect(h.post).toHaveBeenCalledTimes(2);
    expect(h.post).toHaveBeenCalledWith({ type: 'opened', ...target });
  });

  it('reloads its Session when the main window started a Run for it', () => {
    renderHook(() => useSessionWindowLink(target));
    act(() =>
      h.deliver({ type: 'reload-session', spaceId: 's1', projectId: 'p2' })
    );
    expect(h.ensureLoaded).not.toHaveBeenCalled();
    act(() => h.deliver({ type: 'reload-session', ...target }));
    act(() => h.deliver({ type: 'reload-session', ...target }));
    expect(h.setIncomplete).toHaveBeenCalledWith('p1', true);
    // A second request while the first reload runs folds into it.
    expect(h.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  it('stays open on a token refresh and closes on sign-out or another account', () => {
    renderHook(() => useSessionWindowLink(target));
    setAuth({ token: 't2', user_id: 7, email: 'a@x' });
    expect(close).not.toHaveBeenCalled();
    setAuth({ token: null, user_id: 7, email: 'a@x' });
    expect(close).toHaveBeenCalledTimes(1);
    setAuth({ token: 't3', user_id: 8, email: 'b@x' });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('closes when the main window takes its Session back', () => {
    renderHook(() => useSessionWindowLink(target));
    act(() => h.deliver({ type: 'close-window', ...target }));
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('notifySessionWindowOfRun', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks only a Session that is open in its own window to reload', () => {
    useSessionWindowsStore.setState({ openProjectIds: ['p1'] });
    notifySessionWindowOfRun('p2');
    expect(h.post).not.toHaveBeenCalled();
    notifySessionWindowOfRun('p1');
    expect(h.post).toHaveBeenCalledWith({ type: 'reload-session', ...target });
  });
});
