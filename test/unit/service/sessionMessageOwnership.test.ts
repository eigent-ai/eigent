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

import { applyDefaultModelSelection } from '@/lib/applyDefaultModelSelection';
import {
  createSessionMessageIntent,
  executionScope,
  prepareSessionMessage,
} from '@/service/executionApi';
import {
  createWorkspaceSessionDraft,
  reviseWorkspaceSessionDraft,
  submitWorkspaceSessionDraft,
} from '@/service/sessionMessage';
import { useAuthStore } from '@/store/authStore';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  prefer: vi.fn(),
  configs: vi.fn(),
}));
vi.mock('@/lib/spaceProject', () => ({
  createSyncedProjectInSpace: mocks.create,
}));
vi.mock('@/api/http', () => ({
  fetchGet: mocks.get,
  proxyFetchPatch: mocks.patch,
  fetchPost: mocks.post,
  proxyFetchPost: mocks.prefer,
  proxyFetchGet: mocks.configs,
}));
vi.mock('@/store/authStore', async () => {
  const { create } = await import('zustand');
  const useAuthStore = create(() => ({ user_id: 1, token: 'synthetic' }));
  return { useAuthStore, getAuthStore: () => useAuthStore.getState() };
});
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: {
    getState: () => ({
      getProjectById: () => ({ spaceId: 'space', mode: 'single-agent' }),
      getProjectModel: () => null,
      getProjectThinkingEffort: () => 'high',
    }),
  },
}));
vi.mock('@/store/projectStore', () => ({
  waitForPendingProjectConfigurationWrites: async () => {},
}));
vi.mock('@/store/sessionExecutionStore', () => ({
  refreshSessionExecution: () => {},
  selectManagedSession: () => {},
}));
const old = {
  modelType: 'custom' as const,
  provider_id: 1,
  model_platform: 'openai',
  model_type: 'old',
};
const next = { ...old, provider_id: 2, model_type: 'new' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function choose(provider = 2) {
  return applyDefaultModelSelection({
    category: 'custom',
    modelId: 'openai',
    items: [{ id: 'openai' }] as any,
    form: [{ provider_id: provider, model_type: 'new' }],
    setForm: vi.fn(),
    setCloudPrefer: vi.fn(),
    setLocalPrefer: vi.fn(),
    setLocalPlatform: vi.fn(),
    localProviderIds: {},
    localPlatform: '',
    setModelType: vi.fn(),
    setCloudModelType: vi.fn(),
    t: ((v: string) => v) as any,
  });
}
let account = 1;
let saved: any;
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ user_id: ++account });
  mocks.configs.mockResolvedValue([]);
  mocks.prefer.mockResolvedValue({});
  mocks.get.mockImplementation(async (url: string) => ({
    project_id: url.split('/')[2],
    route: 'legacy',
    entry_enabled: true,
    eligible: true,
    selection: old,
  }));
  mocks.patch.mockImplementation(async (url: string, body: any) => {
    saved = body.metadata;
    return { id: url.split('/').at(-1), space_id: 'space', ...body };
  });
  mocks.post.mockImplementation(async (url: string, body: any) =>
    url.includes('execution-configurations')
      ? {
          project_id: url.split('/')[2],
          configuration_revision: 'r1',
          envelope: {
            space_id: 'space',
            configuration_revision: 'r1',
            session_mode: 'single-agent',
            credential_ref: `provider:${saved.modelSelection.provider_id}:synthetic`,
            model_platform: saved.modelSelection.model_platform,
            model_type: saved.modelSelection.model_type,
            thinking_effort: saved.thinkingEffort,
          },
        }
      : { project_id: url.split('/')[2], request_id: body.request_id }
  );
  mocks.create.mockResolvedValue({});
});
const configuration = {
  spaceId: 'space',
  selection: null,
  thinkingEffort: 'high',
  waitForConfigurationWrites: async () => {},
};

