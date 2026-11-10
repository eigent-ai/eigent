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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAppVersion from '../../../src/hooks/use-app-version';

const invokeMock = vi.fn();
const host: { ipcRenderer?: { invoke: typeof invokeMock } } = {};

vi.mock('@/host', () => ({
  useHost: () => host,
}));

describe('useAppVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    host.ipcRenderer = { invoke: invokeMock };
    // Default: return a never-resolving promise so effects don't crash
    invokeMock.mockReturnValue(new Promise(() => {}));
  });

  it('should return an empty string initially', () => {
    const { result } = renderHook(() => useAppVersion());
    expect(result.current).toBe('');
  });

  it('should set version on successful ipcRenderer invoke', async () => {
    invokeMock.mockResolvedValue('1.2.3');

    const { result } = renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(result.current).toBe('1.2.3');
    });

    expect(invokeMock).toHaveBeenCalledWith('get-app-version');
  });

  it('should set "Unknown" when ipcRenderer invoke rejects', async () => {
    invokeMock.mockRejectedValue(new Error('IPC failure'));

    const { result } = renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(result.current).toBe('Unknown');
    });
  });

  it('should handle unavailable ipcRenderer through the catch path', async () => {
    // Simulate the "not available" scenario via a rejecting invoke,
    // exercising the same .catch() path as a missing host surface
    invokeMock.mockRejectedValue(new Error('not available'));

    const { result } = renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(result.current).toBe('Unknown');
    });
  });

  it('should only call invoke once on mount', async () => {
    invokeMock.mockResolvedValue('2.0.0');

    renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledTimes(1);
    });
  });

  it('should call invoke with "get-app-version" channel', async () => {
    invokeMock.mockResolvedValue('3.0.0');

    renderHook(() => useAppVersion());

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('get-app-version');
    });
  });
});
