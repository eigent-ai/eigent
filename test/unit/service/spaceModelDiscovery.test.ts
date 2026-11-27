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

import { discoverSpaceModels } from '@/service/spaceModelDiscovery';
import {
  blocksLocalBundlePublish,
  preflightWorkspaceBundleReferences,
} from '@/service/workspaceBundleReferencePreflight';
import type { WorkspaceConfigurationDocument } from '@/service/workspaceConfigurationApi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localModelRecord } from '../helpers/localModels';

const { get, auth, savedModels } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { token: 'fixture-token', user_id: 41, email: 'fixture@example.test' },
  savedModels: vi.fn(),
}));

vi.mock('@/api/http', () => ({ proxyFetchGet: get, fetchGet: vi.fn() }));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => auth }));
// The user's own models are read from this device, not from the server.
vi.mock('@/lib/savedModels', () => ({ fetchSavedModels: savedModels }));

const cloud = {
  id: 'managed-model',
  model_type: 'managed-deployment',
  model_platform: 'azure',
  display_name: 'Managed model',
  provider_family: 'openai',
  kind: 'chat',
};
/** Saved under a wrapper name; its settings name the real platform and model. */
const saved = localModelRecord({
  id: 7821,
  provider_name: 'azure',
  model_type: 'wrapper',
  is_valid: 2,
  api_key: 'fixture-private-key',
  endpoint_url: 'https://fixture-private.example',
  encrypted_config: {
    model_platform: 'openai',
    model_type: 'configured-model',
    secret: 'fixture-private-extra',
  },
});
const values = (result: Awaited<ReturnType<typeof discoverSpaceModels>>) =>
  result.items.map((item) => item.value);
const serverRoutes = () => get.mock.calls.map(([url]) => String(url));

const modelDocument = (modelRef: string): WorkspaceConfigurationDocument => ({
  apiVersion: 'eigent.ai/v1alpha1',
  kind: 'WorkspaceBundle',
  metadata: { id: 'bundle', name: 'Bundle', revision: 1 },
  spec: {
    instructions: {},
    context: [],
    skills: [],
    mcpServers: [],
    connectors: [],
    agents: [],
    models: { default: { modelRef, thinkingEffort: 'medium' } },
    permissions: { profile: 'request_approval', rules: [] },
    git: {
      enabled: true,
      checkpointPolicy: 'user_and_run_terminal',
      agentIsolation: 'worktree',
      remotePolicy: 'prompt',
    },
  },
});

