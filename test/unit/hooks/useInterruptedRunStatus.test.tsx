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
  actionableInterruptedRun,
  normalizeInterruptedRunState,
  useInterruptedRunStatus,
} from '@/hooks/useInterruptedRunStatus';
import { HostProvider } from '@/host';
import {
  DURABLE_RUN_STATUS_CHANGED_EVENT,
  notifyDurableRunStatusChanged,
} from '@/lib/events/durableRunEvents';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({ fetchGet: fetchGetMock }));

describe('useInterruptedRunStatus', () => {
  const listeners = new Map<string, (...args: any[]) => void>();
  const ipcRenderer = {
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      listeners.set(channel, listener);
    }),
    off: vi.fn((channel: string, listener: (...args: any[]) => void) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    }),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HostProvider host={{ electronAPI: null, ipcRenderer }}>
      {children}
    </HostProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    fetchGetMock.mockResolvedValue({ runs: [] });
  });

  it('normalizes state retained from the pre-map Fast Refresh shape', () => {
    expect(normalizeInterruptedRunState(null)).toEqual({});

    const legacyRun = {
      run_id: 'run_one',
      project_id: 'project_one',
      status: 'interrupted',
      updated_at: 123,
    };
    expect(normalizeInterruptedRunState(legacyRun)).toEqual({
      project_one: legacyRun,
    });
  });

  it('silently suppresses cloud-restored history from Run controls', () => {
    expect(
      actionableInterruptedRun({
        run_id: 'cloud_run',
        project_id: 'project_one',
        status: 'interrupted',
        updated_at: 123,
        origin: 'cloud_restore',
      })
    ).toBeNull();
  });

  it('keeps a local interrupted Run actionable', () => {
    const localRun = {
      run_id: 'local_run',
      project_id: 'project_one',
      status: 'interrupted',
      updated_at: 123,
      origin: 'local' as const,
      latest_attempt: { attempt_number: 1, status: 'interrupted' },
    };
    expect(actionableInterruptedRun(localRun)).toBe(localRun);
  });

  it('suppresses an interrupted admission that never created an Attempt', () => {
    expect(
      actionableInterruptedRun({
        run_id: 'orphaned_admission',
        project_id: 'project_one',
        status: 'interrupted',
        updated_at: 123,
        origin: 'local',
        latest_attempt: null,
      })
    ).toBeNull();
  });

  it('refreshes at lifecycle boundaries without installing a polling timer', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const { result } = renderHook(
      () => useInterruptedRunStatus('project_one'),
      { wrapper }
    );

    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    expect(intervalSpy).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(fetchGetMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      listeners.get('backend-ready')?.();
      await Promise.resolve();
    });
    expect(fetchGetMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      notifyDurableRunStatusChanged('project_one');
      await Promise.resolve();
    });
    expect(fetchGetMock).toHaveBeenCalledTimes(4);
    expect(result.current.run).toBeNull();

    intervalSpy.mockRestore();
  });

  it('ignores durable status notifications for another Project', async () => {
    renderHook(() => useInterruptedRunStatus('project_one'), { wrapper });
    await act(async () => {
      await Promise.resolve();
      window.dispatchEvent(
        new CustomEvent(DURABLE_RUN_STATUS_CHANGED_EVENT, {
          detail: { projectId: 'project_two' },
        })
      );
      await Promise.resolve();
    });
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces overlapping refreshes for the same Project', async () => {
    let resolveRequest!: (value: unknown) => void;
    fetchGetMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    const { result } = renderHook(
      () => useInterruptedRunStatus('project_one'),
      { wrapper }
    );

    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    act(() => {
      void result.current.refresh();
      window.dispatchEvent(new Event('focus'));
      listeners.get('backend-ready')?.();
    });
    expect(fetchGetMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest({ runs: [] });
      await Promise.resolve();
    });
  });
});
