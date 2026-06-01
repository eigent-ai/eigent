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

import { controlTask, sendProjectMessage } from '@web/api/brain';
import { describe, expect, it, vi } from 'vitest';

const sseTransport = vi.fn();
const fetchPut = vi.fn();

vi.mock('@/api/http', () => ({
  sseTransport: (...args: unknown[]) => sseTransport(...args),
  fetchPut: (...args: unknown[]) => fetchPut(...args),
  fetchGet: vi.fn(),
  uploadFileToBrain: vi.fn(),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({ email: 'user@example.com', token: 'token' }),
}));

describe('brain integration', () => {
  it('sends project message through SSE handler', () => {
    sseTransport.mockImplementation(({ onmessage, onclose }: any) => {
      onmessage({ data: JSON.stringify({ content: 'Working…' }) });
      onclose?.();
      return Promise.resolve();
    });

    const messages: unknown[] = [];
    let done = false;
    const taskId = sendProjectMessage({
      projectId: 'p1',
      question: 'Run task',
      onEvent: (payload) => messages.push(payload),
      onDone: () => {
        done = true;
      },
    });

    expect(taskId).toBeTruthy();
    expect(sseTransport).toHaveBeenCalled();
    const callBody = sseTransport.mock.calls[0][0].body;
    expect(callBody.api_key).toBe('token');
    expect(callBody.api_url).toContain('proxy.eigent.ai');
    expect(messages.length).toBeGreaterThan(0);
    expect(done).toBe(true);
  });

  it('pause/resume/stop task', async () => {
    fetchPut.mockResolvedValue({ code: 0 });
    await controlTask('task-1', 'pause');
    await controlTask('task-1', 'resume');
    await controlTask('task-1', 'stop');
    expect(fetchPut).toHaveBeenCalledTimes(3);
  });
});