describe('model catalog for a Space', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');
    Object.assign(auth, {
      token: 'fixture-token',
      user_id: 41,
      email: 'fixture@example.test',
    });
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models' ? { models: [cloud] } : []
    );
    savedModels.mockResolvedValue([saved]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('lists Cloud models from the server and own models from this device', async () => {
    const result = await discoverSpaceModels();

    expect(values(result)).toEqual([
      'provider://default',
      'provider://cloud/managed-model',
      'provider://custom/openai/configured-model',
    ]);
    expect(result.unavailableSources).toEqual([]);
    // Only the Cloud catalog is asked of the server.
    expect(serverRoutes()).toEqual(['/api/v1/cloud-models']);
  });

  it('projects own models without their address, settings or key', async () => {
    const encoded = JSON.stringify(await discoverSpaceModels());

    expect(encoded).not.toMatch(
      /fixture-private|endpoint_url|encrypted_config|api_key|model_credential/
    );
    expect(encoded).toContain('provider://custom/openai/configured-model');
  });

  it('names a local model by the settings saved with it', async () => {
    savedModels.mockResolvedValue([
      localModelRecord({
        id: 2147483648,
        provider_name: 'ollama',
        model_type: 'wrapper',
        encrypted_config: {
          model_platform: 'ollama',
          model_type: 'org/model:8b',
        },
      }),
    ]);

    expect(values(await discoverSpaceModels())).toContain(
      'provider://local/ollama/org%2Fmodel%3A8b'
    );
  });

  it('skips managed Cloud for a self-hosted server and keeps own models', async () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true');

    expect(values(await discoverSpaceModels())).toEqual([
      'provider://default',
      'provider://custom/openai/configured-model',
    ]);
    expect(get).not.toHaveBeenCalled();
    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual(['cloud_catalog']);
  });

  it('keeps own models when Cloud fails, and Cloud when own models cannot be read', async () => {
    get.mockRejectedValue(new Error('offline'));
    expect(await discoverSpaceModels()).toMatchObject({
      items: [
        { value: 'provider://default' },
        { value: 'provider://custom/openai/configured-model' },
      ],
      unavailableSources: ['cloud_catalog'],
    });

    get.mockImplementation(async () => ({ models: [cloud] }));
    savedModels.mockRejectedValue(new Error('store unreadable'));
    expect(await discoverSpaceModels()).toMatchObject({
      items: [
        { value: 'provider://default' },
        { value: 'provider://cloud/managed-model' },
      ],
      unavailableSources: ['provider_catalog'],
    });
  });

  it('reads the saved models again on every discovery', async () => {
    savedModels.mockRejectedValueOnce(new Error('store unreadable'));
    expect((await discoverSpaceModels()).unavailableSources).toEqual([
      'provider_catalog',
    ]);
    expect((await discoverSpaceModels()).unavailableSources).toEqual([]);
    expect(savedModels).toHaveBeenCalledTimes(2);
  });

  it('distinguishes an empty list from one that cannot be read', async () => {
    get.mockImplementation(async () => ({ models: [] }));
    savedModels.mockResolvedValue([]);

    expect(await discoverSpaceModels()).toMatchObject({
      items: [{ value: 'provider://default' }],
      unavailableSources: [],
    });
  });

  it.each(['account', 'token', 'environment'] as const)(
    'discards all results when the %s changes before the saved models arrive',
    async (change) => {
      let resolve!: (records: unknown[]) => void;
      savedModels.mockImplementation(
        () =>
          new Promise((resolvePromise) => {
            resolve = resolvePromise;
          })
      );
      const pending = discoverSpaceModels();
      await vi.waitFor(() => expect(savedModels).toHaveBeenCalledTimes(1));
      if (change === 'account') auth.user_id = 42;
      else if (change === 'token') auth.token = 'fixture-token-b';
      else vi.stubEnv('VITE_BASE_URL', 'https://other-fixture.example');
      resolve([saved]);

      await expect(pending).rejects.toThrow('model_catalog_account_changed');
    }
  );

  it('keeps unusable and duplicate models disabled, and does not normalize malformed identities', async () => {
    get.mockImplementation(async () => ({ models: [] }));
    const model = (id: number, settings: Record<string, unknown>, more = {}) =>
      localModelRecord({
        ...saved,
        id,
        encrypted_config: { ...saved.encrypted_config, ...settings },
        ...more,
      });
    savedModels.mockResolvedValue([
      saved,
      model(7822, {}),
      model(7823, { model_type: 'invalid' }, { is_valid: 1 }),
      model(
        7824,
        { model_type: 'key-needed' },
        { is_valid: 1, key_state: 'needed' }
      ),
      model(7825, { model_type: ' whitespace' }),
      model(7826, { model_platform: ' space' }),
      model(7827, { model_type: '../traversal' }),
    ]);

    const result = await discoverSpaceModels();
    expect(values(result)).toEqual([
      'provider://default',
      'provider://custom/openai/configured-model',
      'provider://custom/openai/invalid',
      'provider://custom/openai/key-needed',
    ]);
    expect(result.items[1]).toMatchObject({
      disabled: true,
      reason: 'model_ambiguous',
    });
    // A model whose key is not on this device cannot be chosen.
    for (const item of result.items.slice(2))
      expect(item).toMatchObject({
        disabled: true,
        reason: 'model_unavailable',
      });
  });

  it('skips models that cannot be named without failing authoring preflight', async () => {
    get.mockImplementation(async () => ({
      models: [cloud, { id: 'broken' }],
    }));
    savedModels.mockResolvedValue([
      saved,
      localModelRecord({ id: 7822, provider_name: 'deepseek', model_type: '' }),
    ]);

    const result = await discoverSpaceModels({ requireComplete: true });
    expect(result.unavailableSources).toEqual([]);
    expect(values(result)).toEqual([
      'provider://default',
      'provider://cloud/managed-model',
      'provider://custom/openai/configured-model',
    ]);
  });

  it('keeps an existing reference publishable beside an unrelated model without a name', async () => {
    savedModels.mockResolvedValue([
      saved,
      localModelRecord({ id: 7822, provider_name: 'azure', model_type: '' }),
    ]);

    expect(
      await preflightWorkspaceBundleReferences(
        modelDocument('provider://custom/openai/configured-model'),
        []
      )
    ).toEqual([]);
  });

  it('reports a reference to a model that is not saved on this device', async () => {
    const issues = await preflightWorkspaceBundleReferences(
      modelDocument('provider://custom/openai/removed-model'),
      []
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      location: 'spec.models.default.modelRef',
      reference: 'provider://custom/openai/removed-model',
    });
  });

  it('stops publishing when the saved models cannot be read', async () => {
    savedModels.mockRejectedValue(new Error('store unreadable'));
    const issues = await preflightWorkspaceBundleReferences(
      modelDocument('provider://custom/openai/configured-model'),
      []
    );

    expect(issues.some(blocksLocalBundlePublish)).toBe(true);
  });

  it('rejects duplicate Cloud identities during preflight', async () => {
    get.mockImplementation(async () => ({ models: [cloud, cloud] }));

    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual(['cloud_catalog']);
  });
});
