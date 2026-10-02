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

import { fetchGet } from '@/api/http';
import { useAuthStore } from '@/store/authStore';
import {
  createChatStoreInstance,
  readTaskFailureFacts,
} from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { ChatTaskStatus } from '@/types/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchGet: vi.fn() }));
const fetchGetMock = vi.mocked(fetchGet);
function events() {
  return {
    run_id: 'failed-run',
    project_id: 'session',
    after_sequence: 0,
    next_sequence: 2,
    has_more: false,
    events: [
      {
        event_id: 'tool',
        run_id: 'failed-run',
        project_id: 'session',
        sequence: 1,
        event_type: 'tool.outcome_unknown',
        payload: { tool_call_id: 'send', tool_name: 'send_email' },
      },
      {
        event_id: 'failed',
        run_id: 'failed-run',
        project_id: 'session',
        sequence: 2,
        event_type: 'run.failed',
        payload: {},
      },
    ],
  };
}
function setup() {
  const owner = createChatStoreInstance();
  owner.getState().create('failed-run');
  owner.getState().setStatus('failed-run', ChatTaskStatus.FINISHED);
  owner.getState().setDurableRunStatus('failed-run', 'failed');
  useProjectStore.setState({ activeProjectId: 'session' });
  vi.spyOn(useProjectStore.getState(), 'getAllChatStores').mockImplementation(
    (id) => (id === 'session' ? [{ chatId: 'chat', chatStore: owner }] : [])
  );
  useAuthStore.setState({ user_id: 21 });
  return owner;
}
beforeEach(() => fetchGetMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('scoped Task failure presentation hydration', () => {
  it('reads on reopen without mutating Task history, status, or execution', async () => {
    const owner = setup();
    fetchGetMock.mockResolvedValue(events());
    const before = JSON.stringify(owner.getState().tasks);
    for (let reopen = 0; reopen < 2; reopen++) {
      const facts = await readTaskFailureFacts(
        owner,
        'session',
        'failed-run',
        new AbortController().signal
      );
      expect(facts).toMatchObject({
        finalResponse: 'absent',
        actions: [{ outcome: 'outcome_unknown' }],
      });
    }
    expect(JSON.stringify(owner.getState().tasks)).toBe(before);
    expect(
      fetchGetMock.mock.calls.every(
        ([path]) => path === '/runs/failed-run/events'
      )
    ).toBe(true);
    expect(fetchGetMock.mock.calls[0][3]).toMatchObject({
      expectedAccountKey: expect.stringContaining('id:21'),
    });
  });

  it.each(['account', 'navigation', 'cancel', 'delete', 'replace-owner'])(
    'ignores delayed reads after %s changes, including switching back',
    async (change) => {
      const owner = setup();
      const controller = new AbortController();
      let resolve!: (data: unknown) => void;
      fetchGetMock.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      );
      const read = readTaskFailureFacts(
        owner,
        'session',
        'failed-run',
        controller.signal
      );
      if (change === 'account') {
        useAuthStore.setState({ user_id: 22 });
        useAuthStore.setState({ user_id: 21 });
      }
      if (change === 'navigation') {
        useProjectStore.setState({ activeProjectId: 'other' });
        useProjectStore.setState({ activeProjectId: 'session' });
      }
      if (change === 'cancel') controller.abort();
      if (change === 'delete') owner.setState({ tasks: {} });
      if (change === 'replace-owner')
        useProjectStore.setState({ getAllChatStores: () => [] });
      resolve(events());
      expect(await read).toBeNull();
    }
  );

  it.each([
    'wrong scope',
    'gap',
    'missing terminal',
    'truncated',
    'malformed',
    'unavailable',
  ])('keeps %s evidence unverified', async (kind) => {
    const owner = setup();
    const response: any = events();
    if (kind === 'wrong scope') response.events[0].project_id = 'other';
    if (kind === 'gap') response.events[0].sequence = 2;
    if (kind === 'missing terminal') {
      response.events.pop();
      response.next_sequence = 1;
    }
    if (kind === 'truncated') response.truncated = true;
    if (kind === 'malformed') response.events[0].payload = [];
    if (kind === 'unavailable')
      fetchGetMock.mockRejectedValue(new Error('Offline'));
    else fetchGetMock.mockResolvedValue(response);
    expect(
      await readTaskFailureFacts(
        owner,
        'session',
        'failed-run',
        new AbortController().signal
      )
    ).toEqual({
      terminal: 'failed',
      finalResponse: 'unverified',
      actionsVerified: false,
      actions: [],
    });
  });

  it('clears already displayed facts on an account switch and stops observing on unmount', async () => {
    const owner = setup();
    fetchGetMock.mockResolvedValue(events());
    const onFacts = vi.fn();
    const stop = owner
      .getState()
      .observeTaskFailureFacts('failed-run', onFacts);
    await vi.waitFor(() =>
      expect(onFacts).toHaveBeenCalledWith(
        expect.objectContaining({ finalResponse: 'absent' })
      )
    );
    useAuthStore.setState({ user_id: 22 });
    expect(onFacts).toHaveBeenLastCalledWith(undefined);
    stop();
    onFacts.mockClear();
    useAuthStore.setState({ user_id: 21 });
    expect(onFacts).not.toHaveBeenCalled();
  });
});
