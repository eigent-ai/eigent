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

import { useProjectEventStoreHydration } from '@/hooks/useProjectEventStoreHydration';
import { normalizeLocalRunEvent } from '@/lib/projector';
import {
  getProjectEventStore,
  resetProjectEventStoresForTests,
} from '@/store/projectEventStore';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(),
  loadOlder: vi.fn(),
}));

vi.mock('@/service/projectEventStoreHydration', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/service/projectEventStoreHydration')
    >();
  return {
    ...original,
    hydrateProjectEventStore: mocks.hydrate,
    loadOlderProjectChatHistory: mocks.loadOlder,
  };
});

const hydrated = {
  projectId: 'project-1',
  runCount: 0,
  eventCount: 0,
  pageCount: 1,
  byteCount: 0,
  eventsTruncated: false,
};

async function flushHydration(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useProjectEventStoreHydration', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    vi.useRealTimers();
    vi.resetAllMocks();
    resetProjectEventStoresForTests();
  });

  it('blocks automatic retries when the replay API is unsupported', async () => {
    vi.useFakeTimers();
    mocks.hydrate.mockRejectedValue(
      Object.assign(new Error('Not found'), {
        status: 404,
      })
    );

    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await flushHydration();

    expect(result.current).toMatchObject({
      status: 'error',
      errorCode: 'unsupported',
    });
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await flushHydration();
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
  });

  it('keeps bounded backoff for transient request failures', async () => {
    vi.useFakeTimers();
    mocks.hydrate
      .mockRejectedValueOnce(
        Object.assign(new Error('Unavailable'), {
          status: 503,
        })
      )
      .mockResolvedValueOnce(hydrated);

    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await flushHydration();

    expect(result.current.status).toBe('retrying');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flushHydration();

    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  it('allows an explicit retry even after a successful truncated hydration', async () => {
    const store = getProjectEventStore('project-1');
    store.replaceSnapshot({
      project_id: 'project-1',
      current_cursor: 0,
      runs: [],
      recent_events: [],
      events_truncated: true,
    });
    mocks.hydrate.mockResolvedValue(hydrated);
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({ projectId: 'project-1', enabled: true })
    );
    await flushHydration();
    expect(mocks.hydrate).not.toHaveBeenCalled();
    act(() => result.current.retry());
    await flushHydration();
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  });

  it('deduplicates older-page requests and aborts them when switching Sessions', async () => {
    mocks.hydrate.mockResolvedValue(hydrated);
    let resolve!: () => void;
    mocks.loadOlder.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const { result, rerender } = renderHook(
      ({ projectId }) =>
        useProjectEventStoreHydration({ projectId, enabled: true }),
      { initialProps: { projectId: 'project-1' } }
    );
    await flushHydration();
    let loading!: Promise<void>;
    act(() => {
      loading = result.current.loadOlder();
      void result.current.loadOlder();
    });
    expect(mocks.loadOlder).toHaveBeenCalledTimes(1);
    expect(result.current.isLoadingOlder).toBe(true);
    const signal = mocks.loadOlder.mock.calls[0][0].signal;
    rerender({ projectId: 'project-2' });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve();
      await loading;
    });
    expect(result.current.isLoadingOlder).toBe(false);
    expect(result.current.olderHistoryError).toBe(false);
  });

  it('keeps a failed older page retryable without restarting hydration', async () => {
    mocks.hydrate.mockResolvedValue(hydrated);
    mocks.loadOlder
      .mockRejectedValueOnce(new Error('Temporary read failure'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({ projectId: 'project-1', enabled: true })
    );
    await flushHydration();
    await act(async () => result.current.loadOlder());
    expect(result.current.olderHistoryError).toBe(true);
    await act(async () => result.current.loadOlder());
    expect(result.current.olderHistoryError).toBe(false);
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  });

  function seedOlderHistory() {
    const store = getProjectEventStore('project-1');
    const replacement = store.beginSnapshotReplacement()!;
    store.commitSnapshotReplacement(
      replacement,
      {
        project_id: 'project-1',
        current_cursor: 0,
        runs: [],
        recent_events: [],
        events_truncated: true,
      },
      { beforeByRun: { 'run-1': 4 }, runsTruncated: false }
    );
    return store;
  }

  it('automatically drains all older pages while keeping each request bounded', async () => {
    const store = seedOlderHistory();
    mocks.loadOlder.mockImplementation(async () => {
      const previous = store.getSnapshot().history!;
      store.prependChatHistory([], previous, {
        ...previous,
        beforeByRun: { 'run-1': previous.beforeByRun['run-1'] - 2 },
      });
    });
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await waitFor(() => expect(result.current.hasOlderHistory).toBe(false));
    expect(mocks.loadOlder).toHaveBeenCalledTimes(2);
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(result.current.isLoadingOlder).toBe(false);
    expect(result.current.eventsTruncated).toBe(false);
  });

  it('continues control history after display completes and exposes a failed batch for retry', async () => {
    const store = getProjectEventStore('project-1');
    const events = [1, 2].map((sequence) =>
      normalizeLocalRunEvent(
        {
          event_id: `control-event-${sequence}`,
          run_id: 'run-1',
          sequence,
          run_version: sequence,
          event_type:
            sequence === 1 ? 'interaction.requested' : 'legacy.terminal',
          payload:
            sequence === 1
              ? { interaction_id: 'question-1', prompt: 'Question' }
              : { content: 'Work' },
          created_at: 1_786_441_600 + sequence,
        },
        'project-1'
      )
    );
    store.commitSnapshotReplacement(
      store.beginSnapshotReplacement()!,
      {
        project_id: 'project-1',
        current_cursor: 0,
        recent_events: [events[1]],
        runs: [
          {
            run_id: 'run-1',
            status: 'waiting_for_user',
            expected_next_run_sequence: 3,
            updated_at: '2026-08-11T10:00:02.000Z',
            run_version: 2,
            origin: 'local',
          },
        ],
        events_truncated: true,
      },
      { beforeByRun: { 'run-1': 1 }, runsTruncated: false }
    );
    const history = store.getSnapshot().history!;
    store.prependChatHistory([events[0]], history, {
      ...history,
      beforeByRun: { 'run-1': 0 },
    });
    mocks.loadOlder
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementationOnce(async () => {
        expect(
          store.appendControlHistory(store.getControlReplayCursor()!, events, {
            'run-1': 2,
          })
        ).toBe(true);
      });
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({ projectId: 'project-1', enabled: true })
    );
    await waitFor(() => expect(result.current.olderHistoryError).toBe(true));
    expect(result.current.hasOlderHistory).toBe(true);
    expect(result.current.eventsTruncated).toBe(true);
    expect(mocks.loadOlder).toHaveBeenCalledTimes(1);
    expect(mocks.hydrate).not.toHaveBeenCalled();
    await act(async () => result.current.loadOlder());
    expect(mocks.loadOlder).toHaveBeenCalledTimes(2);
    expect(result.current.olderHistoryError).toBe(false);
    expect(result.current.hasOlderHistory).toBe(false);
    expect(result.current.eventsTruncated).toBe(false);
  });

  it('stops automatic history replay on a non-advancing cursor', async () => {
    seedOlderHistory();
    mocks.loadOlder.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await waitFor(() => expect(result.current.olderHistoryError).toBe(true));
    expect(mocks.loadOlder).toHaveBeenCalledTimes(1);
    expect(result.current.hasOlderHistory).toBe(true);
  });

  it('blocks repeated tail hydration after control overflow and permits an explicit fresh retry', async () => {
    const store = getProjectEventStore('project-1', { maxPendingControls: 1 });
    const events = [1, 2].map((sequence) =>
      normalizeLocalRunEvent(
        {
          event_id: `pending-event-${sequence}`,
          run_id: 'run-1',
          sequence,
          run_version: sequence,
          event_type: 'interaction.requested',
          payload: {
            interaction_id: `question-${sequence}`,
            prompt: 'Question',
          },
          created_at: 1_786_441_600 + sequence,
        },
        'project-1'
      )
    );
    store.commitSnapshotReplacement(
      store.beginSnapshotReplacement()!,
      {
        project_id: 'project-1',
        current_cursor: 0,
        recent_events: [events[1]],
        runs: [
          {
            run_id: 'run-1',
            status: 'waiting_for_user',
            expected_next_run_sequence: 3,
            updated_at: '2026-08-11T10:00:02.000Z',
            run_version: 2,
            origin: 'local',
          },
        ],
        events_truncated: true,
      },
      { beforeByRun: { 'run-1': 1 }, runsTruncated: false }
    );
    const history = store.getSnapshot().history!;
    store.prependChatHistory([events[0]], history, {
      ...history,
      beforeByRun: { 'run-1': 0 },
    });
    mocks.loadOlder.mockImplementation(async () => {
      expect(
        store.appendControlHistory(store.getControlReplayCursor()!, events, {
          'run-1': 2,
        })
      ).toBe(false);
      throw new Error('Control checkpoint overflow');
    });
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({ projectId: 'project-1', enabled: true })
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.errorCode).toBe('limit_exceeded');
    expect(result.current.olderHistoryError).toBe(false);
    expect(mocks.loadOlder).toHaveBeenCalledTimes(1);
    expect(mocks.hydrate).not.toHaveBeenCalled();
    act(() => store.setMode('shadow'));
    await flushHydration();
    expect(mocks.hydrate).not.toHaveBeenCalled();
    mocks.hydrate.mockImplementationOnce(async () => {
      store.replaceSnapshot({
        project_id: 'project-1',
        current_cursor: 0,
        recent_events: [events[0]],
      });
      return hydrated;
    });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().overflowed).toBe(false);
  });

  it('cancels automatic replay when disabled without showing a stuck loading state', async () => {
    seedOlderHistory();
    mocks.loadOlder.mockImplementation(
      () => new Promise<void>(() => undefined)
    );
    const { result, rerender } = renderHook(
      ({ enabled }) =>
        useProjectEventStoreHydration({
          projectId: 'project-1',
          enabled,
        }),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.isLoadingOlder).toBe(true));
    const signal = mocks.loadOlder.mock.calls[0][0].signal;
    rerender({ enabled: false });
    expect(signal.aborted).toBe(true);
    expect(result.current.isLoadingOlder).toBe(false);
    expect(result.current.olderHistoryError).toBe(false);
  });

  it('keeps a failed automatic page visible and resumes the remaining history on retry', async () => {
    const store = seedOlderHistory();
    mocks.loadOlder
      .mockRejectedValueOnce(new Error('Offline'))
      .mockImplementation(async () => {
        const previous = store.getSnapshot().history!;
        store.prependChatHistory([], previous, {
          ...previous,
          beforeByRun: { 'run-1': 0 },
        });
      });
    const { result } = renderHook(() =>
      useProjectEventStoreHydration({
        projectId: 'project-1',
        enabled: true,
      })
    );
    await waitFor(() => expect(result.current.olderHistoryError).toBe(true));
    expect(mocks.loadOlder).toHaveBeenCalledTimes(1);
    await act(async () => result.current.loadOlder());
    expect(result.current.hasOlderHistory).toBe(false);
    expect(result.current.olderHistoryError).toBe(false);
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it('does not carry a manual refresh into another already hydrated Session', async () => {
    for (const id of ['project-1', 'project-2'])
      getProjectEventStore(id).replaceSnapshot({
        project_id: id,
        current_cursor: 0,
        recent_events: [],
      });
    mocks.hydrate.mockResolvedValue(hydrated);
    const { result, rerender } = renderHook(
      ({ projectId }) =>
        useProjectEventStoreHydration({ projectId, enabled: true }),
      { initialProps: { projectId: 'project-1' } }
    );
    act(() => result.current.retry());
    await flushHydration();
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
    rerender({ projectId: 'project-2' });
    await flushHydration();
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  });
});
