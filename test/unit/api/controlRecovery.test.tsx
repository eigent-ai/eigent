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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => mocked.auth,
  useAuthStore: (selector: any) => selector(mocked.auth),
}));

const mocked = vi.hoisted(() => ({
  auth: { token: null as string | null, user_id: 1 },
  invoke: vi.fn(() => Promise.resolve(5001)),
  getLocalControlCapability: vi.fn(() =>
    Promise.resolve('renderer-capability')
  ),
  reportError: vi.fn(() => 'task'),
  showStorageToast: vi.fn(),
  showTrafficToast: vi.fn(),
  isHumanInteractionStillPending: vi.fn(),
  getHumanInteractionReceipt: vi.fn(),
}));

vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      getLocalControlCapability: mocked.getLocalControlCapability,
    },
    ipcRenderer: { invoke: mocked.invoke },
  }),
}));

vi.mock('@/lib/notifyError', () => ({
  reportError: mocked.reportError,
}));

vi.mock('@/components/Toast/storageToast', () => ({
  showStorageToast: mocked.showStorageToast,
}));

vi.mock('@/components/Toast/trafficToast', () => ({
  showTrafficToast: mocked.showTrafficToast,
}));

vi.mock('@/service/humanInteractionApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/humanInteractionApi')>()),
  isHumanInteractionStillPending: mocked.isHumanInteractionStillPending,
  getHumanInteractionReceipt: mocked.getHumanInteractionReceipt,
}));

import { ControlRecovery } from '@/components/ChatBox/ControlRecovery';
import { HumanInteractionCard } from '@/components/ChatBox/MessageItem/HumanInteractionCard';
import {
  TERMINAL_CONTROL_LIMIT,
  checkControlOperation,
  createControlOperation,
  listControlOperations,
  reconcileControlOperations,
  stopProjectTask,
  submitControlOperation,
} from '@/service/controlOperations';
import { controlRequest } from '@/service/controlRequest';
import { decideHumanInteraction } from '@/service/humanInteractionApi';
import { cancelProjectRun } from '@/service/projectRunsApi';
import {
  resetConnectionConfig,
  setConnectionConfig,
} from '@/store/connectionStore';
import { getProjectEventStore } from '@/store/projectEventStore';
import { useProjectStore } from '@/store/projectStore';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';

