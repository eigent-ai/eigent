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

import { useWorkspaceSavePoint } from '@/hooks/useWorkspaceSavePoint';
import {
  createWorkspaceSavePoint,
  fetchWorkspaceGitStatus,
} from '@/service/workspaceGitApi';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/service/workspaceGitApi', () => ({
  fetchWorkspaceGitStatus: vi.fn(),
  bootstrapWorkspaceGit: vi.fn(),
  createWorkspaceSavePoint: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const localSpace = {
  id: 'space-1',
  name: 'Local Space',
  sourceType: 'folder',
  rootPath: '/tmp/space-1',
  status: 'active',
  metadata: {},
  createdAt: 1,
  updatedAt: 1,
} as any;

const status = {
  space_id: 'space-1',
  enabled: true,
  state: 'ready',
  managed_paths: ['report.md'],
  pending_managed_paths: ['report.md'],
  pending_managed_paths_truncated: false,
  diagnostics: {
    healthy: true,
    issues: [],
    repo_state: {
      head_oid: 'a'.repeat(40),
      branch_or_detached_head: 'main',
      index_digest: 'b'.repeat(64),
      operation_state: 'clean',
      digest: 'c'.repeat(64),
    },
  },
};

describe('useWorkspaceSavePoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchWorkspaceGitStatus).mockResolvedValue(status);
    vi.mocked(createWorkspaceSavePoint).mockResolvedValue({
      checkpoint_id: 'checkpoint_123',
      repository_id: 'repo-1',
      commit_oid: 'd'.repeat(40),
      parent_oid: 'a'.repeat(40),
      paths: ['report.md'],
      remaining_managed_changes: false,
      created_at: 1,
    });
  });

  it('does not poll and loads status only on demand', async () => {
    const { result } = renderHook(() =>
      useWorkspaceSavePoint({
        spaceId: 'space-1',
        space: localSpace,
        email: 'user@example.com',
        userId: 7,
      })
    );

    expect(fetchWorkspaceGitStatus).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.loadStatus();
    });

    expect(fetchWorkspaceGitStatus).toHaveBeenCalledTimes(1);
    expect(result.current.status?.pending_managed_paths).toEqual(['report.md']);
  });

  it('creates a save point from a freshly read RepoStateToken', async () => {
    const { result } = renderHook(() =>
      useWorkspaceSavePoint({
        spaceId: 'space-1',
        space: localSpace,
        email: 'user@example.com',
        userId: 7,
      })
    );

    await act(async () => {
      await result.current.save();
    });

    expect(createWorkspaceSavePoint).toHaveBeenCalledTimes(1);
    expect(createWorkspaceSavePoint).toHaveBeenCalledWith(
      'space-1',
      { email: 'user@example.com', userId: 7 },
      expect.objectContaining({
        expectedRepoStateDigest: 'c'.repeat(64),
        actorId: '7',
      })
    );
    expect(fetchWorkspaceGitStatus).toHaveBeenCalledTimes(2);
  });

  it('registers one global shortcut and ignores editable targets', async () => {
    renderHook(() =>
      useWorkspaceSavePoint({
        spaceId: 'space-1',
        space: localSpace,
        email: 'user@example.com',
        userId: 7,
        shortcut: true,
      })
    );
    const input = document.createElement('input');
    document.body.appendChild(input);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          metaKey: true,
          bubbles: true,
        })
      );
      await Promise.resolve();
    });
    expect(fetchWorkspaceGitStatus).not.toHaveBeenCalled();

    await act(async () => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          metaKey: true,
          bubbles: true,
        })
      );
      await vi.waitFor(() => {
        expect(createWorkspaceSavePoint).toHaveBeenCalledTimes(1);
      });
    });
    input.remove();
  });
});
