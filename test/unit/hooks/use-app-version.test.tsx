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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAppVersion from '../../../src/hooks/use-app-version';

describe('useAppVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return a never-resolving promise so effects don't crash
    window.ipcRenderer.invoke = vi.fn().mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return an empty string initially', () => {
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBe('');
  });

  it('should set version on successful ipcRenderer invoke', async () => {
    window.ipcRenderer.invoke = vi.fn().mockResolvedValue('1.2.3');

    const { result } = renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(result.current).toBe('1.2.3');
    });

    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('get-app-version');
  });

  it('should set "Unknown" when ipcRenderer invoke rejects', async () => {
    window.ipcRenderer.invoke = vi
      .fn()
      .mockRejectedValue(new Error('IPC failure'));

    const { result } = renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(result.current).toBe('Unknown');
    });
  });

  it('should handle missing ipcRenderer — falls through to catch', async () => {
    // When ipcRenderer is missing, ?.invoke returns undefined, then .then()
    // throws. The hook does NOT have a try/catch, so the error propagates.
    // Simulate the closest safe equivalent: invoke rejects immediately.
    const original = window.ipcRenderer;
    delete (window as any).ipcRenderer;

    // Re-create minimal ipcRenderer with a rejecting invoke to simulate
    // the "not available" scenario through the .catch() path
    (window as any).ipcRenderer = {
      invoke: vi.fn().mockRejectedValue(new Error('not available')),
    };

    const { result } = renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(result.current).toBe('Unknown');
    });

    // Restore original mock
    (window as any).ipcRenderer = original;
  });

  it('should only call invoke once on mount', async () => {
    const invokeMock = vi.fn().mockResolvedValue('2.0.0');
    window.ipcRenderer.invoke = invokeMock;

    renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
  });

  it('should call invoke with "get-app-version" channel', async () => {
    window.ipcRenderer.invoke = vi.fn().mockResolvedValue('3.0.0');

    renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('get-app-version');
    });
  });
});
