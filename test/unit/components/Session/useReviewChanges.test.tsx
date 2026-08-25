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
  collectChangedFilePaths,
  selectLatestReviewRunId,
} from '@/components/Session/PreviewPanel/tabs/review/reviewSources';
import {
  MAX_IMAGE_PREVIEW_BYTES,
  useReviewChanges,
} from '@/components/Session/PreviewPanel/tabs/review/useReviewChanges';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFetchOverlays,
  mockFetchGitChanges,
  mockFetchGitChangeBlob,
  mockFetchGitChangeContent,
  mockFetchRunGitChanges,
  mockFetchRunGitChangeBlob,
  mockFetchRunGitChangeContent,
  mockReviewListBackups,
  mockHost,
  mockProjectRuntime,
} = vi.hoisted(() => {
  const reviewListBackups = vi.fn();
  return {
    mockFetchOverlays: vi.fn(),
    mockFetchGitChanges: vi.fn(),
    mockFetchGitChangeBlob: vi.fn(),
    mockFetchGitChangeContent: vi.fn(),
    mockFetchRunGitChanges: vi.fn(),
    mockFetchRunGitChangeBlob: vi.fn(),
    mockFetchRunGitChangeContent: vi.fn(),
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

vi.mock('@/service/workspaceGitApi', () => ({
  fetchProjectGitChanges: mockFetchGitChanges,
  fetchProjectGitChangeBlob: mockFetchGitChangeBlob,
  fetchProjectGitChangeContent: mockFetchGitChangeContent,
  fetchRunGitChanges: mockFetchRunGitChanges,
  fetchRunGitChangeBlob: mockFetchRunGitChangeBlob,
  fetchRunGitChangeContent: mockFetchRunGitChangeContent,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (state: { email: string; user_id: number }) => unknown
  ) => selector({ email: 'user@example.com', user_id: 42 }),
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
    mockFetchGitChanges.mockReset();
    mockFetchGitChangeBlob.mockReset();
    mockFetchGitChangeContent.mockReset();
    mockFetchRunGitChanges.mockReset();
    mockFetchRunGitChangeBlob.mockReset();
    mockFetchRunGitChangeContent.mockReset();
    const missingGitState = Object.assign(new Error('Git state not found'), {
      status: 404,
    });
    mockFetchGitChanges.mockRejectedValue(missingGitState);
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

  it('limits direct-write recovery paths to the selected older Run', () => {
    const file = (name: string): FileInfo => ({
      name,
      type: 'txt',
      path: `/workspace/${name}`,
      relativePath: name,
    });

    expect(
      collectChangedFilePaths(
        [
          {
            tasks: {
              'run-1': { messages: [{ fileList: [file('run-one.txt')] }] },
              'run-2': { messages: [{ fileList: [file('run-two.txt')] }] },
            },
          },
        ],
        'run-1'
      )
    ).toEqual(['/workspace/run-one.txt']);
  });

  it('selects the newest task across the project chat stores', () => {
    expect(
      selectLatestReviewRunId([
        {
          tasks: { '100-run': undefined },
        },
        {
          tasks: {
            '200-run': undefined,
            '300-run': undefined,
          },
        },
      ])
    ).toBe('300-run');
  });

  it('keeps an empty latest-task target from loading all project changes', async () => {
    const { result } = renderHook(() =>
      useReviewChanges({ scope: 'run', focusRequestId: 0 })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files).toEqual([]);
    expect(mockFetchGitChanges).not.toHaveBeenCalled();
    expect(mockFetchRunGitChanges).not.toHaveBeenCalled();
  });

  it('uses Git as the primary source and lazily reads visible content', async () => {
    mockFetchGitChanges.mockResolvedValue({
      repository_id: 'repo-1',
      project_id: 'project-1',
      base_commit: 'a'.repeat(40),
      target_commit: 'b'.repeat(40),
      files: [
        {
          path: 'src/example.ts',
          status: 'modified',
          before_size: 8,
          after_size: 9,
          binary: false,
          added_lines: 2,
          removed_lines: 1,
        },
      ],
      totals: { added: 2, removed: 1 },
      truncated: false,
    });
    mockFetchGitChangeContent.mockResolvedValue({
      path: 'src/example.ts',
      base_commit: 'a'.repeat(40),
      target_commit: 'b'.repeat(40),
      before: {
        content: 'before\n',
        size: 8,
        binary: false,
        too_large: false,
      },
      after: {
        content: 'after\n',
        size: 7,
        binary: false,
        too_large: false,
      },
    });

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetchOverlays).not.toHaveBeenCalled();
    expect(result.current.totals).toEqual({ added: 2, removed: 1 });
    expect(result.current.files[0]).toMatchObject({
      id: 'git:src/example.ts',
      path: 'src/example.ts',
      status: 'modified',
      binary: false,
      beforeSize: 8,
      afterSize: 9,
      tooLarge: false,
    });

    await expect(result.current.files[0].loadContent?.()).resolves.toEqual({
      original: 'before\n',
      modified: 'after\n',
    });
    expect(mockFetchGitChangeContent).toHaveBeenCalledWith(
      'project-1',
      'space-1',
      { email: 'user@example.com', userId: 42 },
      {
        path: 'src/example.ts',
        baseCommit: 'a'.repeat(40),
        targetCommit: 'b'.repeat(40),
      }
    );
  });

  it('lazily reads a Git-backed binary image from a pinned side', async () => {
    const image = new Blob(['png'], { type: 'image/png' });
    mockFetchGitChanges.mockResolvedValue({
      repository_id: 'repo-1',
      project_id: 'project-1',
      base_commit: 'a'.repeat(40),
      target_commit: 'b'.repeat(40),
      files: [
        {
          path: 'preview.png',
          status: 'added',
          before_size: null,
          after_size: 2_456_112,
          binary: true,
          added_lines: null,
          removed_lines: null,
        },
      ],
      totals: { added: 0, removed: 0 },
      truncated: false,
    });
    mockFetchGitChangeBlob.mockResolvedValue(image);

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files[0]).toMatchObject({
      tooLarge: false,
      previewTooLarge: false,
    });
    await expect(result.current.files[0].loadPreview?.('after')).resolves.toBe(
      image
    );
    expect(mockFetchGitChangeBlob).toHaveBeenCalledWith(
      'project-1',
      'space-1',
      { email: 'user@example.com', userId: 42 },
      {
        path: 'preview.png',
        side: 'after',
        baseCommit: 'a'.repeat(40),
        targetCommit: 'b'.repeat(40),
      }
    );
  });

  it('blocks only images above the dedicated preview budget', async () => {
    mockFetchGitChanges.mockResolvedValue({
      repository_id: 'repo-1',
      project_id: 'project-1',
      base_commit: 'a'.repeat(40),
      target_commit: 'b'.repeat(40),
      files: [
        {
          path: 'preview.png',
          status: 'added',
          before_size: null,
          after_size: MAX_IMAGE_PREVIEW_BYTES + 1,
          binary: true,
          added_lines: null,
          removed_lines: null,
        },
      ],
      totals: { added: 0, removed: 0 },
      truncated: false,
    });

    const { result } = renderHook(() => useReviewChanges());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.files[0]).toMatchObject({
      tooLarge: false,
      previewTooLarge: true,
    });
  });

  it('marks an open review stale when its pinned Git revision moves', async () => {
    mockFetchGitChanges.mockResolvedValue({
      repository_id: 'repo-1',
      project_id: 'project-1',
      base_commit: 'c'.repeat(40),
      target_commit: 'd'.repeat(40),
      files: [],
      totals: { added: 0, removed: 0 },
      truncated: false,
    });

    const { result } = renderHook(() =>
      useReviewChanges(
        { scope: 'project', focusRequestId: 0 },
        { baseCommit: 'a'.repeat(40), targetCommit: 'b'.repeat(40) }
      )
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stale).toBe(true);
    expect(result.current.files).toEqual([]);
    expect(result.current.reviewIdentity).toEqual({
      baseCommit: 'c'.repeat(40),
      targetCommit: 'd'.repeat(40),
    });
  });

  it('revalidates the pinned revision when the same Review tab is reopened', async () => {
    mockFetchGitChanges
      .mockResolvedValueOnce({
        repository_id: 'repo-1',
        project_id: 'project-1',
        base_commit: 'a'.repeat(40),
        target_commit: 'b'.repeat(40),
        files: [],
        totals: { added: 0, removed: 0 },
        truncated: false,
      })
      .mockResolvedValueOnce({
        repository_id: 'repo-1',
        project_id: 'project-1',
        base_commit: 'a'.repeat(40),
        target_commit: 'c'.repeat(40),
        files: [],
        totals: { added: 0, removed: 0 },
        truncated: false,
      });
    const pinned = {
      baseCommit: 'a'.repeat(40),
      targetCommit: 'b'.repeat(40),
    };

    const { result, rerender } = renderHook(
      ({ focusRequestId }: { focusRequestId: number }) =>
        useReviewChanges({ scope: 'project', focusRequestId }, pinned),
      { initialProps: { focusRequestId: 0 } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stale).toBe(false);

    rerender({ focusRequestId: 1 });
    await waitFor(() => expect(mockFetchGitChanges).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.stale).toBe(true));
  });

  it('uses a finalized Run Git range without falling back to Project data', async () => {
    mockFetchRunGitChanges.mockResolvedValue({
      repository_id: 'repo-1',
      project_id: 'project-1',
      run_id: 'run-1',
      base_commit: 'c'.repeat(40),
      target_commit: 'd'.repeat(40),
      files: [
        {
          path: 'src/run-only.ts',
          status: 'added',
          before_size: null,
          after_size: 8,
          binary: false,
          added_lines: 1,
          removed_lines: 0,
        },
      ],
      totals: { added: 1, removed: 0 },
      truncated: false,
    });
    mockFetchRunGitChangeContent.mockResolvedValue({
      run_id: 'run-1',
      project_id: 'project-1',
      path: 'src/run-only.ts',
      base_commit: 'c'.repeat(40),
      target_commit: 'd'.repeat(40),
      before: {
        content: null,
        size: null,
        binary: false,
        too_large: false,
      },
      after: {
        content: 'created\n',
        size: 8,
        binary: false,
        too_large: false,
      },
    });

    const { result } = renderHook(() =>
      useReviewChanges({
        scope: 'run',
        runId: 'run-1',
        focusPath: 'src/run-only.ts',
        focusRequestId: 1,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetchRunGitChanges).toHaveBeenCalledWith('run-1', 'space-1', {
      email: 'user@example.com',
      userId: 42,
    });
    expect(mockFetchGitChanges).not.toHaveBeenCalled();
    expect(mockFetchOverlays).not.toHaveBeenCalled();
    expect(result.current.files[0]).toMatchObject({
      id: 'run-git:run-1:src/run-only.ts',
      path: 'src/run-only.ts',
      status: 'added',
      beforeSize: null,
      afterSize: 8,
    });

    await expect(result.current.files[0].loadContent?.()).resolves.toEqual({
      original: '',
      modified: 'created\n',
    });
    expect(mockFetchRunGitChangeContent).toHaveBeenCalledWith(
      'run-1',
      'space-1',
      { email: 'user@example.com', userId: 42 },
      {
        path: 'src/run-only.ts',
        baseCommit: 'c'.repeat(40),
        targetCommit: 'd'.repeat(40),
      }
    );
  });

  it("recovers an older Run from only that Run's retained overlays", async () => {
    mockFetchRunGitChanges.mockRejectedValue(
      Object.assign(new Error('Run Git state not found'), { status: 404 })
    );
    mockReviewListBackups.mockResolvedValue([
      {
        path: '/scratch/src/run-one.ts',
        exists: true,
        size: 120,
        backups: [
          { path: '/scratch/src/run-one.ts.20260722_120000.bak', size: 90 },
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
          path: 'src/run-one.ts',
          status: 'modified',
          metadata: { source_path: '/scratch/src/run-one.ts' },
        },
        {
          id: 8,
          space_id: 'space-1',
          project_id: 'project-1',
          run_id: 'run-2',
          path: 'src/run-two.ts',
          status: 'modified',
          metadata: { source_path: '/scratch/src/run-two.ts' },
        },
      ],
    });

    const { result } = renderHook(() =>
      useReviewChanges({
        scope: 'run',
        runId: 'run-1',
        focusRequestId: 0,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.files).toHaveLength(1);
    expect(result.current.files[0]).toMatchObject({
      id: 'overlay:run-1:src/run-one.ts',
      path: 'src/run-one.ts',
    });
  });

  it('falls back to retained overlays when Run Git was never materialized', async () => {
    mockFetchRunGitChanges.mockResolvedValue({
      available: false,
      reason: 'run_git_not_materialized',
      run_id: 'run-1',
      project_id: 'project-1',
    });
    mockReviewListBackups.mockResolvedValue([]);
    mockFetchOverlays.mockResolvedValue({
      space_id: 'space-1',
      project_id: 'project-1',
      overlays: [],
    });

    const { result } = renderHook(() =>
      useReviewChanges({
        scope: 'run',
        runId: 'run-1',
        focusRequestId: 0,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockFetchOverlays).toHaveBeenCalledWith('space-1', 'project-1');
    expect(result.current.error).toBeNull();
  });

  it('falls back to live overlays while Run Git is still finalizing', async () => {
    mockFetchRunGitChanges.mockRejectedValue(
      Object.assign(new Error('Run changes are not finalized yet'), {
        status: 409,
      })
    );
    mockReviewListBackups.mockResolvedValue([
      {
        path: '/scratch/src/live.ts',
        exists: true,
        size: 120,
        backups: [
          { path: '/scratch/src/live.ts.20260722_120000.bak', size: 90 },
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
          path: 'src/live.ts',
          status: 'modified',
          metadata: { source_path: '/scratch/src/live.ts' },
        },
      ],
    });

    const { result } = renderHook(() =>
      useReviewChanges({
        scope: 'run',
        runId: 'run-1',
        focusRequestId: 0,
      })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.stale).toBe(false);
    expect(result.current.files).toEqual([
      expect.objectContaining({
        id: 'overlay:run-1:src/live.ts',
        path: 'src/live.ts',
        status: 'modified',
      }),
    ]);
    expect(mockFetchOverlays).toHaveBeenCalledWith('space-1', 'project-1');
  });

  it('does not fall back when a pinned Run revision becomes unavailable', async () => {
    mockFetchRunGitChanges.mockResolvedValue({
      available: false,
      reason: 'run_git_not_materialized',
      run_id: 'run-1',
      project_id: 'project-1',
    });

    const { result } = renderHook(() =>
      useReviewChanges(
        { scope: 'run', runId: 'run-1', focusRequestId: 0 },
        { baseCommit: 'a'.repeat(40), targetCommit: 'b'.repeat(40) }
      )
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stale).toBe(true);
    expect(result.current.files).toEqual([]);
    expect(mockFetchOverlays).not.toHaveBeenCalled();
    expect(mockReviewListBackups).not.toHaveBeenCalled();
  });

  it('does not fall back when a pinned Run Git range returns 404', async () => {
    mockFetchRunGitChanges.mockRejectedValue(
      Object.assign(new Error('Run Git state not found'), { status: 404 })
    );

    const { result } = renderHook(() =>
      useReviewChanges(
        { scope: 'run', runId: 'run-1', focusRequestId: 0 },
        { baseCommit: 'a'.repeat(40), targetCommit: 'b'.repeat(40) }
      )
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stale).toBe(true);
    expect(result.current.files).toEqual([]);
    expect(mockFetchOverlays).not.toHaveBeenCalled();
    expect(mockReviewListBackups).not.toHaveBeenCalled();
  });

  it('does not fall back while a pinned Run Git range is finalizing', async () => {
    mockFetchRunGitChanges.mockRejectedValue(
      Object.assign(new Error('Run changes are not finalized yet'), {
        status: 409,
      })
    );

    const { result } = renderHook(() =>
      useReviewChanges(
        { scope: 'run', runId: 'run-1', focusRequestId: 0 },
        { baseCommit: 'a'.repeat(40), targetCommit: 'b'.repeat(40) }
      )
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.stale).toBe(true);
    expect(result.current.files).toEqual([]);
    expect(mockFetchOverlays).not.toHaveBeenCalled();
    expect(mockReviewListBackups).not.toHaveBeenCalled();
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
        beforeSize: 90,
        afterSize: 120,
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
