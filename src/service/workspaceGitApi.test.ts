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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchGetMock, fetchPostMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  fetchPostMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  fetchPost: fetchPostMock,
}));

import {
  executeAdvancedGit,
  fetchWorkspaceGitHistory,
  previewAdvancedGit,
} from './workspaceGitApi';

describe('workspace Git advanced API', () => {
  beforeEach(() => {
    fetchGetMock.mockReset();
    fetchPostMock.mockReset();
  });

  it('loads bounded history for the authenticated local Space', async () => {
    const history = { repository_id: 'repo-1', commits: [] };
    fetchGetMock.mockResolvedValue(history);

    await expect(
      fetchWorkspaceGitHistory(
        'space/1',
        { email: 'user@example.com', userId: 42 },
        25
      )
    ).resolves.toBe(history);

    expect(fetchGetMock).toHaveBeenCalledWith('/spaces/space%2F1/git/history', {
      email: 'user@example.com',
      user_id: 42,
      limit: 25,
    });
  });

  it('keeps preview and exact confirmed execution on separate calls', async () => {
    fetchPostMock.mockResolvedValueOnce({ action_digest: 'a'.repeat(64) });
    fetchPostMock.mockResolvedValueOnce({ returncode: 0 });
    const identity = { email: 'user@example.com', userId: null };

    await previewAdvancedGit('space-1', identity, {
      operationRequestId: 'request-1',
      argv: ['reset', '--hard', 'HEAD~1'],
    });
    await executeAdvancedGit('space-1', identity, {
      operationRequestId: 'request-1',
      argv: ['reset', '--hard', 'HEAD~1'],
      expectedRepoStateDigest: 'b'.repeat(64),
      confirmedActionDigest: 'a'.repeat(64),
      actorId: 'user-1',
    });

    expect(fetchPostMock).toHaveBeenNthCalledWith(
      1,
      '/spaces/space-1/git/operations:preview',
      {
        email: 'user@example.com',
        operation_request_id: 'request-1',
        argv: ['reset', '--hard', 'HEAD~1'],
      }
    );
    expect(fetchPostMock).toHaveBeenNthCalledWith(
      2,
      '/spaces/space-1/git/operations',
      {
        email: 'user@example.com',
        operation_request_id: 'request-1',
        argv: ['reset', '--hard', 'HEAD~1'],
        expected_repo_state_digest: 'b'.repeat(64),
        confirmed_action_digest: 'a'.repeat(64),
        actor_id: 'user-1',
      }
    );
  });
});
