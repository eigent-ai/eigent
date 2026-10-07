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

import { fetchGet, fetchPost } from '@/api/http';
import { prepareFollowUpAdmission } from '@/lib/legacyRuntimeAdmission';
import {
  closeIdleSSEConnectionsForTasks,
  getIdleSSETransportTaskId,
  waitForIdleSSEDisplayTail,
} from '@/store/chatStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn(), fetchPost: vi.fn() }));
vi.mock('@/store/chatStore', () => ({
  closeIdleSSEConnectionsForTasks: vi.fn(),
  getIdleSSETransportTaskId: vi.fn(),
  waitForIdleSSEDisplayTail: vi.fn(),
}));

const project = {
  chatStores: {
    primary: { getState: () => ({ tasks: { 'run-1': {} } }) },
  },
} as any;
const idleConsumer = {
  has_lock: true,
  status: 'done',
  run_id: 'run-1',
  consumer_alive: true,
};

describe('prepareFollowUpAdmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIdleSSETransportTaskId).mockReturnValue('run-1');
    vi.mocked(waitForIdleSSEDisplayTail).mockResolvedValue(undefined);
    vi.mocked(fetchPost).mockResolvedValue({
      retired: true,
      consumer_alive: false,
    });
  });

  it('leaves a busy consumer and the renderer streams untouched', async () => {
    vi.mocked(fetchGet).mockResolvedValue({
      ...idleConsumer,
      status: 'processing',
      subscriber_count: 1,
    });

    await expect(prepareFollowUpAdmission('project-1', project)).resolves.toBe(
      'busy'
    );
    expect(fetchPost).not.toHaveBeenCalled();
    expect(closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
  });

  it('retires a consumer Brain no longer streams to after its display tail', async () => {
    // The renderer still lists the stream, but Brain detached its subscriber.
    vi.mocked(fetchGet).mockResolvedValue({
      ...idleConsumer,
      subscriber_count: 0,
    });

    await expect(prepareFollowUpAdmission('project-1', project)).resolves.toBe(
      'cold'
    );
    expect(waitForIdleSSEDisplayTail).toHaveBeenCalledWith(['run-1']);
    expect(fetchPost).toHaveBeenCalledWith(
      '/chat/project-1/runtime/retire-idle',
      { run_id: 'run-1' },
      undefined,
      { signal: undefined }
    );
    expect(closeIdleSSEConnectionsForTasks).toHaveBeenCalledWith(['run-1']);
    const [tail] = vi.mocked(waitForIdleSSEDisplayTail).mock
      .invocationCallOrder;
    const [retire] = vi.mocked(fetchPost).mock.invocationCallOrder;
    const [close] = vi.mocked(closeIdleSSEConnectionsForTasks).mock
      .invocationCallOrder;
    expect(tail).toBeLessThan(retire);
    expect(retire).toBeLessThan(close);
  });

  it('fails closed when the idle consumer survives retirement', async () => {
    vi.mocked(getIdleSSETransportTaskId).mockReturnValue(null);
    vi.mocked(fetchGet).mockResolvedValue({
      ...idleConsumer,
      subscriber_count: 0,
    });
    vi.mocked(fetchPost).mockResolvedValue({ consumer_alive: true });

    await expect(
      prepareFollowUpAdmission('project-1', project)
    ).rejects.toThrow();
    expect(closeIdleSSEConnectionsForTasks).not.toHaveBeenCalled();
  });
});