it('awaits the selected default save before first-message PATCH and registration', async () => {
  const save = deferred<unknown>();
  mocks.prefer.mockReturnValue(save.promise);
  const change = choose();
  const intent = createSessionMessageIntent(
    executionScope('session'),
    'draft',
    'start'
  );
  const preparation = prepareSessionMessage(intent, configuration);
  await vi.waitFor(() => expect(mocks.prefer).toHaveBeenCalledTimes(1));
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  save.resolve({});
  expect(await change).toBe(true);
  await preparation;
  expect(saved).toEqual({ modelSelection: next, thinkingEffort: 'high' });
  expect(intent.body?.envelope).toMatchObject({
    credential_ref: 'provider:2:synthetic',
  });
});
it('keeps first-send selection while a newer default choice is being saved', async () => {
  const save = deferred<unknown>();
  mocks.prefer.mockReturnValueOnce(save.promise);
  const change = choose();
  const draft = createWorkspaceSessionDraft('space', 'draft', 'high');
  const submit = submitWorkspaceSessionDraft(draft);
  const newer = choose(3);
  await vi.waitFor(() => expect(mocks.prefer).toHaveBeenCalledTimes(1));
  expect(mocks.create).not.toHaveBeenCalled();
  save.resolve({});
  await change;
  await newer;
  await submit;
  expect(saved.modelSelection.provider_id).toBe(2);
  expect(mocks.prefer.mock.calls.map((c) => c[1].provider_id)).toEqual([2, 3]);
});
it('keeps a rejected selection from falling back to the old default or creating a Session', async () => {
  mocks.prefer.mockRejectedValue(new Error('synthetic save failure'));
  expect(await choose()).toBe(false);
  const draft = createWorkspaceSessionDraft('space', 'kept', 'high');
  await expect(submitWorkspaceSessionDraft(draft)).rejects.toThrow(
    'configuration_changed'
  );
  await expect(
    prepareSessionMessage(draft.intent, configuration)
  ).rejects.toThrow('configuration_changed');
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  mocks.prefer.mockResolvedValue({});
  await choose();
  reviseWorkspaceSessionDraft(draft, 'corrected', 'low');
  await submitWorkspaceSessionDraft(draft);
  expect(saved.thinkingEffort).toBe('low');
});
it('fences a pending default save and first-message submission on account change', async () => {
  const lookup = deferred<unknown>();
  mocks.configs.mockReturnValue(lookup.promise);
  const change = choose();
  const draft = createWorkspaceSessionDraft('space', 'kept', 'high');
  const submit = submitWorkspaceSessionDraft(draft);
  await vi.waitFor(() => expect(mocks.configs).toHaveBeenCalled());
  useAuthStore.setState({ user_id: ++account });
  lookup.resolve([]);
  expect(await change).toBe(false);
  await expect(submit).rejects.toThrow();
  expect(mocks.prefer).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('retries the same creation after a lost ACK while allowing message and effort corrections', async () => {
  const payloads: any[] = [];
  mocks.create.mockImplementation(
    async ({ projectStore: _store, ...value }) => {
      payloads.push(JSON.parse(JSON.stringify(value)));
      if (payloads.length === 1)
        throw new Error('create committed; response lost');
      expect(payloads[1]).toEqual(payloads[0]);
    }
  );
  const draft = createWorkspaceSessionDraft('space', 'Original draft', 'high');
  await expect(submitWorkspaceSessionDraft(draft)).rejects.toThrow(
    'response lost'
  );
  const sessionId = draft.intent.scope.projectId;
  reviseWorkspaceSessionDraft(draft, 'Corrected draft', 'low');
  await submitWorkspaceSessionDraft(draft);
  expect(draft.intent.scope.projectId).toBe(sessionId);
  expect(payloads.map((p) => p.name)).toEqual([
    'Original draft',
    'Original draft',
  ]);
  expect(saved.thinkingEffort).toBe('low');
  expect(draft.intent.body?.envelope).toMatchObject({
    prompt: 'Corrected draft',
    thinking_effort: 'low',
  });
});
it('accepts a corrected configuration after pre-delivery registration failure', async () => {
  mocks.post.mockRejectedValueOnce(new Error('registration unavailable'));
  const intent = createSessionMessageIntent(
    executionScope('session'),
    'draft',
    'start'
  );
  await expect(
    prepareSessionMessage(intent, { ...configuration, selection: old })
  ).rejects.toThrow('unavailable');
  expect(intent.deliveryAttempted).toBe(false);
  expect(intent.body).toBeUndefined();
  await prepareSessionMessage(intent, {
    ...configuration,
    selection: next,
    thinkingEffort: 'low',
  });
  expect(saved).toEqual({ modelSelection: next, thinkingEffort: 'low' });
  expect(intent.body?.envelope).toMatchObject({
    credential_ref: 'provider:2:synthetic',
    thinking_effort: 'low',
  });
});
it('retains the exact attempted request and body across retries despite composer configuration changes', async () => {
  const draft = createWorkspaceSessionDraft('space', 'original', 'high');
  mocks.post
    .mockImplementationOnce(async (url: string) => ({
      project_id: url.split('/')[2],
      configuration_revision: 'r1',
      envelope: {
        space_id: 'space',
        configuration_revision: 'r1',
        session_mode: 'single-agent',
        credential_ref: 'provider:1:synthetic',
        model_platform: 'openai',
        model_type: 'old',
        thinking_effort: 'high',
      },
    }))
    .mockRejectedValueOnce(new Error('execution ACK lost'));
  await expect(submitWorkspaceSessionDraft(draft)).rejects.toThrow('ACK lost');
  const intent = draft.intent,
    body = intent.body;
  expect(intent.deliveryAttempted).toBe(true);
  reviseWorkspaceSessionDraft(draft, 'original', 'low');
  expect(draft.intent).toBe(intent);
  expect(draft.intent.body).toBe(body);
  expect(() => reviseWorkspaceSessionDraft(draft, 'edited', 'low')).toThrow(
    'retry_original_request'
  );
  mocks.get.mockResolvedValue({
    project_id: intent.scope.projectId,
    request_id: intent.requestId,
    kind: intent.kind,
  });
  await submitWorkspaceSessionDraft(draft);
  expect(mocks.patch).toHaveBeenCalledTimes(1);
  expect(mocks.post).toHaveBeenCalledTimes(2);
});
