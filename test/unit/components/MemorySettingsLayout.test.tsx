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

import Memory from '@/components/Settings/Memory';
import type { MemoryScopeState } from '@/service/memoryApi';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryApiMocks = vi.hoisted(() => ({
  listMemoryEntries: vi.fn(),
  listMemoryReconciliation: vi.fn(),
  listMemoryScopeSummaries: vi.fn(),
}));

vi.mock('@/service/memoryApi', () => ({
  archiveMemoryEntry: vi.fn(),
  confirmMemoryEntry: vi.fn(),
  consolidateMemoryScope: vi.fn(),
  createMemoryEntry: vi.fn(),
  listMemoryEntries: memoryApiMocks.listMemoryEntries,
  listMemoryReconciliation: memoryApiMocks.listMemoryReconciliation,
  listMemoryScopeSummaries: memoryApiMocks.listMemoryScopeSummaries,
  pinMemoryEntry: vi.fn(),
  resolveMemoryReconciliation: vi.fn(),
  restoreMemoryEntry: vi.fn(),
  updateMemoryEntry: vi.fn(),
  updateMemoryScopeSettings: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { user_id: number }) => unknown) =>
    selector({ user_id: 7 }),
}));

vi.mock('@/store/projectStore', () => ({
  useProjectStore: (
    selector: (state: { activeProjectId: string }) => unknown
  ) => selector({ activeProjectId: 'project-active' }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: { activeSpaceId: string }) => unknown) =>
    selector({ activeSpaceId: 'space-active' }),
}));

function scopeState(
  scopeType: 'space' | 'project',
  captureEnabled: boolean
): MemoryScopeState {
  return {
    scope_type: scopeType,
    scope_id: `${scopeType}-1`,
    owner_kind: 'desktop',
    revision: 1,
    capture_enabled: captureEnabled,
    use_enabled: true,
    sync_scope: 'full_memory',
    token_limit: 640,
    current_token_count: 0,
    consolidate_threshold: 0.75,
    processed_through_watermark: null,
    extractor_version: 'test',
    last_consolidated_at: null,
    last_error: null,
    updated_at: 1,
  };
}

describe('Memory settings layout', () => {
  beforeEach(() => {
    memoryApiMocks.listMemoryEntries.mockReset();
    memoryApiMocks.listMemoryReconciliation.mockReset();
    memoryApiMocks.listMemoryReconciliation.mockResolvedValue({ items: [] });
  });

  it('offers automatic extraction for the shared Space scope', async () => {
    memoryApiMocks.listMemoryEntries.mockResolvedValue({
      scope_state: scopeState('space', true),
      items: [],
      sync_status: {
        state: 'synced',
        pending_count: 0,
        blocked_count: 0,
        last_error: null,
        last_synced_at: 1,
      },
    });

    render(
      <Memory
        fixedScope={{ type: 'space', id: 'space-1' }}
        showScopeSelector={false}
      />
    );

    expect(await screen.findByText('Shared across this Space')).toBeVisible();
    expect(screen.getByText('Shared scope')).toBeVisible();
    expect(
      screen.getByText(/learn stable notes explicitly meant for this Space/)
    ).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Auto Memory' })).toBeChecked();
    expect(
      screen.getByRole('switch', { name: 'Use Space Memory' })
    ).toBeChecked();
    expect(
      screen.getByText('Up to date — no saved notes to sync yet')
    ).toBeVisible();
    expect(screen.getByText('No shared Memory yet')).toBeVisible();
    expect(screen.queryByLabelText('Search Memory')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View archived' })).toBeVisible();
  });

  it('keeps Auto Memory available for Session scope', async () => {
    memoryApiMocks.listMemoryEntries.mockResolvedValue({
      scope_state: scopeState('project', true),
      items: [],
      sync_status: {
        state: 'synced',
        pending_count: 0,
        blocked_count: 0,
        last_error: null,
        last_synced_at: 1,
      },
    });

    render(
      <Memory
        fixedScope={{ type: 'project', id: 'project-1' }}
        fixedScopeLabel="Launch plan"
        showScopeSelector={false}
      />
    );

    expect(
      await screen.findByText('Remembered for this Session')
    ).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Auto Memory' })).toBeChecked();
    expect(screen.getByText('Launch plan Memory')).toBeVisible();
    expect(screen.getByText('Saved Session Memory')).toBeVisible();
    expect(screen.getByText('No Session Memory yet')).toBeVisible();
  });
});
