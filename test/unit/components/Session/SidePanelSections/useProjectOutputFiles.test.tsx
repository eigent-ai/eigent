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
  mergeProjectFiles,
  type SessionFileItem,
} from '@/components/Session/SidePanel/sections/buildProjectSessionPanelData';
import { useProjectOutputFiles } from '@/components/Session/SidePanel/sections/useProjectOutputFiles';
import { HostProvider } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { ChatTaskStatus } from '@/types/constants';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileReader } from '../../../../../electron/main/fileReader';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '') },
  BrowserWindow: class BrowserWindow {},
}));

const { fetchGetMock, getBaseURLMock, invokeMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  getBaseURLMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  getBaseURL: getBaseURLMock,
}));

describe('useProjectOutputFiles', () => {
  const host = {
    electronAPI: null,
    ipcRenderer: { invoke: invokeMock },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HostProvider host={host}>{children}</HostProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ email: 'person@example.com', user_id: 7 });
    getBaseURLMock.mockResolvedValue('http://localhost:5001');
    fetchGetMock.mockResolvedValue([]);
    invokeMock.mockResolvedValue([
      {
        name: 'report.md',
        type: 'md',
        path: '/workspace/report.md',
        relativePath: 'report.md',
      },
    ]);
  });

  it('loads on meaningful task transitions without polling or duplicate HTTP', async () => {
    const pendingLocalLists: Array<(value: unknown) => void> = [];
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingLocalLists.push(resolve);
        })
    );
    const intervalSpy = vi.spyOn(window, 'setInterval');
    const { result, rerender } = renderHook(
      ({ status }) =>
        useProjectOutputFiles(
          'project_one',
          { status, taskAssigning: [] },
          'task_one'
        ),
      {
        wrapper,
        initialProps: { status: ChatTaskStatus.RUNNING },
      }
    );

    expect(invokeMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingLocalLists.shift()?.([
        {
          name: 'report.md',
          type: 'md',
          path: '/workspace/report.md',
          relativePath: 'report.md',
        },
      ]);
    });
    expect(result.current).toHaveLength(1);
    expect(fetchGetMock).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();

    rerender({ status: ChatTaskStatus.FINISHED });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      pendingLocalLists.shift()?.([
        {
          name: 'report.md',
          type: 'md',
          path: '/workspace/report.md',
          relativePath: 'report.md',
        },
      ]);
    });
    expect(fetchGetMock).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();

    intervalSpy.mockRestore();
  });

  it('resolves files from the owning Space workspace before legacy Project storage', async () => {
    invokeMock.mockImplementation((channel: string) => {
      if (channel === 'set-local-file-preview-roots') {
        return Promise.resolve({ success: true, roots: 1 });
      }
      if (channel === 'get-workspace-file-list') {
        return Promise.resolve([
          {
            name: 'report.md',
            type: 'md',
            path: '/workspace/space-one/report.md',
            relativePath: 'report.md',
          },
        ]);
      }
      return Promise.reject(new Error(`Unexpected IPC channel: ${channel}`));
    });

    const { result } = renderHook(
      () =>
        useProjectOutputFiles(
          'project_one',
          { status: ChatTaskStatus.FINISHED, taskAssigning: [] },
          'task_one',
          '/workspace/space-one',
          ['report.md']
        ),
      { wrapper }
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      'set-local-file-preview-roots',
      ['/workspace/space-one']
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'get-workspace-file-list',
      '/workspace/space-one',
      ['report.md']
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      'get-project-file-list',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(result.current[0].path).toBe('/workspace/space-one/report.md');
    expect(fetchGetMock).not.toHaveBeenCalled();
  });

  it('keeps a normal artifact previewable when the real resolver omits a directory symlink alias', async () => {
    const workspace = await realpath(
      await mkdtemp(path.join(tmpdir(), 'eigent-resolver-boundary-'))
    );
    let unmount = () => {};
    try {
      await mkdir(path.join(workspace, 'archive'));
      await writeFile(
        path.join(workspace, 'archive/frame.txt'),
        'synthetic archived frame'
      );
      await writeFile(
        path.join(workspace, 'final.mp4'),
        'resolver metadata fixture, not playable media'
      );
      await symlink(
        path.join(workspace, 'archive'),
        path.join(workspace, 'frames'),
        'junction'
      );
      const requested = ['final.mp4', 'frames/frame.txt'];
      const reader = new FileReader(null as never);
      invokeMock.mockImplementation(async (channel, root, paths) => {
        if (channel === 'set-local-file-preview-roots') {
          return { success: true, roots: 1 };
        }
        if (channel === 'get-workspace-file-list') {
          return reader.getWorkspaceFileList(root, paths);
        }
        throw new Error(`Unexpected IPC channel: ${channel}`);
      });
      const items: SessionFileItem[] = requested.map((relativePath, index) => ({
        id: `artifact-${index}`,
        file: {
          name: relativePath.split('/').at(-1) || '',
          path: relativePath,
          relativePath,
          type: index === 0 ? 'mp4' : 'txt',
          artifactId: `artifact-${index}`,
        },
        previewable: false,
        taskId: 'run-fixture',
        historical: false,
        createdAt: 1,
        updatedAt: 1,
      }));
      const originalItems = JSON.stringify(items);
      const view = renderHook(
        () =>
          useProjectOutputFiles(
            'project_one',
            { status: ChatTaskStatus.FINISHED, taskAssigning: [] },
            'run-fixture',
            workspace,
            requested
          ),
        { wrapper }
      );
      unmount = view.unmount;
      await act(async () => {});

      const merged = mergeProjectFiles(items, view.result.current);
      expect(merged[0]).toMatchObject({
        previewable: true,
        file: {
          relativePath: 'final.mp4',
          path: path.join(workspace, 'final.mp4'),
        },
      });
      expect(merged[1]).toEqual(items[1]);
      expect(view.result.current.map((file) => file.relativePath)).toEqual([
        'final.mp4',
      ]);
      expect(JSON.stringify(items)).toBe(originalItems);
      expectNoFallback();
    } finally {
      unmount();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('does not reload files for agent-only live status changes', async () => {
    const { rerender } = renderHook(
      ({ agentStatus }) =>
        useProjectOutputFiles(
          'project_one',
          {
            status: ChatTaskStatus.PAUSE,
            taskAssigning: [
              {
                agent_id: 'agent_one',
                status: agentStatus,
                tasks: [],
              } as Agent,
            ],
          },
          'task_one'
        ),
      {
        wrapper,
        initialProps: { agentStatus: 'running' },
      }
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    rerender({ agentStatus: 'completed' });
    await act(async () => Promise.resolve());

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(fetchGetMock).not.toHaveBeenCalled();
  });

  function outputPaths(count: number) {
    return Array.from(
      { length: count },
      (_, index) => `output/frame-${String(index).padStart(4, '0')}.png`
    );
  }

  function resolvedFiles(
    paths: readonly string[],
    root = '/workspace/space-one'
  ) {
    return paths.map((relativePath) => ({
      name: relativePath.split('/').at(-1) || '',
      type: 'png',
      path: `${root}/${relativePath}`,
      relativePath,
    }));
  }

  function mockWorkspaceResolver() {
    invokeMock.mockImplementation(async (channel, root, paths: string[]) => {
      if (channel === 'set-local-file-preview-roots') {
        return { success: true, roots: 1 };
      }
      if (channel === 'get-workspace-file-list') {
        // Model the existing Electron contract, independently of the renderer.
        if (!Array.isArray(paths) || paths.length > 500) {
          throw new Error('Invalid workspace file resolver request');
        }
        return resolvedFiles(paths, root).reverse();
      }
      throw new Error(`Unexpected IPC channel: ${channel}`);
    });
  }

  function renderWorkspace(paths: readonly string[]) {
    return renderHook(
      (props) =>
        useProjectOutputFiles(
          props.projectId,
          { status: ChatTaskStatus.RUNNING, taskAssigning: [] },
          'task_one',
          props.root,
          props.paths
        ),
      {
        wrapper,
        initialProps: {
          projectId: 'project_one',
          root: '/workspace/space-one',
          paths,
        },
      }
    );
  }

  function expectNoFallback() {
    expect(
      invokeMock.mock.calls.some(
        ([channel]) => channel === 'get-project-file-list'
      )
    ).toBe(false);
    expect(getBaseURLMock).not.toHaveBeenCalled();
    expect(fetchGetMock).not.toHaveBeenCalled();
  }

  it.each([0, 1, 499, 500, 501, 1001])(
    'resolves %i paths in ordered batches of at most 500',
    async (count) => {
      mockWorkspaceResolver();
      const paths = outputPaths(count);
      const { result } = renderWorkspace(paths);
      await act(async () => {});

      expect(result.current.map((file) => file.relativePath)).toEqual(paths);
      const calls = invokeMock.mock.calls.filter(
        ([channel]) => channel === 'get-workspace-file-list'
      );
      expect(calls).toHaveLength(Math.ceil(count / 500));
      expect(calls.flatMap((call) => call[2])).toEqual(paths);
      expect(calls.every((call) => call[2].length <= 500)).toBe(true);
      expectNoFallback();
    }
  );

  it('deduplicates before batching and keeps a stable sorted result', async () => {
    mockWorkspaceResolver();
    const paths = outputPaths(501).reverse();
    const requested = [...paths, ...paths, paths[0]];
    const { result } = renderWorkspace(requested);
    await act(async () => {});

    expect(result.current.map((file) => file.relativePath)).toEqual(
      outputPaths(501)
    );
    const calls = invokeMock.mock.calls.filter(
      ([channel]) => channel === 'get-workspace-file-list'
    );
    expect(calls.map((call) => call[2].length)).toEqual([500, 1]);
    expect(calls.flatMap((call) => call[2])).toEqual(paths);
    expect(requested).toEqual([...paths, ...paths, paths[0]]);
    expectNoFallback();
  });

  it('discards a successful first batch when the second batch fails, without fallback', async () => {
    mockWorkspaceResolver();
    const resolver = invokeMock.getMockImplementation()!;
    let batches = 0;
    invokeMock.mockImplementation(async (...args) => {
      if (args[0] === 'get-workspace-file-list' && ++batches === 2) {
        throw new Error('Preview file is outside the active workspace');
      }
      return resolver(...args);
    });
    const { result } = renderWorkspace(outputPaths(1001));
    await act(async () => {});

    expect(result.current).toEqual([]);
    expect(batches).toBe(2);
    expectNoFallback();
  });

  it('never splits a NUL-containing path into valid file identities', async () => {
    mockWorkspaceResolver();
    const { result } = renderWorkspace(['report.md\0secret.md']);
    await act(async () => {});

    expect(result.current).toEqual([]);
    expect(
      invokeMock.mock.calls.filter(
        ([channel]) => channel === 'get-workspace-file-list'
      )
    ).toEqual([]);
    expectNoFallback();
  });

  it.each([
    '../secret.txt',
    '/outside/report.md',
    'C:\\outside\\report.md',
    '%2e%2e/secret.txt',
    'https://example.test/report.md',
  ])('fails closed for invalid workspace identity %s', async (path) => {
    mockWorkspaceResolver();
    const { result } = renderWorkspace(['report.md', path]);
    await act(async () => {});
    expect(result.current).toEqual([]);
    expect(
      invokeMock.mock.calls.filter(
        ([channel]) => channel === 'get-workspace-file-list'
      )
    ).toEqual([]);
    expectNoFallback();
  });

  it.each([undefined, { success: false }, { success: true, roots: 0 }])(
    'requires successful workspace root registration (%j)',
    async (registration) => {
      invokeMock.mockResolvedValue(registration);
      const { result } = renderWorkspace(['report.md']);
      await act(async () => {});
      expect(result.current).toEqual([]);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expectNoFallback();
    }
  );

  it.each([
    null,
    { files: [] },
    [null],
    [{ name: 'report.md', type: 'md', path: '/workspace/space-one/report.md' }],
    [
      {
        name: 'unrequested.md',
        type: 'md',
        path: '/workspace/space-one/unrequested.md',
        relativePath: 'unrequested.md',
      },
    ],
    [
      {
        name: 'report.md',
        type: 'md',
        path: 'https://files.example/report.md',
        relativePath: 'report.md',
        isRemote: true,
      },
    ],
    [
      {
        name: 'report.md',
        type: 'md',
        path: 'report.md',
        relativePath: 'report.md',
      },
    ],
  ])(
    'rejects malformed or unrequested resolver results (%j)',
    async (batch) => {
      invokeMock.mockImplementation(async (channel) =>
        channel === 'set-local-file-preview-roots'
          ? { success: true, roots: 1 }
          : batch
      );
      const { result } = renderWorkspace(['report.md']);
      await act(async () => {});
      expect(result.current).toEqual([]);
      expectNoFallback();
    }
  );

  it('deduplicates identical results but rejects conflicting identities', async () => {
    const file = resolvedFiles(['report.md'])[0];
    invokeMock.mockImplementation(async (channel) =>
      channel === 'set-local-file-preview-roots'
        ? { success: true, roots: 1 }
        : [file, { ...file }]
    );
    const { result, rerender } = renderWorkspace(['report.md']);
    await act(async () => {});
    expect(result.current).toEqual([file]);

    invokeMock.mockImplementation(async (channel) =>
      channel === 'set-local-file-preview-roots'
        ? { success: true, roots: 1 }
        : [file, { ...file, path: '/workspace/space-one/other.md' }]
    );
    rerender({
      projectId: 'project_one',
      root: '/workspace/space-one',
      paths: ['report.md', 'other.md'],
    });
    await act(async () => {});
    expect(result.current).toEqual([]);
    expectNoFallback();
  });

  it('publishes all batches together and clears earlier results when a refresh fails', async () => {
    mockWorkspaceResolver();
    const { result, rerender } = renderWorkspace(outputPaths(1));
    await act(async () => {});
    expect(result.current).toHaveLength(1);

    const resolver = invokeMock.getMockImplementation()!;
    let rejectBatch: (reason: Error) => void = () => {};
    let batches = 0;
    invokeMock.mockImplementation(async (...args) => {
      if (args[0] === 'get-workspace-file-list' && ++batches === 2) {
        return new Promise((_, reject) => {
          rejectBatch = reject;
        });
      }
      return resolver(...args);
    });
    rerender({
      projectId: 'project_one',
      root: '/workspace/space-one',
      paths: outputPaths(501),
    });
    expect(result.current).toEqual([]);
    await act(async () => {});
    expect(batches).toBe(2);
    expect(result.current).toEqual([]);
    await act(async () => {
      rejectBatch(new Error('batch failed'));
    });
    expect(result.current).toEqual([]);
    expectNoFallback();
  });

  it.each(['registration', 'batch'])(
    'stops obsolete requests after pending %s when switching Spaces',
    async (pendingStage) => {
      mockWorkspaceResolver();
      const resolver = invokeMock.getMockImplementation()!;
      let completeOld: (value: unknown) => void = () => {};
      invokeMock.mockImplementation(async (...args) => {
        const oldRegistration =
          pendingStage === 'registration' &&
          args[0] === 'set-local-file-preview-roots' &&
          args[1][0] === '/workspace/space-one';
        const oldBatch =
          pendingStage === 'batch' &&
          args[0] === 'get-workspace-file-list' &&
          args[1] === '/workspace/space-one';
        if (oldRegistration || oldBatch) {
          return new Promise((resolve) => {
            completeOld = resolve;
          });
        }
        return resolver(...args);
      });
      const { result, rerender } = renderWorkspace(outputPaths(1001));
      await act(async () => {});
      rerender({
        projectId: 'project_two',
        root: '/workspace/space-two',
        paths: ['report.md'],
      });
      expect(result.current).toEqual([]);
      await act(async () => {});
      expect(result.current).toEqual(
        resolvedFiles(['report.md'], '/workspace/space-two')
      );
      const calls = invokeMock.mock.calls.length;
      await act(async () => {
        completeOld(
          pendingStage === 'registration'
            ? { success: true, roots: 1 }
            : resolvedFiles(outputPaths(500))
        );
      });
      expect(invokeMock).toHaveBeenCalledTimes(calls);
      expect(result.current).toEqual(
        resolvedFiles(['report.md'], '/workspace/space-two')
      );
      expectNoFallback();
    }
  );

  it('stops after unmount even if root registration rejects', async () => {
    let rejectRegistration: (reason: Error) => void = () => {};
    invokeMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRegistration = reject;
        })
    );
    const { unmount } = renderWorkspace(['report.md']);
    unmount();
    await act(async () => {
      rejectRegistration(new Error('registration rejected'));
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expectNoFallback();
  });

  it('does not revive a previous snapshot when returning to a Space before another lookup finishes', async () => {
    mockWorkspaceResolver();
    const paths = ['report.md'];
    const { result, rerender } = renderWorkspace(paths);
    await act(async () => {});
    expect(result.current).toHaveLength(1);

    const pending = new Map<string, (files: FileInfo[]) => void>();
    invokeMock.mockImplementation(async (channel, root) => {
      if (channel === 'set-local-file-preview-roots') {
        return { success: true, roots: 1 };
      }
      return new Promise<FileInfo[]>((resolve) => pending.set(root, resolve));
    });
    rerender({ projectId: 'project_two', root: '/workspace/space-two', paths });
    await act(async () => {});
    expect(result.current).toEqual([]);

    rerender({ projectId: 'project_one', root: '/workspace/space-one', paths });
    expect(result.current).toEqual([]);
    await act(async () => {});
    expect(result.current).toEqual([]);

    await act(async () => {
      pending.get('/workspace/space-two')?.(
        resolvedFiles(paths, '/workspace/space-two')
      );
    });
    expect(result.current).toEqual([]);
    await act(async () => {
      pending.get('/workspace/space-one')?.(resolvedFiles(paths));
    });
    expect(result.current).toEqual(resolvedFiles(paths));
    expectNoFallback();
  });

  it('treats an empty Electron file list as authoritative', async () => {
    invokeMock.mockResolvedValue([]);

    const { result } = renderHook(
      () =>
        useProjectOutputFiles(
          'project_one',
          { status: ChatTaskStatus.FINISHED, taskAssigning: [] },
          'task_one'
        ),
      { wrapper }
    );

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual([]);
    expect(fetchGetMock).not.toHaveBeenCalled();
  });

  it('falls back to Brain only when the Electron lookup fails', async () => {
    invokeMock.mockRejectedValue(new Error('IPC unavailable'));
    fetchGetMock.mockResolvedValue([
      {
        filename: 'remote-report.md',
        url: '/files/remote-report.md',
      },
    ]);

    const { result } = renderHook(
      () =>
        useProjectOutputFiles(
          'project_one',
          { status: ChatTaskStatus.FINISHED, taskAssigning: [] },
          'task_one'
        ),
      { wrapper }
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toEqual(
      expect.objectContaining({
        name: 'remote-report.md',
        isRemote: true,
      })
    );
    expect(result.current[0].relativePath).toBeUndefined();
  });

  it('preserves only explicit remote artifact identities', async () => {
    invokeMock.mockRejectedValue(new Error('IPC unavailable'));
    fetchGetMock.mockResolvedValue([
      {
        artifact_id: 'artifact-1',
        filename: 'remote-report.md',
        relative_path: 'reports/remote-report.md',
        url: '/files/remote-report.md',
      },
    ]);

    const { result } = renderHook(
      () =>
        useProjectOutputFiles(
          'project_one',
          { status: ChatTaskStatus.FINISHED, taskAssigning: [] },
          'task_one'
        ),
      { wrapper }
    );

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({
      artifactId: 'artifact-1',
      relativePath: 'reports/remote-report.md',
    });
  });
});
