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

import {
  createSessionMessageIntent,
  deliverSessionMessage,
  executionScope,
  fetchSessionExecutions,
  prepareSessionMessage,
} from '@/service/executionApi';
import { useAuthStore } from '@/store/authStore';
import {
  getSessionExecutionState,
  loadMoreSessionExecutions,
  observeSessionExecution,
  refreshSessionExecution,
  requireLegacyExecution,
  resetSessionExecutionStore,
} from '@/store/sessionExecutionStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchDelete: vi.fn(),
  fetchGetBlob: vi.fn(),
  proxyFetchPatch: vi.fn(),
}));
vi.mock('@/api/http', () => http);
vi.mock('@/store/authStore', async () => {
  const { create } = await import('zustand');
  const useAuthStore = create(() => ({ user_id: 1, token: 'synthetic' }));
  return { useAuthStore, getAuthStore: () => useAuthStore.getState() };
});
const selection = {
  modelType: 'custom' as const,
  provider_id: 1,
  model_platform: 'openai',
  model_type: 'synthetic',
};
const route = {
  project_id: 'session',
  route: 'legacy',
  entry_enabled: true,
  eligible: true,
  reason: null,
  selection,
  has_requests: false,
  request_cursor: 0,
};
const envelope = {
  configuration_revision: 'revision-one',
  credential_ref: 'provider:1:synthetic',
  space_id: 'space',
  session_mode: 'single-agent',
  thinking_effort: 'high',
  model_platform: 'openai',
  model_type: 'synthetic',
};
const configuration = {
  spaceId: 'space',
  selection,
  thinkingEffort: 'high',
  waitForConfigurationWrites: async () => undefined,
};
const registered = {
  project_id: 'session',
  configuration_revision: 'revision-one',
  envelope,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user_id: 1 });
  http.fetchGet.mockResolvedValue(route);
  http.proxyFetchPatch.mockResolvedValue({
    id: 'session',
    space_id: 'space',
    mode: 'single-agent',
    metadata: { modelSelection: selection, thinkingEffort: 'high' },
  });
  http.fetchPost.mockResolvedValue(registered);
});
afterEach(() => {
  resetSessionExecutionStore();
  vi.useRealTimers();
});

