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

// Exercise the real replay reducer, legacy card path and canonical timeline.
// Only transport, host services and Markdown completion are mocked.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies - moved to top before other imports
vi.mock('@/api/http', async () => {
  const { fetchEventSource } = await import('@microsoft/fetch-event-source');
  const getBaseURL = vi.fn(() => Promise.resolve('http://localhost:8000'));

  return {
    fetchGet: vi.fn(),
    fetchPost: vi.fn(),
    fetchPut: vi.fn(),
    getBaseURL,
    proxyFetchPost: vi.fn(() => Promise.resolve({ id: 'mock-history-id' })),
    proxyFetchPut: vi.fn(),
    proxyFetchGet: vi.fn((path: string) =>
      Promise.resolve(
        path === '/api/v1/chat/snapshots'
          ? []
          : {
              value: '',
              api_url: '',
              items: [],
              warning_code: null,
            }
      )
    ),
    uploadFile: vi.fn(),
    fetchDelete: vi.fn(),
    waitForBackendReady: vi.fn(() => Promise.resolve(true)),
    sseTransport: vi.fn(async (options: any) => {
      const baseURL = await getBaseURL();
      const fullUrl =
        options.url.startsWith('http://') || options.url.startsWith('https://')
          ? options.url
          : `${baseURL}${options.url}`;
      const body =
        typeof options.body === 'string'
          ? options.body
          : options.body
            ? JSON.stringify(options.body)
            : undefined;

      await fetchEventSource(fullUrl, {
        method: options.method || 'POST',
        openWhenHidden: options.openWhenHidden ?? true,
        signal: options.signal,
        headers: options.extraHeaders ?? {},
        body,
        onmessage: options.onmessage,
        onopen: options.onopen,
        onerror: options.onerror,
        onclose: options.onclose,
      });
    }),
  };
});

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(),
}));

vi.mock('../../../src/store/authStore', () => ({
  useAuthStore: {
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-5.4' as const,
    initState: 'carousel' as const,
    share_token: null,
    workerListData: {},
  },
  getAuthStore: vi.fn(() => ({
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-5.4' as const,
    initState: 'carousel' as const,
    share_token: null,
    workerListData: {},
  })),
  useWorkerList: vi.fn(() => []),
  getWorkerList: vi.fn(() => []),
}));

vi.mock('../../../src/store/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      activeProjectId: null,
      getHistoryId: () => null,
      getProjectById: (projectId: string) => ({
        id: projectId,
        mode: 'single-agent',
      }),
    })),
  },
}));

import { normalizeLegacyChatStep } from '@/lib/projector/adapters/legacyChatStep';
import { composeTimelineRuns } from '@/lib/projector/chat/presentation';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { useChatStore } from '../../../src/store/chatStore';

// Mock electron IPC
(global as any).ipcRenderer = {
  invoke: vi.fn((channel, ..._args) => {
    if (channel === 'get-system-language') return Promise.resolve('en');
    if (channel === 'get-browser-port') return Promise.resolve(9222);
    if (channel === 'get-env-path') return Promise.resolve('/path/to/env');
    if (channel === 'mcp-list') return Promise.resolve({});
    return Promise.resolve();
  }),
};

import { TimelineModeRenderer } from '@/components/ChatBox/TimelineModes';
import { UserQueryGroup } from '@/components/ChatBox/UserQueryGroup';
import { subscribeAppEvents, type AppEvent } from '@/lib/events/appEvents';
import { projectChatEvents } from '@/lib/projector/chat';
import { normalizeEvent } from '@/lib/projector/normalize';
import type { VanillaChatStore } from '@/store/chatStore';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ChatBox/MessageItem/MarkDown', async () => {
  const { useEffect } = await import('react');
  return {
    MarkDown: ({
      onTyping,
      onMarkdownRenderComplete,
    }: {
      onTyping?: () => void;
      onMarkdownRenderComplete?: () => void;
    }) => {
      useEffect(() => {
        onTyping?.();
        onMarkdownRenderComplete?.();
      }, [onTyping, onMarkdownRenderComplete]);
      return null;
    },
  };
});

function renderLegacyMessage(
  store: VanillaChatStore,
  runId: string,
  message: Message
) {
  return render(
    <UserQueryGroup
      chatId="feedback-project"
      chatStore={store}
      queryGroup={{
        queryId: 'query',
        userMessage: null,
        otherMessages: [message],
        ownsRunWorkLog: false,
      }}
      isActive={false}
      onQueryActive={() => {}}
      index={0}
      taskId={runId}
    />
  );
}

