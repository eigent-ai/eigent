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
  normalizeRunReviewPath,
  resetRunFileDiffStatsCache,
  resolveRunFilePreview,
  runFileReviewPath,
  RunFilesGroup,
  useRunFileInfo,
} from '@/components/ChatBox/TimelineModes/RunFiles';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type { ProjectedArtifact } from '@/lib/projector/types';
import { useAuthStore } from '@/store/authStore';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { SPACE_SCHEMA_VERSION, useSpaceStore } from '@/store/spaceStore';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchRunGitChanges } = vi.hoisted(() => ({
  mockFetchRunGitChanges: vi.fn(),
}));

vi.mock('@/store/authStore', () => {
  const state = {
    email: null as string | null,
    user_id: null as number | null,
    language: 'en-US',
  };
  const useAuthStore = Object.assign(
    <T,>(selector: (value: typeof state) => T) => selector(state),
    {
      getState: () => state,
      setState: (next: Partial<typeof state>) => Object.assign(state, next),
      subscribe: vi.fn(() => vi.fn()),
    }
  );

  return {
    authStore: useAuthStore,
    getAuthStore: () => state,
    getWorkerList: () => [],
    useAuthStore,
    useWorkerList: () => [],
  };
});

vi.mock('@/service/workspaceGitApi', () => ({
  fetchRunGitChanges: mockFetchRunGitChanges,
}));

const projectedArtifact: ProjectedArtifact = {
  artifactId: 'artifact-1',
  runId: 'run-1',
  name: 'report.csv',
  relativePath: 'reports/report.csv',
  changeType: 'generated',
  size: 10,
  modifiedAt: 1,
  uploadPolicy: 'agent_generated',
  localPathAvailable: true,
};

const realtimeArtifact: ChatArtifactNode = {
  id: 'artifact-event-1',
  eventId: 'artifact-event-1',
  projectId: 'project-1',
  runId: 'run-1',
  createdAt: '2026-08-20T00:00:00Z',
  runSequence: 1,
  cloudCursor: null,
  eventType: 'artifact.created',
  legacyStep: null,
  kind: 'artifact',
  operation: 'created',
  path: 'reports/report.csv',
  relativePath: 'reports/report.csv',
  name: 'report.csv',
};

function mockRunFileVisibility() {
  const activators = new Map<string, Array<() => void>>();
  vi.stubGlobal(
    'IntersectionObserver',
    class IntersectionObserverMock {
      private readonly callback: IntersectionObserverCallback;

      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
      }

      observe = (target: Element) => {
        const runId = target.parentElement?.dataset.runFilesGroup;
        if (!runId) return;
        const activate = () =>
          this.callback(
            [
              {
                isIntersecting: true,
                target,
              } as IntersectionObserverEntry,
            ],
            this as unknown as IntersectionObserver
          );
        activators.set(runId, [...(activators.get(runId) ?? []), activate]);
      };

      disconnect = vi.fn();
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '240px 0px';
      thresholds = [0];
    }
  );

  return {
    activators,
    activate(runId: string) {
      act(() => activators.get(runId)?.forEach((activate) => activate()));
    },
  };
}