describe('Session submission configuration and observation', () => {
  it('waits for pending saves and server acknowledgement before registration, pinning the captured selection', async () => {
    const pending = deferred<void>();
    const save = deferred<unknown>();
    http.proxyFetchPatch.mockReturnValue(save.promise);
    const intent = createSessionMessageIntent(
      executionScope('session'),
      'draft',
      'start'
    );
    const input = {
      ...configuration,
      selection: { ...selection },
      waitForConfigurationWrites: () => pending.promise,
    };
    const preparation = prepareSessionMessage(intent, input);
    input.selection.provider_id = 2;
    expect(http.proxyFetchPatch).not.toHaveBeenCalled();
    expect(http.fetchPost).not.toHaveBeenCalled();
    pending.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(
      http.proxyFetchPatch.mock.calls[0][1].metadata.modelSelection.provider_id
    ).toBe(1);
    expect(http.fetchPost).not.toHaveBeenCalled();
    save.resolve({
      id: 'session',
      space_id: 'space',
      mode: 'single-agent',
      metadata: { modelSelection: selection, thinkingEffort: 'high' },
    });
    await preparation;
    expect(http.fetchPost.mock.calls[0][1]).toEqual({});
    expect(intent.body).toMatchObject({
      request_id: intent.requestId,
      envelope: { ...envelope, prompt: 'draft' },
    });
    await prepareSessionMessage(intent, {
      ...configuration,
      thinkingEffort: 'low',
    });
    expect(http.proxyFetchPatch).toHaveBeenCalledTimes(1);
  });
  it('retains the exact delivery intent and resolves an acknowledgement loss with GET', async () => {
    const intent = createSessionMessageIntent(
      executionScope('session'),
      'follow up',
      'follow_up'
    );
    await prepareSessionMessage(intent, configuration);
    http.fetchPost.mockRejectedValueOnce(new TypeError('response lost'));
    await expect(deliverSessionMessage(intent)).rejects.toThrow(
      'response lost'
    );
    http.fetchGet.mockResolvedValue({
      project_id: 'session',
      request_id: intent.requestId,
      kind: 'follow_up',
    });
    const count = http.fetchPost.mock.calls.length;
    await deliverSessionMessage(intent);
    expect(http.fetchPost).toHaveBeenCalledTimes(count);
    expect(intent.body).toMatchObject({
      source_follow_up_request_id: intent.requestId,
      follow_up_content: 'follow up',
    });
  });
  it('rejects an unsaved configuration and a late result after account changes without registration', async () => {
    http.proxyFetchPatch.mockResolvedValueOnce({
      id: 'session',
      space_id: 'space',
      mode: 'workforce',
    });
    await expect(
      prepareSessionMessage(
        createSessionMessageIntent(executionScope('session'), 'draft', 'start'),
        configuration
      )
    ).rejects.toThrow('configuration_changed');
    expect(http.fetchPost).not.toHaveBeenCalled();
    const late = deferred<unknown>();
    http.proxyFetchPatch.mockReturnValue(late.promise);
    const intent = createSessionMessageIntent(
      executionScope('session'),
      'kept',
      'start'
    );
    const promise = prepareSessionMessage(intent, configuration);
    await Promise.resolve();
    useAuthStore.setState({ user_id: 2 });
    late.resolve({});
    await expect(promise).rejects.toThrow('account_changed');
    expect(intent.content).toBe('kept');
    expect(http.fetchPost).not.toHaveBeenCalled();
  });
  it('discovers a pending request without a Run; unmount stops reads and never starts work', async () => {
    vi.useFakeTimers();
    const scope = executionScope('session');
    const request = {
      project_id: 'session',
      request_id: 'pending-first',
      queue_seq: 1,
      admitted_run_id: null,
      status: 'pending',
      settlement: null,
    };
    http.fetchGet.mockImplementation(async (url) =>
      url.endsWith('/execution-route')
        ? { ...route, route: 'managed', has_requests: true }
        : { project_id: 'session', items: [request], next_cursor: null }
    );
    const unmount = observeSessionExecution(scope);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSessionExecutionState(scope).requests).toEqual([request]);
    await expect(requireLegacyExecution(scope)).rejects.toThrow(
      'managed_execution_required'
    );
    unmount();
    const count = http.fetchGet.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(http.fetchGet).toHaveBeenCalledTimes(count);
    expect(http.fetchPost).not.toHaveBeenCalled();
    const leave = observeSessionExecution(scope);
    await vi.advanceTimersByTimeAsync(0);
    leave();
    expect(http.fetchGet.mock.calls.length).toBeGreaterThan(count);
  });
  it('retains explicitly loaded pages beyond twenty after the next observer refresh', async () => {
    vi.useFakeTimers();
    const scope = executionScope('session');
    http.fetchGet.mockImplementation(async (url, query) => {
      if (url.endsWith('/execution-route'))
        return { ...route, route: 'managed', has_requests: true };
      const cursor = Number(query?.after ?? 0);
      return {
        project_id: 'session',
        items: [
          {
            project_id: 'session',
            request_id: 'request-' + (cursor + 1),
            queue_seq: cursor + 1,
            status: 'pending',
            settlement: null,
          },
        ],
        next_cursor: cursor < 20 ? cursor + 1 : null,
      };
    });
    const leave = observeSessionExecution(scope);
    await vi.advanceTimersByTimeAsync(0);
    for (let page = 1; page < 21; page++)
      await loadMoreSessionExecutions(scope);
    expect(getSessionExecutionState(scope).requests).toHaveLength(21);
    refreshSessionExecution(scope);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSessionExecutionState(scope).requests).toHaveLength(21);
    expect(getSessionExecutionState(scope).nextCursor).toBeNull();
    leave();
  });
  it('aborts an observer on account change and rejects another Session in a page', async () => {
    vi.useFakeTimers();
    const read = deferred<unknown>();
    http.fetchGet.mockReturnValue(read.promise);
    const scope = executionScope('session');
    const leave = observeSessionExecution(scope);
    useAuthStore.setState({ user_id: 2 });
    expect(http.fetchGet.mock.calls[0][3].signal.aborted).toBe(true);
    read.resolve(route);
    await vi.advanceTimersByTimeAsync(0);
    leave();
    expect(getSessionExecutionState(scope).route).toBeNull();
    http.fetchGet.mockResolvedValue({
      project_id: 'session',
      items: [{ project_id: 'other', queue_seq: 1 }],
      next_cursor: null,
    });
    await expect(
      fetchSessionExecutions(executionScope('session'))
    ).rejects.toThrow('invalid_response');
  });
});
