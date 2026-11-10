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

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/service/memoryApi', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listMemoryEntries: api.list,
  updateMemoryScopeSettings: api.update,
}));

import { useProjectMemorySetting } from './useProjectMemorySetting';

const state = {
  scope_type: 'project',
  scope_id: 'project-1',
  owner_kind: 'desktop',
  revision: 3,
  capture_enabled: true,
  use_enabled: true,
  sync_scope: 'full_memory',
  token_limit: 1024,
  current_token_count: 4,
  consolidate_threshold: 0.75,
  processed_through_watermark: null,
  extractor_version: 'memory-v2',
  last_consolidated_at: null,
  last_error: null,
  updated_at: 1,
};

describe('useProjectMemorySetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ scope_state: state, items: [] });
    api.update.mockResolvedValue({ ...state, revision: 4, use_enabled: false });
  });

  it('reads and updates the durable Project setting', async () => {
    const { result } = renderHook(() => useProjectMemorySetting('project-1'));
    await waitFor(() => expect(result.current.available).toBe(true));

    await act(async () => result.current.toggle());

    expect(api.list).toHaveBeenCalledWith('project', 'project-1', false);
    expect(api.update).toHaveBeenCalledWith('project', 'project-1', {
      expectedRevision: 3,
      useEnabled: false,
    });
    expect(result.current.enabled).toBe(false);
  });

  it('does not retain a stale response after switching Projects', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    api.list
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce({
        scope_state: { ...state, scope_id: 'project-2', use_enabled: false },
        items: [],
      });
    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectMemorySetting(projectId),
      { initialProps: { projectId: 'project-1' } }
    );

    rerender({ projectId: 'project-2' });
    await waitFor(() => expect(result.current.enabled).toBe(false));
    resolveFirst({ scope_state: state, items: [] });
    await act(async () => Promise.resolve());

    expect(result.current.enabled).toBe(false);
  });

  it('does not apply a stale toggle response after switching Projects', async () => {
    let resolveUpdate: (value: unknown) => void = () => undefined;
    api.update.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      })
    );
    api.list
      .mockResolvedValueOnce({ scope_state: state, items: [] })
      .mockResolvedValueOnce({
        scope_state: { ...state, scope_id: 'project-2', use_enabled: true },
        items: [],
      });
    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectMemorySetting(projectId),
      { initialProps: { projectId: 'project-1' } }
    );
    await waitFor(() => expect(result.current.available).toBe(true));

    let pendingToggle: Promise<void> = Promise.resolve();
    act(() => {
      pendingToggle = result.current.toggle();
    });
    rerender({ projectId: 'project-2' });
    await waitFor(() => expect(result.current.available).toBe(true));
    resolveUpdate({ ...state, revision: 4, use_enabled: false });
    await act(async () => pendingToggle);

    expect(result.current.enabled).toBe(true);
    expect(result.current.available).toBe(true);
  });
});
