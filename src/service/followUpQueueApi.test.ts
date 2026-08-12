import { fetchDelete, fetchGet, fetchPost } from '@/api/http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelFollowUpRequest,
  createFollowUpRequest,
  listPendingFollowUpRequests,
  markFollowUpRequestAdmitted,
  prioritizeFollowUpRequest,
} from './followUpQueueApi';

vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
}));

describe('followUpQueueApi local Brain routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses local /projects routes without the Cloud /api/v1 prefix', async () => {
    vi.mocked(fetchPost).mockResolvedValue({});
    vi.mocked(fetchGet).mockResolvedValue({ items: [] });
    vi.mocked(fetchDelete).mockResolvedValue({});

    await createFollowUpRequest({
      projectId: 'project 1',
      requestId: 'request 1',
      content: 'Continue',
      attachmentPaths: ['/tmp/input.csv'],
    });
    await listPendingFollowUpRequests('project 1');
    await prioritizeFollowUpRequest('project 1', 'request 1');
    await markFollowUpRequestAdmitted('project 1', 'request 1', 'request 1');
    await cancelFollowUpRequest('project 1', 'request 1');

    expect(fetchPost).toHaveBeenNthCalledWith(
      1,
      '/projects/project%201/follow-ups',
      expect.objectContaining({ request_id: 'request 1' })
    );
    expect(fetchGet).toHaveBeenCalledWith('/projects/project%201/follow-ups');
    expect(fetchPost).toHaveBeenNthCalledWith(
      2,
      '/projects/project%201/follow-ups/request%201/send-now'
    );
    expect(fetchPost).toHaveBeenNthCalledWith(
      3,
      '/projects/project%201/follow-ups/request%201/admitted',
      { run_id: 'request 1' }
    );
    expect(fetchDelete).toHaveBeenCalledWith(
      '/projects/project%201/follow-ups/request%201'
    );
  });
});
