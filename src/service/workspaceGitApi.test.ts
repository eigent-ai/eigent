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

    expect(fetchGetMock).toHaveBeenCalledWith(
      '/api/v1/spaces/space%2F1/git/history',
      { email: 'user@example.com', user_id: 42, limit: 25 }
    );
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
      '/api/v1/spaces/space-1/git/operations:preview',
      {
        email: 'user@example.com',
        operation_request_id: 'request-1',
        argv: ['reset', '--hard', 'HEAD~1'],
      }
    );
    expect(fetchPostMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/spaces/space-1/git/operations',
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
