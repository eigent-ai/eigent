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

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_WORK_LOCK,
  useIsBackgroundWorkOwner,
} from '../../../src/hooks/useBackgroundWorkOwner';

function stubLocks() {
  const held: Array<() => void> = [];
  const request = vi.fn(
    (_name: string, _options: unknown, callback: () => Promise<void>) => {
      // Only the first requester gets the lock in this fake.
      if (held.length) return new Promise<void>(() => undefined);
      return callback();
    }
  );
  vi.stubGlobal('navigator', { ...navigator, locks: { request } });
  return { request, held };
}

describe('background work owner', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('never runs background work in a Session window', () => {
    window.location.hash = '#/session-window/space/project';
    const { request } = stubLocks();
    const { result } = renderHook(() => useIsBackgroundWorkOwner());
    expect(result.current).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('runs it in the main window once it holds the lock', async () => {
    const { request } = stubLocks();
    const { result, unmount } = renderHook(() => useIsBackgroundWorkOwner());
    await waitFor(() => expect(result.current).toBe(true));
    expect(request.mock.calls[0][0]).toBe(BACKGROUND_WORK_LOCK);
    unmount();
  });

  it('still runs background work when the lock request is refused', async () => {
    const request = vi.fn(() =>
      Promise.reject(new DOMException('opaque origin', 'SecurityError'))
    );
    vi.stubGlobal('navigator', { ...navigator, locks: { request } });
    const { result } = renderHook(() => useIsBackgroundWorkOwner());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('keeps today’s behaviour when the browser has no Web Locks', () => {
    vi.stubGlobal('navigator', { ...navigator, locks: undefined });
    const { result } = renderHook(() => useIsBackgroundWorkOwner());
    expect(result.current).toBe(true);
  });
});
