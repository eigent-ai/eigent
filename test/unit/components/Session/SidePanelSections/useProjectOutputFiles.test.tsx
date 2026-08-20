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

import { useProjectOutputFiles } from '@/components/Session/SidePanel/sections/useProjectOutputFiles';
import { HostProvider } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { ChatTaskStatus } from '@/types/constants';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
