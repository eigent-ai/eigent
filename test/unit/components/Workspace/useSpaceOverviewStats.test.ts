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

import { useSpaceOverviewStats } from '@/components/Workspace/SpaceOverview/useSpaceOverviewStats';
import type { Space } from '@/store/spaceStore';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  fetchTriggers: vi.fn(),
  fetchGitStatus: vi.fn(),
}));

vi.mock('@/api/http', () => ({ fetchGet: mocks.fetchGet }));
vi.mock('@/service/triggerApi', () => ({
  proxyFetchTriggers: mocks.fetchTriggers,
}));
vi.mock('@/service/workspaceGitApi', () => ({
  fetchWorkspaceGitStatus: mocks.fetchGitStatus,
}));

const space = (overrides: Partial<Space> = {}): Space => ({
  id: 'space-1',
  name: 'Product',
  sourceType: 'folder',
  rootPath: '/Users/fixture/product',
  status: 'active',
  schemaVersion: 1,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const identity = { email: 'fixture@example.test', userId: 7 };

describe('useSpaceOverviewStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchGet.mockResolvedValue([
      { filename: 'old.md', relativePath: 'old.md', modifiedAt: 10 },
      { filename: 'new.md', relativePath: 'out/new.md', modifiedAt: 30 },
      { filename: 'mid.md', relativePath: 'mid.md', modifiedAt: 20 },
    ]);
    mocks.fetchTriggers.mockResolvedValue({
      items: [
        { id: 1, project_id: 'session-1', status: 'active' },
        { id: 2, project_id: 'session-2', status: 'inactive' },
        { id: 3, project_id: 'other-space-session', status: 'active' },
      ],
    });
    mocks.fetchGitStatus.mockResolvedValue({
      enabled: true,
      pending_managed_paths: ['a.md', 'b.md'],
      pending_managed_paths_truncated: false,
      diagnostics: { repo_state: { branch_or_detached_head: 'main' } },
    });
  });

  it('counts the whole folder once and only this Space’s automations', async () => {
    const { result } = renderHook(() =>
      useSpaceOverviewStats(space(), ['session-1', 'session-2'], identity)
    );

    await waitFor(() => expect(result.current.versionHistory).not.toBeNull());
    expect(result.current).toEqual({
      files: {
        count: 3,
        recent: [
          { name: 'new.md', relativePath: 'out/new.md', modifiedAt: 30 },
          { name: 'mid.md', relativePath: 'mid.md', modifiedAt: 20 },
          { name: 'old.md', relativePath: 'old.md', modifiedAt: 10 },
        ],
      },
      automations: { total: 2, active: 1 },
      versionHistory: {
        enabled: true,
        branch: 'main',
        unsavedChanges: 2,
        unsavedChangesTruncated: false,
      },
    });
    expect(mocks.fetchGet).toHaveBeenCalledTimes(1);
    expect(mocks.fetchGet).toHaveBeenCalledWith(
      '/files',
      expect.objectContaining({ project_id: 'space-1', space_id: 'space-1' }),
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('sums each Session’s files for a cloud Space and skips version history', async () => {
    const { result } = renderHook(() =>
      useSpaceOverviewStats(
        space({ sourceType: 'blank', rootPath: null }),
        ['session-1', 'session-2'],
        identity
      )
    );

    await waitFor(() => expect(result.current.files?.count).toBe(6));
    expect(
      mocks.fetchGet.mock.calls.map(([, params]) => params.project_id)
    ).toEqual(['session-1', 'session-2']);
    expect(mocks.fetchGitStatus).not.toHaveBeenCalled();
    expect(result.current.versionHistory).toBeNull();
  });

  it('leaves only the failed count empty', async () => {
    mocks.fetchTriggers.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() =>
      useSpaceOverviewStats(space(), ['session-1'], identity)
    );

    await waitFor(() => expect(result.current.files).not.toBeNull());
    expect(result.current.files?.count).toBe(3);
    expect(result.current.automations).toBeNull();
  });

  it('keeps only the five most recently changed files', async () => {
    mocks.fetchGet.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        filename: `file-${index}.md`,
        relativePath: `file-${index}.md`,
        modifiedAt: index,
      }))
    );
    const { result } = renderHook(() =>
      useSpaceOverviewStats(space(), [], identity)
    );

    await waitFor(() => expect(result.current.files?.count).toBe(7));
    expect(result.current.files?.recent.map((file) => file.name)).toEqual([
      'file-6.md',
      'file-5.md',
      'file-4.md',
      'file-3.md',
      'file-2.md',
    ]);
  });
});
