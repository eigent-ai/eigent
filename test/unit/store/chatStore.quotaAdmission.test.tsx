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

import { AgentMessageCard } from '@/components/ChatBox/MessageItem/AgentMessageCard';
import { Toaster } from '@/components/ui/sonner';
import { notifyError } from '@/lib/notifyError';
import { errorCopy, type ErrorReason } from '@/lib/usageErrors';
import {
  closeSSEConnectionsForTasks,
  createChatStoreInstance,
} from '@/store/chatStore';
import { setConnectionConfig } from '@/store/connectionStore';
import { setUsageAccount, useUsageNoticeStore } from '@/store/usageNoticeStore';
import { cleanup, render, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { toast } from 'sonner';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ store: null as any, modelType: 'cloud' }));
vi.mock('@/store/sessionExecutionStore', () => ({
  requireLegacyExecution: async () => {},
  readSessionExecutionRoute: async () => ({ route: 'legacy' }),
  getSessionExecutionState: () => ({ managed: false }),
}));
vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    token: 'synthetic',
    user_id: 1,
    modelType: mocks.modelType,
    cloud_model_type: 'fixture-model',
    language: 'en',
  }),
  getWorkerList: () => [],
  useWorkerList: () => [],
  useAuthStore: (selector: any) => selector({ appearance: 'light' }),
}));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({ electronAPI: null, ipcRenderer: null }),
}));
vi.mock('@/store/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      activeProjectId: 'quota-project',
      appendInitChatStore: () => ({
        taskId: 'quota-run',
        chatStore: mocks.store,
      }),
      getChatStore: () => mocks.store,
      getProjectById: () => ({ id: 'quota-project', mode: 'single' }),
      getHistoryId: () => null,
      getAllChatStores: () => [{ chatId: 'primary', chatStore: mocks.store }],
      getProjectModel: () => null,
      getProjectThinkingEffortOverride: () => undefined,
      setProjectModel: vi.fn(),
      setProjectSpace: vi.fn(),
      setHistoryId: vi.fn(),
    }),
  },
}));
vi.mock('@/store/cloudModelStore', () => ({
  cloudModelRequestExtraParams: () => ({}),
  getCloudModelStore: () => ({
    resolveCloudModel: () => ({
      source: 'selected',
      model: {
        id: 'fixture-model',
        model_type: 'fixture-model',
        model_platform: 'openai',
      },
    }),
  }),
}));
// Only unrelated setup requests are stubbed. The admission uses real http.ts,
// sseTransport, fetch-event-source, chatStore callbacks and Sonner rendering.
vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  waitForBackendReady: async () => true,
  proxyFetchGet: async () => ({
    value: 'synthetic-key',
    api_url: 'https://model.invalid',
    items: [],
  }),
  proxyFetchPost: async () => ({ id: 'synthetic-history' }),
  proxyFetchPut: async () => ({}),
}));
beforeEach(() => {
  mocks.modelType = 'cloud';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  setConnectionConfig({
    brainEndpoint: 'http://brain.invalid',
    channel: 'web',
  });
  setUsageAccount(null);
  setUsageAccount('1');
  mocks.store = createChatStoreInstance();
  mocks.store.getState().create('quota-run');
});
afterEach(async () => {
  closeSSEConnectionsForTasks(['quota-run']);
  toast.dismiss();
  await waitFor(() =>
    expect(document.querySelector('[data-sonner-toast]')).toBeNull()
  );
  cleanup();
  vi.restoreAllMocks();
});
const admissions: {
  payload: unknown;
  status: number;
  reason: ErrorReason;
  display?: ErrorReason;
  raw?: boolean;
}[] = [
  {
    status: 402,
    payload: { detail: 'admission diagnostic SYNTHETIC_PRIVATE' },
    reason: 'task',
  },
  {
    status: 403,
    payload: {
      detail: {
        code: 'trial_daily_exhausted',
        diagnostic: 'SYNTHETIC_PRIVATE',
      },
    },
    reason: 'model-unavailable',
    display: 'trial-daily',
  },
  {
    status: 429,
    payload: {
      detail: {
        code: 'trial_total_exhausted',
        diagnostic: 'SYNTHETIC_PRIVATE',
      },
    },
    reason: 'rate-limit',
    display: 'trial-total',
  },
  {
    status: 402,
    payload: {
      detail:
        "{'reason': 'trial_daily_exhausted', 'diagnostic': 'SYNTHETIC_PRIVATE'}",
    },
    reason: 'task',
    display: 'trial-daily',
  },
  {
    status: 402,
    payload: {
      detail:
        "{'unknown': {'reason': 'trial_daily_exhausted'}, 'diagnostic': 'SYNTHETIC_PRIVATE'}",
    },
    reason: 'task',
  },
  {
    status: 402,
    payload: {
      detail:
        "{'__proto__': {'reason': 'trial_daily_exhausted'}, 'diagnostic': 'SYNTHETIC_PRIVATE'}",
    },
    reason: 'task',
  },
  {
    status: 402,
    payload: {
      detail: `${"{'error': ".repeat(8)}{'reason': 'trial_daily_exhausted', 'diagnostic': 'SYNTHETIC_PRIVATE'}${'}'.repeat(8)}`,
    },
    reason: 'task',
  },
  {
    status: 503,
    payload: '<html>SYNTHETIC_PRIVATE</html>',
    reason: 'task',
    raw: true,
  },
  {
    status: 503,
    payload: {
      detail: { reason: 'future_policy', diagnostic: 'SYNTHETIC_PRIVATE' },
    },
    reason: 'task',
  },
  {
    status: 403,
    payload: {
      detail: {
        code: 'eigent_low_balance_model_restricted',
        diagnostic: 'SYNTHETIC_PRIVATE',
      },
    },
    reason: 'model-restricted',
  },
];
const start = (awaitAdmission = true) =>
  mocks.store
    .getState()
    .startTask(
      'quota-run',
      undefined,
      undefined,
      undefined,
      'Test admission',
      [],
      undefined,
      'quota-project',
      'single',
      { preserveTaskId: true, awaitAdmission, skipHistoryCreate: true }
    )
    .catch((error: unknown) => error);

