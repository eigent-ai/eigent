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
import {
  runDomainEventHub,
  runProjectionStore,
  type RunDomainEvent,
} from '@/lib/runEvents';
import { retainSessionPane } from '@/lib/sessionPaneLifetime';
import { useAuthStore } from '@/store/authStore';
import {
  createChatStoreInstance,
  injectHost,
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
  useAuthStore.setState({ user_id: 21, email: '' });
  return owner;
}

function receiptEvent(eventType = 'runtime.interrupted'): RunDomainEvent {
  return {
    schemaVersion: 1,
    deliveryMode: 'live',
    origin: 'local',
    category: 'lifecycle',
    eventId: 'receipt-terminal',
    projectId: 'session',
    runId: 'failed-run',
    runSequence: 2,
    runVersion: 2,
    cloudCursor: null,
    eventType,
    payload: {},
    legacyStep: null,
    createdAt: new Date().toISOString(),
    source: 'canonical',
    raw: null,
  };
}
beforeEach(() => fetchGetMock.mockReset());
afterEach(() => {
  injectHost(null);
  vi.restoreAllMocks();
});

describe('scoped Task failure presentation hydration', () => {
  it.each([
    ['run.failed', 'failed'],
    ['run.deadline_reached', 'timed_out'],
    ['run.interrupted', 'interrupted'],
    ['runtime.interrupted', 'interrupted'],
  ] as const)(
    'refreshes the live receipt when %s arrives after the legacy error',
    async (eventType, status) => {
      const owner = setup();
      owner.getState().setDurableRunStatus('failed-run', status);
      const complete = events();
      complete.events[0].event_type = 'tool.completed';
      complete.events[1].event_type = eventType;
      fetchGetMock.mockResolvedValueOnce({
        ...complete,
        events: complete.events.slice(0, 1),
        next_sequence: 1,
      });
      const onFacts = vi.fn();
      const stop = owner
        .getState()
        .observeTaskFailureFacts('failed-run', onFacts);
      try {
        await vi.waitFor(() =>
          expect(onFacts).toHaveBeenCalledWith(
            expect.objectContaining({ finalResponse: 'unverified' })
          )
        );
        fetchGetMock.mockResolvedValue(complete);
        runDomainEventHub.publish({
          ...receiptEvent(eventType),
          projectId: 'other-session',
        });
        runDomainEventHub.publish({
          ...receiptEvent(eventType),
          runId: 'other-run',
        });
        expect(fetchGetMock).toHaveBeenCalledTimes(1);
        runDomainEventHub.publish(receiptEvent(eventType));
        await vi.waitFor(() =>
          expect(onFacts).toHaveBeenLastCalledWith(
            expect.objectContaining({
              finalResponse: 'absent',
              actions: [expect.objectContaining({ outcome: 'completed' })],
            })
          )
        );
        expect(fetchGetMock).toHaveBeenCalledTimes(2);
      } finally {
        stop();
      }
    }
  );

  it('rereads a receipt if the durable interruption arrives during the initial read', async () => {
    const owner = setup();
    owner.getState().setDurableRunStatus('failed-run', 'interrupted');
    const complete = events();
    complete.events[1].event_type = 'runtime.interrupted';
    let resolve!: (value: unknown) => void;
    fetchGetMock
      .mockImplementationOnce(() => new Promise((done) => (resolve = done)))
      .mockResolvedValue(complete);
    const onFacts = vi.fn();
    const stop = owner
      .getState()
      .observeTaskFailureFacts('failed-run', onFacts);
    try {
      runDomainEventHub.publish(receiptEvent());
      expect(fetchGetMock).toHaveBeenCalledTimes(1);
      resolve({
        ...complete,
        events: complete.events.slice(0, 1),
        next_sequence: 1,
      });
      await vi.waitFor(() =>
        expect(onFacts).toHaveBeenLastCalledWith(
          expect.objectContaining({ finalResponse: 'absent' })
        )
      );
      expect(fetchGetMock).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it.each(['account', 'navigation', 'resume', 'unmount'])(
    'does not refresh or publish a late receipt after %s',
    async (change) => {
      const owner = setup();
      owner.getState().setDurableRunStatus('failed-run', 'interrupted');
      const page = events();
      page.events[1].event_type = 'runtime.interrupted';
      let resolve!: (value: unknown) => void;
      fetchGetMock.mockImplementation(
        () => new Promise((done) => (resolve = done))
      );
      const onFacts = vi.fn();
      const stop = owner
        .getState()
        .observeTaskFailureFacts('failed-run', onFacts);
      try {
        if (change === 'account') useAuthStore.setState({ user_id: 22 });
        if (change === 'navigation')
          useProjectStore.setState({ activeProjectId: 'other' });
        if (change === 'resume')
          owner.getState().setDurableRunStatus('failed-run', 'running');
        if (change === 'unmount') stop();
        onFacts.mockClear();
        runDomainEventHub.publish(receiptEvent());
        resolve(page);
        await Promise.resolve();
        await Promise.resolve();
        expect(fetchGetMock).toHaveBeenCalledTimes(1);
        expect(onFacts).not.toHaveBeenCalled();
      } finally {
        stop();
      }
    }
  );

  it.each(['run.interrupted', 'runtime.interrupted'])(
    'delivers %s action facts while recovering its file manifest',
    async (eventType) => {
      const owner = setup();
      owner.getState().setDurableRunStatus('failed-run', 'interrupted');
      useAuthStore.setState({ email: 'review@example.test' });
      injectHost({ electronAPI: null, ipcRenderer: { invoke: vi.fn() } });
      const page = events();
      page.events[0].event_type = 'tool.completed';
      page.events[0].payload = {
        tool_call_id: 'write',
        tool_name: 'shell_write_content_to_file',
      };
      page.events[1].event_type = eventType;
      fetchGetMock.mockImplementation(async (path) => {
        if (path === '/runs/failed-run/events') return page;
        if (path === '/files/changes')
          return {
            artifacts: [
              {
                path: '/workspace/u15/act.txt',
                relativePath: 'u15/act.txt',
              },
            ],
            scan_status: 'complete',
          };
        throw new Error(`Unexpected request: ${path}`);
      });
      const onFacts = vi.fn();
      const stop = owner
        .getState()
        .observeTaskFailureFacts('failed-run', onFacts);
      try {
        await vi.waitFor(() =>
          expect(onFacts).toHaveBeenLastCalledWith(
            expect.objectContaining({
              finalResponse: 'absent',
              actions: [
                expect.objectContaining({ id: 'write', outcome: 'completed' }),
              ],
            })
          )
        );
        expect(onFacts).not.toHaveBeenCalledWith(undefined);
        expect(owner.getState().tasks['failed-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'interrupted',
          artifactManifestFinalized: true,
          artifactManifestFiles: [
            expect.objectContaining({ relativePath: 'u15/act.txt' }),
          ],
        });
      } finally {
        stop();
      }
    }
  );

  it('retains interrupted action facts across unrelated store updates', async () => {
    const owner = setup();
    owner.getState().setDurableRunStatus('failed-run', 'interrupted');
    const page = events();
    page.events[1].event_type = 'runtime.interrupted';
    fetchGetMock.mockResolvedValue(page);
    const onFacts = vi.fn();
    const stop = owner
      .getState()
      .observeTaskFailureFacts('failed-run', onFacts);
    try {
      await vi.waitFor(() =>
        expect(onFacts).toHaveBeenCalledWith(
          expect.objectContaining({ finalResponse: 'absent' })
        )
      );
      onFacts.mockClear();
      owner.getState().setTaskInfo('failed-run', []);
      useProjectStore.setState({ activeProjectId: 'session' });
      expect(onFacts).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it.each(['account', 'navigation', 'resume', 'execution'])(
    'clears interrupted action facts after %s changes',
    async (change) => {
      const owner = setup();
      owner.getState().setDurableRunStatus('failed-run', 'interrupted');
      const page = events();
      page.events[1].event_type = 'runtime.interrupted';
      fetchGetMock.mockResolvedValue(page);
      const onFacts = vi.fn();
      const stop = owner
        .getState()
        .observeTaskFailureFacts('failed-run', onFacts);
      try {
        await vi.waitFor(() =>
          expect(onFacts).toHaveBeenCalledWith(
            expect.objectContaining({ finalResponse: 'absent' })
          )
        );
        if (change === 'account') useAuthStore.setState({ user_id: 22 });
        if (change === 'navigation')
          useProjectStore.setState({ activeProjectId: 'other' });
        if (change === 'resume')
          owner.getState().setDurableRunStatus('failed-run', 'running');
        if (change === 'execution')
          owner.getState().setExecutionId('failed-run', 'new-execution');
        expect(onFacts).toHaveBeenLastCalledWith(undefined);
      } finally {
        stop();
      }
    }
  );

  it.each(['run.interrupted', 'runtime.interrupted'])(
    'hydrates actions for %s without changing lifecycle',
    async (eventType) => {
      const owner = setup();
      owner.getState().setDurableRunStatus('failed-run', 'interrupted');
      const page = events();
      page.events[1].event_type = eventType;
      fetchGetMock.mockResolvedValue(page);
      const before = JSON.stringify(owner.getState().tasks);
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
      expect(JSON.stringify(owner.getState().tasks)).toBe(before);
    }
  );

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

  it('hydrates a timed-out Task with the reason recorded on its terminal event', async () => {
    const owner = setup();
    owner.getState().setDurableRunStatus('failed-run', 'timed_out');
    const page = events();
    page.events[1] = {
      ...page.events[1],
      event_type: 'run.deadline_reached',
      payload: {
        terminal_reason: 'deadline_exceeded',
        terminal_detail: 'persisted_run_deadline_reached',
      },
    };
    fetchGetMock.mockResolvedValue(page);
    expect(
      await readTaskFailureFacts(
        owner,
        'session',
        'failed-run',
        new AbortController().signal
      )
    ).toMatchObject({
      terminalReason: 'deadline_exceeded',
      finalResponse: 'absent',
    });
  });

  it('falls back to the Run summary reason for a stop event without one', async () => {
    const owner = setup();
    owner.getState().setDurableRunStatus('failed-run', 'timed_out');
    const page = events();
    page.events[1] = { ...page.events[1], event_type: 'run.deadline_reached' };
    fetchGetMock.mockResolvedValue(page);
    runProjectionStore.upsertRunSummaries('session', [
      {
        run_id: 'failed-run',
        project_id: 'session',
        status: 'timed_out',
        version: 1,
        updated_at: 1,
        terminal_reason: 'deadline_exceeded',
      },
    ]);
    try {
      expect(
        await readTaskFailureFacts(
          owner,
          'session',
          'failed-run',
          new AbortController().signal
        )
      ).toMatchObject({ terminalReason: 'deadline_exceeded' });
    } finally {
      runProjectionStore.clearProject('session');
    }
  });

  it('keeps failure evidence owned by a visible non-focused Session', async () => {
    const owner = setup();
    const release = retainSessionPane('session');
    fetchGetMock.mockResolvedValue(events());
    useProjectStore.setState({ activeProjectId: 'other' });
    try {
      expect(
        await readTaskFailureFacts(
          owner,
          'session',
          'failed-run',
          new AbortController().signal
        )
      ).not.toBeNull();
    } finally {
      release();
    }
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
      terminalReason: null,
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
