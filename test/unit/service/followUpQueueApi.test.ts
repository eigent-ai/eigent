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

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';
import {
  cancelFollowUpRequest,
  createFollowUpRequest,
  getRemoteFollowUpByCommandId,
  listPendingFollowUpRequests,
  listPendingRemoteFollowUpRequests,
  markFollowUpRequestAdmitted,
  prioritizeFollowUpRequest,
  terminalContinuationAdmissionRejection,
} from '@/service/followUpQueueApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
}));

describe('followUpQueueApi local Brain routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses local /projects routes without the Cloud /api/v1 prefix', async () => {
    // Single-record helpers validate their response at the transport boundary,
    // so these fixtures must be well formed even though this test only asserts
    // the request URLs.
    const record = {
      request_id: 'request 1',
      project_id: 'project 1',
      content: 'Continue',
      attachment_paths: [],
      delivery_mode: 'wait',
      status: 'pending',
      source: 'local',
      created_at: 0,
      updated_at: 0,
    };
    vi.mocked(fetchPost).mockResolvedValue(record);
    // The source-command route reads one record; the others read collections.
    vi.mocked(fetchGet).mockImplementation(async (url: string) =>
      url.startsWith('/follow-ups/source-command/') ? record : { items: [] }
    );
    vi.mocked(fetchDelete).mockResolvedValue(record);

    await createFollowUpRequest({
      projectId: 'project 1',
      requestId: 'request 1',
      content: 'Continue',
      attachmentPaths: ['/tmp/input.csv'],
    });
    await listPendingFollowUpRequests('project 1');
    await listPendingRemoteFollowUpRequests();
    await getRemoteFollowUpByCommandId('command 1');
    await prioritizeFollowUpRequest('project 1', 'request 1');
    await markFollowUpRequestAdmitted('project 1', 'request 1', 'request 1');
    await cancelFollowUpRequest('project 1', 'request 1');

    expect(fetchPost).toHaveBeenNthCalledWith(
      1,
      '/projects/project%201/follow-ups',
      expect.objectContaining({ request_id: 'request 1' })
    );
    expect(fetchGet).toHaveBeenCalledWith('/projects/project%201/follow-ups');
    expect(fetchGet).toHaveBeenCalledWith('/follow-ups/pending', {
      source: 'remote_control',
    });
    expect(fetchGet).toHaveBeenCalledWith(
      '/follow-ups/source-command/command%201'
    );
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

  it('classifies only permanent continuation failures as terminal', () => {
    expect(
      terminalContinuationAdmissionRejection({
        response: {
          data: {
            detail: {
              code: 'continuation_clarification_required',
              message: 'Say what should continue',
              interaction_type: 'continuation_clarification',
              project_state_version: 4,
            },
          },
        },
      })
    ).toEqual({
      code: 'continuation_clarification_required',
      message: 'Say what should continue',
      interaction_type: 'continuation_clarification',
      project_state_version: 4,
    });
    expect(
      terminalContinuationAdmissionRejection({
        response: {
          data: {
            detail: {
              code: 'follow_up_must_queue',
              interaction_type: 'continuation_clarification',
            },
          },
        },
      })
    ).toBeNull();
  });

  it('deduplicates concurrent pending-list reads without caching failures', async () => {
    vi.mocked(fetchPost).mockResolvedValue({
      request_id: 'request-2',
      content: 'New message',
    });
    vi.mocked(fetchGet).mockResolvedValueOnce({
      items: [{ request_id: 'request-1' }],
    });

    const [first, second] = await Promise.all([
      listPendingFollowUpRequests('cache-project'),
      listPendingFollowUpRequests('cache-project'),
    ]);

    expect(fetchGet).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);

    await createFollowUpRequest({
      projectId: 'cache-project',
      requestId: 'request-2',
      content: 'New message',
      attachmentPaths: [],
    });
    vi.mocked(fetchGet).mockRejectedValueOnce(new Error('Brain unavailable'));
    await expect(listPendingFollowUpRequests('cache-project')).rejects.toThrow(
      'Brain unavailable'
    );

    vi.mocked(fetchGet).mockResolvedValueOnce({ items: [] });
    await expect(listPendingFollowUpRequests('cache-project')).resolves.toEqual(
      []
    );
    expect(fetchGet).toHaveBeenCalledTimes(3);
  });
});