const interaction = {
  interaction_id: 'approval-probe',
  interaction_type: 'approval' as const,
  run_id: 'run-probe',
  version: 0,
  action_digest: 'a'.repeat(64),
  title: 'Allow synthetic action?',
  allowed_scopes: ['once' as const],
};
const response = () =>
  new Response(JSON.stringify({ status: 'resolved' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const canonical = (decision = 'approved', status = 'resolved') => ({
  interaction_id: interaction.interaction_id,
  run_id: interaction.run_id,
  status,
  version: 1,
  action_digest: interaction.action_digest,
  response: status === 'resolved' ? { decision, scope: 'once' } : null,
});
// Approval cards stay read-only until Brain confirms the interaction is pending.
const renderCard = async (ui: Parameters<typeof render>[0]) => {
  const view = render(ui);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
};
const canonicalResponse = (decision?: string, status?: string) =>
  new Response(JSON.stringify(canonical(decision, status)), {
    headers: { 'content-type': 'application/json' },
  });

describe('SL-BUG-27 recovery safety contracts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocked.auth = { token: null, user_id: 1 };
    mocked.isHumanInteractionStillPending.mockReset().mockResolvedValue(true);
    mocked.getHumanInteractionReceipt.mockReset().mockResolvedValue(null);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetConnectionConfig();
    setConnectionConfig({
      brainEndpoint: 'http://synthetic.invalid',
      channel: 'web',
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows canonical rejection when a stale approve receives a terminal receipt', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          interaction_id: interaction.interaction_id,
          run_id: interaction.run_id,
          interaction_type: 'approval',
          status: 'resolved',
          version: 1,
          response: { decision: 'rejected', scope: 'once' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const onResolved = vi.fn();
    await renderCard(
      <HumanInteractionCard interaction={interaction} onResolved={onResolved} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onResolved).toHaveBeenCalledWith('Rejected');
  });

  it('ignores an old response after the card changes interaction', async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const onResolved = vi.fn();
    const mounted = await renderCard(
      <HumanInteractionCard interaction={interaction} onResolved={onResolved} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    mounted.rerender(
      <HumanInteractionCard
        interaction={{ ...interaction, interaction_id: 'new-interaction' }}
        onResolved={onResolved}
      />
    );
    await act(async () => {
      finish(response());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeEnabled();
  });

  it.each(['fetch', 'body'])(
    'releases a stalled %s at 15s with independent recovery and identical retry',
    async (stage) => {
      let finish!: (value: Response) => void;
      let finishBody!: (value: unknown) => void;
      const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        if (stage === 'fetch')
          return new Promise((resolve) => {
            finish = resolve;
          });
        const res = response();
        vi.spyOn(res, 'json').mockImplementation(
          () =>
            new Promise((resolve) => {
              finishBody = resolve;
            })
        );
        return Promise.resolve(res);
      });
      const onResolved = vi.fn();
      const first = await renderCard(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      const button = screen.getByRole('button', { name: 'Approve once' });
      fireEvent.click(button);
      fireEvent.click(button);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(14_999);
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();
      first.unmount();
      await renderCard(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      expect(
        screen.getByRole('button', { name: 'Approve once' })
      ).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(
        screen.getByRole('button', { name: 'Check status' })
      ).toBeEnabled();
      const originalBody = fetch.mock.calls[0][1]?.body;
      expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(onResolved).not.toHaveBeenCalled();

      fetch.mockImplementation(() => new Promise(() => {}));
      fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        screen.getByRole('button', { name: 'Check status' })
      ).toBeEnabled();
      expect(onResolved).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);

      fetch.mockImplementation(() => new Promise(() => {}));
      fireEvent.click(
        screen.getByRole('button', { name: 'Retry same request' })
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(fetch.mock.calls[2][1]?.body).toBe(originalBody);
      // The abandoned generation cannot resolve the retry or its remounted card.
      await act(async () => {
        if (stage === 'fetch') finish(canonicalResponse());
        else finishBody(canonical());
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(onResolved).not.toHaveBeenCalled();
      expect(listControlOperations()[0].phase).toBe('pending');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(
        screen.getByRole('button', { name: 'Check status' })
      ).toBeEnabled();
    }
  );

  it.each(['endpoint', 'headers'])(
    'starts the deadline before %s lookup and forbids delayed dispatch',
    async (stage) => {
      vi.resetModules();
      const http = await import('@/api/http');
      const conn = await import('@/store/connectionStore');
      let finish!: (value: never) => void;
      if (stage === 'endpoint') {
        conn.setConnectionConfig({ brainEndpoint: '' });
        mocked.invoke.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        );
      } else {
        conn.setConnectionConfig({ brainEndpoint: 'http://synthetic.invalid' });
        mocked.getLocalControlCapability.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        );
      }
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(canonicalResponse());
      let settled = false;
      const pending = controlRequest((options) =>
        http.fetchPost('/runs/run-probe/cancel', {}, undefined, options)
      ).catch(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(settled).toBe(true);
      finish((stage === 'endpoint' ? 5001 : 'synthetic-capability') as never);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('recovers a lost committed decision without dispatching another decision', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    const onResolved = vi.fn();
    await renderCard(
      <HumanInteractionCard interaction={interaction} onResolved={onResolved} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: interaction.run_id,
          interactions: [canonical('rejected')],
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith('Rejected');
    expect(
      fetch.mock.calls.filter((call) => call[1]?.method === 'POST')
    ).toHaveLength(1);
    expect(String(fetch.mock.calls[1][0])).toContain(
      '/interactions?status=all'
    );
  });

  it.each(['account', 'backend'])(
    'ignores an old receipt after %s changes',
    async (changed) => {
      let finish!: (value: Response) => void;
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      );
      const onResolved = vi.fn();
      const view = await renderCard(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      if (changed === 'account') mocked.auth.user_id = 2;
      else setConnectionConfig({ brainEndpoint: 'http://replacement.invalid' });
      view.rerender(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      await act(async () => {
        finish(canonicalResponse());
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(onResolved).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'Approve once' })
      ).toBeEnabled();
    }
  );

  it('freezes decision, scope, actor, version and digest across conflicting submissions', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    const submit = (
      payload = interaction,
      decision = { decision: 'approved', scope: 'once' },
      actorId = 1
    ) =>
      decideHumanInteraction(payload, {
        decisionRequestId: 'original-id',
        decision,
        actorId,
      });
    const pending = submit().catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    for (const attempt of [
      () => submit(interaction, { decision: 'rejected', scope: 'once' }),
      () => submit(interaction, { decision: 'approved', scope: 'space' }),
      () => submit({ ...interaction, version: 1 }),
      () => submit({ ...interaction, action_digest: 'changed' }),
      () => submit(interaction, undefined, 2),
    ])
      await expect(attempt()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    const op = listControlOperations()[0];
    expect(Object.isFrozen(op.body)).toBe(true);
    expect(Object.isFrozen(op.body.decision)).toBe(true);
  });

  it.each(['expired', 'cancelled'])(
    'reconciles %s without an approval receipt',
    async (status) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        canonicalResponse(undefined, status)
      );
      const onResolved = vi.fn();
      await renderCard(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(onResolved).toHaveBeenCalledWith(
        status === 'expired'
          ? 'This request expired.'
          : 'This request was cancelled.'
      );
    }
  );

  it.each(['changed-version', 'changed-digest', 'missing-decision'])(
    'fails closed on %s during recovery',
    async (change) => {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => new Promise(() => {}));
      const onResolved = vi.fn();
      await renderCard(
        <HumanInteractionCard
          interaction={interaction}
          onResolved={onResolved}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      const item =
        change === 'missing-decision'
          ? { ...canonical(), response: {} }
          : {
              ...canonical(),
              status: 'requested',
              response: null,
              version: change === 'changed-version' ? 2 : 0,
              action_digest:
                change === 'changed-digest'
                  ? 'changed'
                  : interaction.action_digest,
            };
      fetch.mockResolvedValue(
        new Response(
          JSON.stringify({ run_id: interaction.run_id, interactions: [item] }),
          { headers: { 'content-type': 'application/json' } }
        )
      );
      fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(onResolved).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'Approve once' })
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Check status' })
      ).toBeEnabled();
      expect(
        screen.getByRole('button', { name: 'Retry same request' })
      ).toBeDisabled();
      expect(
        fetch.mock.calls.filter((call) => call[1]?.method === 'POST')
      ).toHaveLength(1);
    }
  );

  it('preserves cancellation envelope across surfaces and reconciles a lost result', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    const first = cancelProjectRun(
      'run-probe',
      'cancel-id',
      'original-reason',
      undefined,
      'project-probe'
    ).catch(() => {});
    const second = cancelProjectRun(
      'run-probe',
      'different-id',
      'different-reason'
    ).catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const op = listControlOperations()[0];
    const retry = submitControlOperation(op, true).catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await retry;
    expect(fetch.mock.calls[1][1]?.body).toBe(fetch.mock.calls[0][1]?.body);
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      request_id: 'cancel-id',
      reason: 'original-reason',
    });
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: 'run-probe',
          project_id: 'project-probe',
          status: 'cancelled',
          version: 1,
          origin: 'local',
          updated_at: 1,
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    await checkControlOperation(op);
    expect(op.phase).toBe('resolved');
    expect(
      getProjectEventStore('project-probe').getSnapshot().view.runs['run-probe']
        .status
    ).toBe('cancelled');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('settles an unconfirmed Stop once the Run has timed out', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {})
    );
    const cancel = cancelProjectRun(
      'run-probe',
      'cancel-id',
      'explicit_cancel_from_desktop_ui',
      undefined,
      'project-probe'
    ).catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await cancel;
    const op = listControlOperations()[0];
    expect(op.phase).not.toBe('resolved');
    const snapshot = getProjectEventStore('project-probe').getSnapshot();
    reconcileControlOperations({
      ...snapshot,
      view: {
        ...snapshot.view,
        runs: {
          ...snapshot.view.runs,
          'run-probe': { runId: 'run-probe', status: 'timed_out' } as any,
        },
      },
    });
    expect(op.phase).toBe('resolved');
    expect(op.receipt?.status).toBe('timed_out');
  });

  it('fences legacy Stop to the captured task and treats 201 as queued', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));
    await stopProjectTask('original/session', 'original/task');
    const op = listControlOperations()[0];
    expect(fetch.mock.calls[0][0]).toBe(
      'http://synthetic.invalid/chat/original%2Fsession/skip-task?expected_task_id=original%2Ftask'
    );
    expect(op.phase).toBe('acknowledged');
    expect(op.receipt).toBeUndefined();
    await submitControlOperation(op, true);
    expect(fetch.mock.calls[1][0]).toBe(fetch.mock.calls[0][0]);
  });

  it('does not apply the Approval deadline to questions or unrelated HTTP calls', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    let settled = false;
    void decideHumanInteraction(
      {
        ...interaction,
        interaction_id: 'question',
        interaction_type: 'question',
      },
      {
        decisionRequestId: 'reply',
        decision: { reply: 'answer' },
      }
    ).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(settled).toBe(false);
    expect(listControlOperations()).toHaveLength(0);
    expect(fetch.mock.calls[0][1]?.signal).toBeUndefined();
  });

  it('blocks approval retry while Cancel may still commit', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {})
    );
    const approval = decideHumanInteraction(interaction, {
      decisionRequestId: 'a',
      decision: { decision: 'approved', scope: 'once' },
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await approval;
    const cancel = cancelProjectRun('run-probe', 'c', 'cancel').catch(() => {});
    await expect(
      submitControlOperation(listControlOperations()[0], true)
    ).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(15_000);
    await cancel;
  });
  it('does not record an approval held back by an unconfirmed Stop', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    const stop = stopProjectTask('project-probe', interaction.run_id).catch(
      () => {}
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await stop;
    await expect(
      decideHumanInteraction(interaction, {
        decisionRequestId: 'held',
        decision: { decision: 'approved', scope: 'once' },
      })
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(listControlOperations().map((op) => op.kind)).toEqual(['stop']);
  });

  it('keeps a canonical receipt when the status check cannot replay events', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    const pending = decideHumanInteraction(interaction, {
      projectId: 'replay-project',
      decisionRequestId: 'original',
      decision: { decision: 'approved', scope: 'once' },
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    const op = listControlOperations()[0];
    fetch.mockImplementation(async (url) =>
      String(url).includes('/interactions')
        ? new Response(
            JSON.stringify({
              run_id: interaction.run_id,
              interactions: [canonical()],
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        : new Response(null, { status: 500 })
    );
    await expect(checkControlOperation(op)).resolves.toMatchObject({
      status: 'resolved',
    });
    expect(String(fetch.mock.calls.at(-1)?.[0])).toContain('/events');
    expect(op.phase).toBe('resolved');
    expect(op.completionPending).toBe(true);
    expect(listControlOperations()).toContain(op);
  });

  it.each([
    ['stop', 'Stopping…'],
    ['cancel', 'Cancelling…'],
  ])(
    'shows an acknowledged %s as in progress, not unconfirmed',
    async (kind, label) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        kind === 'stop'
          ? new Response(null, { status: 201 })
          : new Response(
              JSON.stringify({
                run_id: 'run-probe',
                project_id: 'project-probe',
                status: 'cancelling',
                version: 1,
                origin: 'local',
                updated_at: 1,
              }),
              { headers: { 'content-type': 'application/json' } }
            )
      );
      await (kind === 'stop'
        ? stopProjectTask('project-probe', 'run-probe')
        : cancelProjectRun(
            'run-probe',
            'cancel-id',
            'cancel',
            undefined,
            'project-probe'
          ));
      const op = listControlOperations()[0];
      expect(op.phase).toBe('acknowledged');
      render(<ControlRecovery operation={op} />);
      expect(screen.getByRole('status')).toHaveTextContent(label);
      expect(screen.queryByText(/outcome is not confirmed/)).toBeNull();
    }
  );

  it('shows an unanswered Stop as unconfirmed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {})
    );
    const stop = stopProjectTask('project-probe', 'run-probe').catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await stop;
    render(<ControlRecovery operation={listControlOperations()[0]} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The outcome is not confirmed.'
    );
  });

  it('lets canonical events settle a card decision in the active Project', async () => {
    const activeProjectId = useProjectStore.getState().activeProjectId;
    useProjectStore.setState({ activeProjectId: 'card-project' });
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        () => new Promise(() => {})
      );
      await renderCard(<HumanInteractionCard interaction={interaction} />);
      fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      const op = listControlOperations()[0];
      expect(op.projectId).toBe('card-project');
      const snapshot = getProjectEventStore('card-project').getSnapshot();
      act(() =>
        reconcileControlOperations({
          ...snapshot,
          control: {
            ...snapshot.control,
            interactionById: {
              [interaction.interaction_id]: {
                interactionId: interaction.interaction_id,
                runId: interaction.run_id,
                status: 'resolved',
                version: 1,
                actionDigest: interaction.action_digest,
              } as any,
            },
          },
        })
      );
      expect(op.phase).toBe('resolved');
    } finally {
      useProjectStore.setState({ activeProjectId });
    }
  });

  it('keeps ControlRecovery visible when focus finds an unconfirmed approval no longer pending', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    await renderCard(<HumanInteractionCard interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(listControlOperations()[0].phase).toBe('unknown');

    mocked.isHumanInteractionStillPending.mockResolvedValue(false);
    mocked.getHumanInteractionReceipt.mockResolvedValue({
      status: 'resolved',
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mocked.isHumanInteractionStillPending).toHaveBeenCalledTimes(3);
    expect(mocked.getHumanInteractionReceipt).toHaveBeenCalled();
    expect(screen.queryByText('Approval no longer active')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check status' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve once' })).toBeDisabled();

    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: interaction.run_id,
          interactions: [canonical('rejected')],
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listControlOperations()[0].phase).toBe('resolved');
    expect(screen.queryByRole('button', { name: 'Check status' })).toBeNull();
  });

  it('compacts terminal envelopes while preserving unresolved intents and recent deduplication', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    const pending = decideHumanInteraction(interaction, {
      decisionRequestId: 'keep',
      decision: { decision: 'approved', scope: 'once' },
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(15_000);
    await pending;
    const uncertain = listControlOperations()[0];
    const body = uncertain.body;
    const awaitingCleanup = createControlOperation({
      kind: 'interaction',
      projectId: 'inactive-project',
      runId: interaction.run_id,
      interactionId: 'inactive-approval',
      version: 0,
      digest: interaction.action_digest,
      path: '/unused',
      body: { decision_request_id: 'inactive-original' },
    });
    const snapshot = getProjectEventStore('inactive-project').getSnapshot();
    reconcileControlOperations({
      ...snapshot,
      control: {
        ...snapshot.control,
        interactionById: {
          'inactive-approval': {
            interactionId: 'inactive-approval',
            runId: interaction.run_id,
            status: 'resolved',
            version: 1,
            actionDigest: interaction.action_digest,
          } as any,
        },
      },
    });
    fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          ...canonical(),
          interaction_id: request.decision_request_id,
          response: { decision: 'approved', scope: 'once' },
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    });
    for (let i = 0; i < TERMINAL_CONTROL_LIMIT + 8; i++) {
      const id = 'terminal-' + i;
      await decideHumanInteraction(
        { ...interaction, interaction_id: id },
        {
          decisionRequestId: id,
          decision: { decision: 'approved', scope: 'once' },
        }
      );
    }
    expect(listControlOperations()).toHaveLength(TERMINAL_CONTROL_LIMIT + 2);
    expect(listControlOperations()).toContain(awaitingCleanup);
    expect(awaitingCleanup.completionPending).toBe(true);
    expect(awaitingCleanup.body).toEqual({});
    expect(uncertain.body).toBe(body);
    expect(uncertain.phase).toBe('unknown');
    expect(
      listControlOperations()
        .filter((op) => op.phase === 'resolved')
        .every((op) => Object.keys(op.body).length === 0)
    ).toBe(true);
    const calls = fetch.mock.calls.length;
    await decideHumanInteraction(
      {
        ...interaction,
        interaction_id: 'terminal-' + (TERMINAL_CONTROL_LIMIT + 7),
      },
      { decisionRequestId: 'fresh-id', decision: { decision: 'rejected' } }
    );
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it('retires obsolete owner operations without reviving a late receipt', async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = decideHumanInteraction(interaction, {
      decisionRequestId: 'old',
      decision: { decision: 'approved', scope: 'once' },
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const retired = listControlOperations()[0];
    mocked.auth.user_id = 2;
    expect(listControlOperations()).toHaveLength(0);
    mocked.auth.user_id = 1;
    expect(listControlOperations()).toHaveLength(0);
    finish(canonicalResponse());
    await pending;
    expect(listControlOperations()).toHaveLength(0);
    await expect(submitControlOperation(retired, true)).rejects.toThrow();
    await expect(checkControlOperation(retired)).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retires an ambiguous envelope after an exact canonical event and ignores its late reply', async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const pending = decideHumanInteraction(interaction, {
      projectId: 'event-project',
      decisionRequestId: 'event',
      decision: { decision: 'approved', scope: 'once' },
    }).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const op = listControlOperations()[0];
    const snapshot = getProjectEventStore('event-project').getSnapshot();
    reconcileControlOperations({
      ...snapshot,
      control: {
        ...snapshot.control,
        interactionById: {
          [interaction.interaction_id]: {
            interactionId: interaction.interaction_id,
            runId: interaction.run_id,
            status: 'resolved',
            version: 1,
            actionDigest: interaction.action_digest,
          } as any,
        },
      },
    });
    expect(op.phase).toBe('resolved');
    expect(op.body).toEqual({});
    expect(op.retryAllowed).toBe(false);
    finish(canonicalResponse());
    await pending;
    expect(op.phase).toBe('resolved');
    expect(op.completionPending).toBe(true);
    mocked.auth.user_id = 2;
    expect(listControlOperations()).toHaveLength(0);
    mocked.auth.user_id = 1;
    expect(listControlOperations()).toHaveLength(0);
    await expect(checkControlOperation(op)).rejects.toThrow();
  });

  it.each([
    { run_id: 'different-run' },
    { action_digest: 'different-digest' },
    { version: -1 },
    { response: { decision: 'invalid' } },
  ])(
    'rejects mismatched recovery before replay or queue cleanup: %j',
    async (mismatch) => {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => new Promise(() => {}));
      const pending = decideHumanInteraction(interaction, {
        projectId: 'recovery-project',
        decisionRequestId: 'original',
        decision: { decision: 'approved', scope: 'once' },
      }).catch(() => {});
      await vi.advanceTimersByTimeAsync(15_000);
      await pending;
      const op = listControlOperations()[0];
      fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            run_id: interaction.run_id,
            interactions: [{ ...canonical(), ...mismatch }],
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      );
      await expect(checkControlOperation(op)).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(op.phase).toBe('unknown');
    }
  );

  it('keeps a terminal receipt when a status check reads stale pending state', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(canonicalResponse());
    await decideHumanInteraction(interaction, {
      decisionRequestId: 'original',
      decision: { decision: 'approved', scope: 'once' },
    });
    const op = listControlOperations()[0];
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: interaction.run_id,
          interactions: [{ ...canonical(undefined, 'requested'), version: 0 }],
        }),
        { headers: { 'content-type': 'application/json' } }
      )
    );
    await expect(checkControlOperation(op)).rejects.toThrow();
    expect(op.phase).toBe('resolved');
    expect(op.receipt?.status).toBe('resolved');
    expect(op.retryAllowed).toBe(false);
  });
});