async function replay(
  store: VanillaChatStore,
  runId: string,
  raw: Record<string, unknown>,
  replaySource: 'local_durable' | 'cloud' = 'local_durable'
) {
  vi.mocked(fetchEventSource).mockImplementation(async (_url, opts) => {
    await opts.onmessage?.({
      event: 'run_event',
      id: '1',
      data: JSON.stringify(raw),
    } as any);
    opts.onclose?.();
  });
  await act(async () => {
    await store
      .getState()
      .startTask(
        runId,
        'replay',
        undefined,
        0,
        undefined,
        undefined,
        undefined,
        'feedback-project',
        undefined,
        { replaySource }
      );
  });
  return store
    .getState()
    .tasks[runId].messages.filter((message) => message.role === 'agent')
    .at(-1)!;
}

function canonical(
  runId: string,
  payload: Record<string, unknown>,
  step = 'end'
) {
  return {
    event_id: `${step === 'end' ? 'assistant-final' : step}:${runId}`,
    event_type: step === 'end' ? 'assistant.final' : `legacy.${step}`,
    legacy_step: step,
    payload,
    project_id: 'feedback-project',
    run_id: runId,
    sequence: 1,
    run_version: 1,
    created_at: 1786026414.75,
  };
}

describe('feedback identity across legacy replay and canonical presentation', () => {
  let events: AppEvent[];
  let unsubscribe: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    events = [];
    unsubscribe = subscribeAppEvents((event) => {
      if (event.name === 'message_feedback') events.push(event);
    });
  });
  afterEach(() => unsubscribe());

  it.each(['end', 'wait_confirm', 'agent_end', 'agent_summary_end'])(
    'keeps a live-shaped %s rating when the canonical receipt is replayed',
    async (step) => {
      const { result } = renderHook(() => useChatStore());
      const store = result.current;
      const runId = store.getState().create();
      const payload = { content: 'The live result' };
      const receipt = canonical(
        runId,
        payload,
        step === 'wait_confirm' ? 'end' : step
      );
      // Cloud replay and live /chat frames share the same legacy transport
      // decoder. Use it here without starting model/network admission.
      const live = await replay(
        store,
        runId,
        { step, data: payload, source_event_id: receipt.event_id },
        'cloud'
      );
      expect(live.feedbackMessageId).toBe(receipt.event_id);
      const view = renderLegacyMessage(store, runId, live);
      fireEvent.click(await screen.findByLabelText('Thumb up'));
      view.unmount();

      act(() => store.getState().create(runId));
      const restored = await replay(store, runId, receipt);
      expect(restored.id).not.toBe(live.id);
      renderLegacyMessage(store, runId, restored);
      expect(await screen.findByLabelText('Thumb up')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Thumb down')).toBeDisabled();
      fireEvent.click(screen.getByLabelText('Thumb up'));
      expect(events).toHaveLength(1);
      expect(events[0].properties).toMatchObject({
        message_id: receipt.event_id,
        run_id: runId,
      });
      expect(events[0].properties).not.toHaveProperty('message_id_source');
    }
  );

  it.each([
    { step: 'end', payload: { content: 'The same result' } },
    { step: 'end', payload: 'The plain-text final result' },
    { step: 'wait_confirm', payload: { content: 'The same result' } },
    { step: 'agent_end', payload: { content: 'The same result' } },
    { step: 'agent_summary_end', payload: { content: 'The same result' } },
  ])(
    'keeps the live $step rating after cloud playback ($payload)',
    async ({ step, payload }) => {
      const { result } = renderHook(() => useChatStore());
      const store = result.current;
      const runId = store.getState().create();
      const sourceId = `cloud-receipt:${runId}`;
      const live = await replay(
        store,
        runId,
        {
          step,
          data: payload,
          source_event_id: sourceId,
        },
        'cloud'
      );
      const view = renderLegacyMessage(store, runId, live);
      fireEvent.click(await screen.findByLabelText('Thumb up'));
      view.unmount();

      act(() => store.getState().create(runId));
      // Existing cloud servers persist and replay the data JSON unchanged.
      const cloudFrame = {
        id: 12345,
        task_id: runId,
        run_id: runId,
        step,
        data: {
          ...(typeof payload === 'string' ? { message: payload } : payload),
          source_event_id: sourceId,
        },
      };
      const restored = await replay(store, runId, cloudFrame, 'cloud');
      expect(restored.content).toBe(live.content);
      expect(restored.feedbackMessageId).toBe(sourceId);
      const historical = renderLegacyMessage(store, runId, restored);
      expect(await screen.findByLabelText('Thumb up')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Thumb down')).toBeDisabled();
      fireEvent.click(screen.getByLabelText('Thumb down'));
      historical.unmount();

      if (step === 'end') {
        // The Narrative reader must use the same receipt, not its generated
        // chat_step_v1 transport identity or the cloud database row id.
        const projection = projectChatEvents('feedback-project', [
          normalizeLegacyChatStep(cloudFrame, {
            projectId: 'feedback-project',
            runId,
            sequence: 1,
          }),
        ]);
        render(
          <TimelineModeRenderer
            detailLevel="narrative"
            runs={composeTimelineRuns(projection.nodes)}
          />
        );
        expect(await screen.findByLabelText('Thumb up')).toHaveAttribute(
          'aria-pressed',
          'true'
        );
        expect(screen.getByLabelText('Thumb down')).toBeDisabled();
        fireEvent.click(screen.getByLabelText('Thumb down'));
      }
      expect(events.map((event) => event.properties)).toEqual([
        {
          rating: 'up',
          message_id: sourceId,
          run_id: runId,
          message_step: step,
        },
      ]);
    }
  );

  it.each(['event', 'message_id', 'messageId'] as const)(
    'keeps one rating across legacy and narrative renderers using %s identity',
    async (source) => {
      const { result } = renderHook(() => useChatStore());
      const store = result.current;
      const runId = store.getState().create();
      const payload = {
        message: 'The final result',
        ...(source === 'event' ? {} : { [source]: `logical:${runId}` }),
      };
      const raw = canonical(runId, payload);
      const legacy = await replay(store, runId, raw);
      const sourceId = source === 'event' ? raw.event_id : `logical:${runId}`;
      expect(legacy.id).not.toBe(sourceId);
      const view = renderLegacyMessage(store, runId, legacy);
      fireEvent.click(await screen.findByLabelText('Thumb up'));
      view.unmount();

      const projection = projectChatEvents('feedback-project', [
        normalizeEvent(raw),
      ]);
      const runs = composeTimelineRuns(projection.nodes);
      const narrative = render(
        <TimelineModeRenderer detailLevel="narrative" runs={runs} />
      );
      expect(await screen.findByLabelText('Thumb up')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Thumb down')).toBeDisabled();
      fireEvent.click(screen.getByLabelText('Thumb down'));
      // A real mode switch remounts the card as well.
      narrative.rerender(
        <TimelineModeRenderer detailLevel="trajectory" runs={runs} />
      );
      narrative.rerender(
        <TimelineModeRenderer detailLevel="narrative" runs={runs} />
      );
      expect(await screen.findByLabelText('Thumb up')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      fireEvent.click(screen.getByLabelText('Thumb up'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        properties: { message_id: sourceId, run_id: runId, rating: 'up' },
      });
      expect(events[0].properties).not.toHaveProperty('message_id_source');
    }
  );

  it.each(['end', 'agent_end', 'wait_confirm'])(
    'keeps the %s rating when the same durable event rebuilds a legacy message',
    async (step) => {
      const { result } = renderHook(() => useChatStore());
      const store = result.current;
      const runId = store.getState().create();
      const raw = canonical(runId, { content: 'The result' }, step);
      const first = await replay(store, runId, raw);
      const view = renderLegacyMessage(store, runId, first);
      fireEvent.click(await screen.findByLabelText('Thumb down'));
      view.unmount();
      // Rebuild the transcript from its durable history, retaining the Run id.
      act(() => {
        store.getState().create(runId);
      });
      const rebuilt = await replay(store, runId, raw);
      expect(rebuilt.id).not.toBe(first.id);
      renderLegacyMessage(store, runId, rebuilt);
      expect(await screen.findByLabelText('Thumb down')).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByLabelText('Thumb up')).toBeDisabled();
      fireEvent.click(screen.getByLabelText('Thumb down'));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        properties: { message_id: raw.event_id, run_id: runId, rating: 'down' },
      });
    }
  );
});