describe('RunFiles capability boundary', () => {
  beforeEach(() => {
    mockFetchRunGitChanges.mockReset();
    resetRunFileDiffStatsCache();
    useAuthStore.setState({ email: '', user_id: null });
    usePageTabStore.setState({
      sessionPreviewProjectId: 'project-1',
      sessionPreviewByProject: {},
    });
    useSpaceStore.setState({
      activeSpaceId: 'space-active-other',
      spaces: {
        'space-1': {
          id: 'space-1',
          name: 'Space 1',
          sourceType: 'folder',
          rootPath: '/workspace/space-1',
          rootFingerprint: null,
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 1,
        },
        'space-active-other': {
          id: 'space-active-other',
          name: 'Other active Space',
          sourceType: 'folder',
          rootPath: '/workspace/wrong-active-space',
          rootFingerprint: null,
          status: 'active',
          schemaVersion: SPACE_SCHEMA_VERSION,
          createdAt: 1,
          updatedAt: 1,
        },
      },
      projectsBySpaceId: {
        'space-1': {
          'project-1': {
            id: 'project-1',
            spaceId: 'space-1',
            name: 'Project 1',
            status: 'active',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      projectIdIndex: { 'project-1': 'space-1' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not turn portable local or realtime identity into a file path', () => {
    const projected = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [projectedArtifact] })
    );
    const realtime = renderHook(() =>
      useRunFileInfo({ artifactNodes: [realtimeArtifact] })
    );

    expect(projected.result.current[0]).toMatchObject({
      path: '',
      relativePath: 'reports/report.csv',
      localPathAvailable: true,
    });
    expect(realtime.result.current[0]).toMatchObject({
      path: '',
      relativePath: 'reports/report.csv',
    });
    expect(runFileReviewPath(projected.result.current[0]!)).toBe(
      'reports/report.csv'
    );
    expect(runFileReviewPath(realtime.result.current[0]!)).toBe(
      'reports/report.csv'
    );
  });

  it('opens a changed file in preview using its Project Space root', () => {
    render(
      <RunFilesGroup projectedArtifacts={[projectedArtifact]} runId="run-1" />
    );

    const row = screen.getByTitle('reports/report.csv');
    expect(row).toHaveAttribute('data-artifact-preview', 'available');
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);

    const preview = getSessionPreviewSlice(usePageTabStore.getState());
    expect(preview.open).toBe(true);
    expect(preview.tabs).toHaveLength(1);
    expect(preview.tabs[0]).toMatchObject({
      type: 'file',
      file: {
        path: '/workspace/space-1/reports/report.csv',
        relativePath: 'reports/report.csv',
        localPathAvailable: true,
      },
    });
  });

  it('offers an explicit entry to review every change in the Run', () => {
    render(
      <RunFilesGroup projectedArtifacts={[projectedArtifact]} runId="run-1" />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(
      getSessionPreviewSlice(usePageTabStore.getState()).tabs[0]
    ).toMatchObject({
      type: 'review',
      title: 'Task review',
      reviewTarget: {
        scope: 'run',
        runId: 'run-1',
      },
    });
  });

  it('shows authoritative per-file and total line changes without an undo action', async () => {
    useAuthStore.setState({ email: 'reviewer@example.com', user_id: 7 });
    const visibility = mockRunFileVisibility();
    mockFetchRunGitChanges.mockResolvedValue({
      repository_id: 'repo-1',
      project_id: 'project-1',
      run_id: 'run-1',
      base_commit: 'base',
      target_commit: 'target',
      files: [
        {
          path: 'reports/report.csv',
          status: 'added',
          before_size: 0,
          after_size: 10,
          binary: false,
          added_lines: 12,
          removed_lines: 3,
        },
      ],
      totals: { added: 12, removed: 3 },
      truncated: false,
    });

    render(
      <RunFilesGroup
        projectedArtifacts={[projectedArtifact]}
        projectId="project-1"
        runId="run-1"
      />
    );

    await waitFor(() =>
      expect(visibility.activators.get('run-1')).toHaveLength(1)
    );
    visibility.activate('run-1');
    expect(await screen.findAllByText('+12')).toHaveLength(2);
    expect(screen.getAllByText('−3')).toHaveLength(2);
    expect(screen.getByText('Edited 1 file')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(mockFetchRunGitChanges).toHaveBeenCalledWith('run-1', 'space-1', {
      email: 'reviewer@example.com',
      userId: 7,
    });

    // A duplicate instance of the same Run shares the resolved request.
    render(
      <RunFilesGroup
        projectedArtifacts={[projectedArtifact]}
        projectId="project-1"
        runId="run-1"
      />
    );
    await waitFor(() =>
      expect(visibility.activators.get('run-1')).toHaveLength(2)
    );
    visibility.activate('run-1');
    await waitFor(() => expect(screen.getAllByText('+12')).toHaveLength(4));
    expect(mockFetchRunGitChanges).toHaveBeenCalledTimes(1);
  });

  it('loads stats only as distinct Run cards approach view', async () => {
    useAuthStore.setState({ email: 'reviewer@example.com', user_id: 7 });
    const visibility = mockRunFileVisibility();
    mockFetchRunGitChanges.mockImplementation(async (runId: string) => ({
      repository_id: 'repo-1',
      project_id: 'project-1',
      run_id: runId,
      base_commit: 'base',
      target_commit: 'target',
      files: [],
      totals: { added: 0, removed: 0 },
      truncated: false,
    }));

    render(
      <>
        <RunFilesGroup
          projectedArtifacts={[projectedArtifact]}
          projectId="project-1"
          runId="run-1"
        />
        <RunFilesGroup
          projectedArtifacts={[
            { ...projectedArtifact, artifactId: 'artifact-2', runId: 'run-2' },
          ]}
          projectId="project-1"
          runId="run-2"
        />
      </>
    );

    await waitFor(() => expect(visibility.activators.size).toBe(2));
    expect(mockFetchRunGitChanges).not.toHaveBeenCalled();

    visibility.activate('run-1');
    await waitFor(() =>
      expect(mockFetchRunGitChanges).toHaveBeenCalledTimes(1)
    );
    expect(mockFetchRunGitChanges).toHaveBeenLastCalledWith(
      'run-1',
      'space-1',
      { email: 'reviewer@example.com', userId: 7 }
    );

    visibility.activate('run-2');
    await waitFor(() =>
      expect(mockFetchRunGitChanges).toHaveBeenCalledTimes(2)
    );
    expect(mockFetchRunGitChanges).toHaveBeenLastCalledWith(
      'run-2',
      'space-1',
      { email: 'reviewer@example.com', userId: 7 }
    );
  });

  it('skips the Git request for legacy spaces that have no repository', async () => {
    useAuthStore.setState({ email: 'reviewer@example.com', user_id: 7 });
    const state = useSpaceStore.getState();
    useSpaceStore.setState({
      spaces: {
        ...state.spaces,
        legacy_space: {
          ...state.spaces['space-1'],
          id: 'legacy_space',
          name: 'Legacy Space',
        },
      },
      projectsBySpaceId: {
        ...state.projectsBySpaceId,
        legacy_space: {
          'legacy-project': {
            ...state.projectsBySpaceId['space-1']['project-1'],
            id: 'legacy-project',
            spaceId: 'legacy_space',
            name: 'Legacy project',
          },
        },
      },
      projectIdIndex: {
        ...state.projectIdIndex,
        'legacy-project': 'legacy_space',
      },
    });
    expect(
      useSpaceStore.getState().getProjectMeta('legacy-project')
    ).toMatchObject({ spaceId: 'legacy_space' });

    render(
      <RunFilesGroup
        projectedArtifacts={[projectedArtifact]}
        projectId="legacy-project"
        runId="run-1"
      />
    );

    expect(await screen.findByText('Edited 1 file')).toBeInTheDocument();
    expect(mockFetchRunGitChanges).not.toHaveBeenCalled();
  });

  it('uses the durable relative path for Cloud assets too', () => {
    const cloud = {
      ...projectedArtifact,
      localPathAvailable: false,
      assetRef: {
        chatFileId: 73,
        key: 'user/run/files/report.csv',
      },
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [cloud] })
    );

    expect(result.current[0]).toMatchObject({
      path: '',
      localPathAvailable: false,
      isRemote: true,
      assetRef: cloud.assetRef,
    });
    expect(runFileReviewPath(result.current[0]!)).toBe('reports/report.csv');
    expect(
      resolveRunFilePreview(result.current[0]!, '/workspace/space-1')
    ).toMatchObject({
      path: '/workspace/space-1/reports/report.csv',
      relativePath: 'reports/report.csv',
      localPathAvailable: true,
      isRemote: false,
      assetRef: cloud.assetRef,
    });
    expect(resolveRunFilePreview(result.current[0]!, null)).toBe(
      result.current[0]
    );
  });

  it('opens a Cloud-restored HTML Artifact through the local rich preview', () => {
    const cloudHtml = {
      ...projectedArtifact,
      artifactId: 'artifact-html',
      name: 'index.html',
      relativePath: 'P5/index.html',
      localPathAvailable: false,
      assetRef: {
        chatFileId: 74,
        key: 'user/run/files/P5/index.html',
      },
    } satisfies ProjectedArtifact;

    render(<RunFilesGroup projectedArtifacts={[cloudHtml]} runId="run-1" />);
    fireEvent.click(screen.getByTitle('P5/index.html'));

    expect(
      getSessionPreviewSlice(usePageTabStore.getState()).tabs[0]
    ).toMatchObject({
      type: 'file',
      file: {
        name: 'index.html',
        type: 'html',
        path: '/workspace/space-1/P5/index.html',
        relativePath: 'P5/index.html',
        localPathAvailable: true,
        isRemote: false,
      },
    });
  });

  it('does not manufacture local paths for Run review files', () => {
    const changed = {
      ...projectedArtifact,
      artifactId: 'artifact-2',
      name: 'notes.md',
      relativePath: 'notes.md',
      changeType: 'changed',
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [projectedArtifact, changed] })
    );

    expect(result.current.map((file) => file.path)).toEqual(['', '']);
    expect(result.current.map(runFileReviewPath)).toEqual([
      'reports/report.csv',
      'notes.md',
    ]);
  });

  it('uses a safe legacy Artifact path when relativePath is absent', () => {
    const pathOnlyArtifact = {
      ...realtimeArtifact,
      path: 'legacy/output.txt',
      relativePath: undefined,
      name: 'output.txt',
    } satisfies ChatArtifactNode;

    render(<RunFilesGroup artifactNodes={[pathOnlyArtifact]} runId="run-1" />);
    const row = screen.getByTitle('legacy/output.txt');
    expect(row).toHaveAttribute('data-artifact-preview', 'available');
    fireEvent.click(row);

    expect(
      getSessionPreviewSlice(usePageTabStore.getState()).tabs[0]
    ).toMatchObject({
      type: 'file',
      file: {
        path: '/workspace/space-1/legacy/output.txt',
        relativePath: 'legacy/output.txt',
      },
    });
  });

  it('rejects escaping paths before they reach the Run review API', () => {
    const unsafe = {
      ...projectedArtifact,
      relativePath: '../outside.txt',
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [unsafe] })
    );

    expect(runFileReviewPath(result.current[0]!)).toBeNull();
    expect(normalizeRunReviewPath('https://example.com/file.txt')).toBeNull();
    expect(normalizeRunReviewPath('%2e%2e/outside.txt')).toBeNull();
    expect(normalizeRunReviewPath('C:\\outside.txt')).toBeNull();
    expect(resolveRunFilePreview(result.current[0]!, '/workspace')).toBeNull();
  });
});
