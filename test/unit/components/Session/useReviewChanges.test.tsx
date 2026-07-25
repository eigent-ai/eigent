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

import { useReviewChanges } from '@/components/Session/PreviewPanel/tabs/review/useReviewChanges';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFetchOverlays,
  mockReviewListBackups,
  mockHost,
  mockProjectRuntime,
} = vi.hoisted(() => {
  const reviewListBackups = vi.fn();
  return {
    mockFetchOverlays: vi.fn(),
    mockReviewListBackups: reviewListBackups,
    mockHost: {
      electronAPI: {
        readFile: vi.fn(),
        reviewListBackups,
      },
    },
    mockProjectRuntime: {
      getProjectById: () => ({
        id: 'project-1',
        spaceId: 'space-1',
        workdirMode: 'copy',
        metadata: { serverSynced: true },
      }),
      getAllChatStores: () => [],
    },
  };
});

vi.mock('@/host', () => ({
  useHost: () => mockHost,
}));

vi.mock('@/service/spaceApi', () => ({
  proxyFetchSpaceProjectOverlays: mockFetchOverlays,
}));

vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (state: unknown) => unknown) =>
    selector({ sessionPreviewProjectId: 'project-1' }),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: () => mockProjectRuntime,
}));

vi.mock('@/store/spaceStore', () => {
  const state = {
    activeSpaceId: 'space-1',
    getProjectMeta: () => ({
      id: 'project-1',
      spaceId: 'space-1',
      workdirMode: 'copy',
      metadata: { serverSynced: true },
    }),
    spaces: {
      'space-1': {
        id: 'space-1',
        sourceType: 'folder',
        rootPath: '/workspace',
      },
    },
  };
  return {
    useSpaceStore: (selector: (store: typeof state) => unknown) =>
      selector(state),
  };
});

describe('useReviewChanges', () => {
  beforeEach(() => {
    localStorage.removeItem('eigent-review-fixture');
    mockFetchOverlays.mockReset();
    mockReviewListBackups.mockReset();
    mockReviewListBackups.mockResolvedValue([
      {
        path: '/scratch/src/example.ts',
        exists: true,
        size: 120,
        backups: [
          { path: '/scratch/src/example.ts.20260722_120000.bak', size: 90 },
        ],
      },
    ]);
  });

  it('uses authoritative overlays and removes applied entries on refresh', async () => {
    mockFetchOverlays
      .mockResolvedValueOnce({
        space_id: 'space-1',
        project_id: 'project-1',
        overlays: [
          {
            id: 7,
            space_id: 'space-1',
            project_id: 'project-1',
            run_id: 'run-1',
            path: 'src/example.ts',
            status: 'modified',
            metadata: { source_path: '/scratch/src/example.ts' },
          },
        ],
      })
      .mockResolvedValueOnce({
        space_id: 'space-1',
        project_id: 'project-1',
        overlays: [],
      });

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetchOverlays).toHaveBeenCalledWith('space-1', 'project-1');
    expect(result.current.files).toEqual([
      {
        id: 'overlay:run-1:src/example.ts',
        path: 'src/example.ts',
        status: 'modified',
        absPath: '/scratch/src/example.ts',
        bakPath: '/scratch/src/example.ts.20260722_120000.bak',
        beforeUnavailable: false,
        tooLarge: false,
      },
    ]);
    expect(result.current.error).toBeNull();

    act(() => result.current.refresh());
    await waitFor(() => {
      expect(mockFetchOverlays).toHaveBeenCalledTimes(2);
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.files).toEqual([]);
  });

  it('flags a modified overlay with no surviving backup', async () => {
    mockReviewListBackups.mockResolvedValue([
      { path: '/scratch/src/example.ts', exists: true, size: 120, backups: [] },
    ]);
    mockFetchOverlays.mockResolvedValue({
      space_id: 'space-1',
      project_id: 'project-1',
      overlays: [
        {
          id: 7,
          space_id: 'space-1',
          project_id: 'project-1',
          run_id: 'run-1',
          path: 'src/example.ts',
          status: 'modified',
          metadata: { source_path: '/scratch/src/example.ts' },
        },
      ],
    });

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files[0]).toMatchObject({
      status: 'modified',
      bakPath: null,
      beforeUnavailable: true,
      tooLarge: false,
    });
  });

  it('marks a file too large when either side exceeds the diff limit', async () => {
    mockReviewListBackups.mockResolvedValue([
      {
        path: '/scratch/src/example.ts',
        exists: true,
        size: 5_000_000,
        backups: [
          { path: '/scratch/src/example.ts.20260722_120000.bak', size: 90 },
        ],
      },
    ]);
    mockFetchOverlays.mockResolvedValue({
      space_id: 'space-1',
      project_id: 'project-1',
      overlays: [
        {
          id: 7,
          space_id: 'space-1',
          project_id: 'project-1',
          run_id: 'run-1',
          path: 'src/example.ts',
          status: 'modified',
          metadata: { source_path: '/scratch/src/example.ts' },
        },
      ],
    });

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files[0]).toMatchObject({ tooLarge: true });
  });

  it('totals added and removed lines across every changed file', async () => {
    const before = 'a\nb\nc\n';
    const afterOne = 'a\nB\nc\nd\n'; // +2 −1
    const afterTwo = 'a\nb\nc\nd\ne\n'; // +2 −0
    const encode = (text: string) => new TextEncoder().encode(text);
    mockHost.electronAPI.readFile.mockImplementation((path: string) => {
      const body = path.endsWith('.bak')
        ? before
        : path.endsWith('one.ts')
          ? afterOne
          : afterTwo;
      return Promise.resolve({ success: true, data: encode(body) });
    });
    mockReviewListBackups.mockResolvedValue([
      {
        path: '/scratch/src/one.ts',
        exists: true,
        size: 120,
        backups: [
          { path: '/scratch/src/one.ts.20260722_120000.bak', size: 90 },
        ],
      },
      {
        path: '/scratch/src/two.ts',
        exists: true,
        size: 120,
        backups: [
          { path: '/scratch/src/two.ts.20260722_120000.bak', size: 90 },
        ],
      },
    ]);
    mockFetchOverlays.mockResolvedValue({
      space_id: 'space-1',
      project_id: 'project-1',
      overlays: ['one', 'two'].map((name, index) => ({
        id: index,
        space_id: 'space-1',
        project_id: 'project-1',
        run_id: 'run-1',
        path: `src/${name}.ts`,
        status: 'modified',
        metadata: { source_path: `/scratch/src/${name}.ts` },
      })),
    });

    const { result } = renderHook(() => useReviewChanges());

    // Totals start at zero for the empty initial file list, so wait for the
    // count that follows the scan rather than for the first non-null value.
    await waitFor(() =>
      expect(result.current.totals).toEqual({ added: 4, removed: 1 })
    );
  });

  it('reports a failed scan instead of an empty change set', async () => {
    mockFetchOverlays.mockRejectedValue(new Error('overlay service down'));

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('overlay service down');
    expect(result.current.files).toEqual([]);
  });
});