it.each(admissions)(
  'safely presents real SSE $status admission, retry and history: $payload',
  async ({ payload, status, reason, display = reason, raw }) => {
    const body = raw ? String(payload) : JSON.stringify(payload);
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(body, {
          status,
          headers: {
            'content-type': raw ? 'text/html' : 'application/json',
            'x-request-id': 'admission-request',
          },
        })
    );
    render(<Toaster />);
    for (let retry = 0; retry < 2; retry++) {
      const error = await start();
      notifyError(error);
      await waitFor(() =>
        expect(document.querySelector('[data-sonner-toast]')).not.toBeNull()
      );
      expect(document.querySelector('[data-sonner-toast]')?.textContent).toBe(
        errorCopy(display)
      );
      expect(error).toMatchObject({
        status,
        usageReason: reason,
        message: errorCopy(reason),
        response: { status, data: payload, body },
      });
      expect(error.response.headers.get('x-request-id')).toBe(
        'admission-request'
      );
      if (!raw) expect(error.cause).toContain('SYNTHETIC_PRIVATE');
      expect(useUsageNoticeStore.getState().incidents).toEqual([]);
      // Rejected admission closes pending state and never retries on its own.
      expect(fetch).toHaveBeenCalledTimes(retry + 1);
      expect(mocks.store.getState().tasks['quota-run']).toMatchObject({
        isPending: false,
        status: 'finished',
      });
    }
  }
);

it.each(admissions)(
  'keeps scheduled admission history safe after reload: $payload',
  async ({ payload, status, raw }) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(raw ? String(payload) : JSON.stringify(payload), {
          status,
          headers: { 'content-type': raw ? 'text/html' : 'application/json' },
        })
    );
    await start(false);
    await waitFor(() =>
      expect(
        mocks.store
          .getState()
          .tasks['quota-run'].messages.some(
            (message: any) => message.errorReason
          )
      ).toBe(true)
    );
    const history = JSON.parse(
      JSON.stringify(mocks.store.getState().tasks['quota-run'].messages)
    );
    const failure = history.find((message: any) => message.errorReason);
    expect(failure.content).not.toContain('SYNTHETIC_PRIVATE');
    for (let reload = 0; reload < 2; reload++) {
      const view = render(
        <AgentMessageCard
          id={failure.id}
          content={failure.content}
          errorReason={failure.errorReason}
          typewriter={false}
        />
      );
      expect(view.container.querySelector('[data-task-error]')).not.toBeNull();
      expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE');
      view.unmount();
    }
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  }
);

it('shows the Brain continuation question from a 409 admission verbatim', async () => {
  const question =
    'The previous run may have executed a tool. Reply exactly: I acknowledge the tool may have executed.';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        detail: {
          code: 'continuation_outcome_unknown',
          message: question,
          interaction_type: 'confirmation',
        },
      }),
      { status: 409, headers: { 'content-type': 'application/json' } }
    )
  );
  await start(false);
  await waitFor(() =>
    expect(
      mocks.store
        .getState()
        .tasks['quota-run'].messages.map((message: any) => message.content)
    ).toContain(
      i18next.t('chat.control-input-required-message', { message: question })
    )
  );
  expect(useUsageNoticeStore.getState().incidents).toEqual([]);
});

it('retains the existing budget incident and clears pending admission', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        detail: { reason: 'budget_exceeded', diagnostic: 'SYNTHETIC_PRIVATE' },
      }),
      { status: 402, headers: { 'content-type': 'application/json' } }
    )
  );
  const error = await start();
  notifyError(error);
  expect(error.usageReason).toBe('credits');
  expect(
    useUsageNoticeStore.getState().incidents.map((incident) => incident.reason)
  ).toEqual(['credits']);
  expect(error.response.data.detail.diagnostic).toBe('SYNTHETIC_PRIVATE');
  expect(error.cause).toContain('SYNTHETIC_PRIVATE');
  expect(mocks.store.getState().tasks['quota-run'].isPending).toBe(false);
});

it.each(['network rejection', 'admission diagnostic'])(
  'retains the existing connection retry for %s',
  async (kind) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (kind === 'network rejection') throw new TypeError('Failed to fetch');
      return new Response(
        JSON.stringify({ detail: 'Failed to fetch SYNTHETIC_PRIVATE' }),
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }
      );
    });
    await start(false);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2), {
      timeout: 2500,
    });
    closeSSEConnectionsForTasks(['quota-run']);
    expect(useUsageNoticeStore.getState().incidents).toEqual([]);
    expect(
      JSON.stringify(mocks.store.getState().tasks['quota-run'].messages)
    ).not.toContain('SYNTHETIC_PRIVATE');
  }
);

it('preserves local no-provider guidance from actual startTask in Sonner', async () => {
  mocks.modelType = 'custom';
  const fetch = vi.spyOn(globalThis, 'fetch');
  const error = await start();
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe(i18next.t('chat.no-model-provider'));
  render(<Toaster />);
  notifyError(error);
  await waitFor(() =>
    expect(document.querySelector('[data-sonner-toast]')?.textContent).toBe(
      i18next.t('chat.no-model-provider')
    )
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(useUsageNoticeStore.getState().incidents).toEqual([]);
  expect(mocks.store.getState().tasks['quota-run']).toMatchObject({
    isPending: false,
    status: 'finished',
  });
});
