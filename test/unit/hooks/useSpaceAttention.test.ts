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
  mergeSpaceAttention,
  SPACE_ATTENTION_POLL_MS,
  useSpaceAttention,
} from '@/hooks/useSpaceAttention';
import { parseRunAttention } from '@/service/projectRunsApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ fetchRunAttention: vi.fn() }));

vi.mock('@/service/projectRunsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/projectRunsApi')>()),
  fetchRunAttention: api.fetchRunAttention,
}));

vi.mock('@/host', () => ({ useHost: () => null }));

describe('mergeSpaceAttention', () => {
  const projectIdIndex = {
    'session-1': 'space-a',
    'session-2': 'space-a',
    'session-3': 'space-b',
  };

  it('counts each Session once per Space at its strongest state', () => {
    expect(
      mergeSpaceAttention({
        brain: [
          { projectId: 'session-1', state: 'running' },
          { projectId: 'session-2', state: 'waiting' },
          { projectId: 'session-3', state: 'running' },
        ],
        liveKinds: { 'session-1': 'hitl', 'session-3': 'finished' },
        projectIdIndex,
      })
    ).toEqual({
      'space-a': { running: 0, waiting: 2 },
      'space-b': { running: 1, waiting: 0 },
    });
  });

  it('lets a loaded Session report before the Brain does', () => {
    expect(
      mergeSpaceAttention({
        brain: [],
        liveKinds: { 'session-3': 'running', 'session-1': 'idle' },
        projectIdIndex,
      })
    ).toEqual({ 'space-b': { running: 1, waiting: 0 } });
  });

  it('never lowers waiting to running', () => {
    expect(
      mergeSpaceAttention({
        brain: [{ projectId: 'session-1', state: 'waiting' }],
        liveKinds: { 'session-1': 'running' },
        projectIdIndex,
      })
    ).toEqual({ 'space-a': { running: 0, waiting: 1 } });
  });

  it('skips Sessions the index does not know', () => {
    expect(
      mergeSpaceAttention({
        brain: [{ projectId: 'stale', state: 'waiting' }],
        liveKinds: {},
        projectIdIndex,
      })
    ).toEqual({});
  });
});

describe('parseRunAttention', () => {
  it('keeps only well-formed rows', () => {
    expect(
      parseRunAttention([
        { project_id: 'a', state: 'running' },
        { project_id: 'b', state: 'waiting' },
        { project_id: 'c', state: 'done' },
        { project_id: '', state: 'running' },
        null,
      ])
    ).toEqual([
      { projectId: 'a', state: 'running' },
      { projectId: 'b', state: 'waiting' },
    ]);
    expect(parseRunAttention({ detail: 'Not Found' })).toEqual([]);
  });
});

describe('useSpaceAttention polling', () => {
  let visibility: DocumentVisibilityState = 'visible';
  let focused = true;

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    focused = true;
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
      () => visibility
    );
    vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
    api.fetchRunAttention.mockReset();
    api.fetchRunAttention.mockResolvedValue([
      { projectId: 'session-1', state: 'waiting' },
    ]);
    useSpaceStore.setState({ projectIdIndex: { 'session-1': 'space-a' } });
    useProjectRuntimeStore.setState({ navLeadByProjectId: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls every 5s while focused and pauses while hidden', async () => {
    const { result, unmount } = renderHook(() => useSpaceAttention());
    await act(async () => {});
    expect(api.fetchRunAttention).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ 'space-a': { running: 0, waiting: 1 } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPACE_ATTENTION_POLL_MS);
    });
    expect(api.fetchRunAttention).toHaveBeenCalledTimes(2);

    visibility = 'hidden';
    focused = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPACE_ATTENTION_POLL_MS * 3);
    });
    expect(api.fetchRunAttention).toHaveBeenCalledTimes(2);

    visibility = 'visible';
    focused = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(api.fetchRunAttention).toHaveBeenCalledTimes(3);
    unmount();
  });

  it('keeps the last answer when a read fails', async () => {
    const { result } = renderHook(() => useSpaceAttention());
    await act(async () => {});
    api.fetchRunAttention.mockRejectedValueOnce(new Error('restarting'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPACE_ATTENTION_POLL_MS);
    });

    expect(result.current).toEqual({ 'space-a': { running: 0, waiting: 1 } });
  });
});
