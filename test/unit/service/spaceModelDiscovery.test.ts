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

import { resolveSpaceModelBinding } from '@/lib/spaceModelBinding';
import { discoverSpaceModels } from '@/service/spaceModelDiscovery';
import {
  blocksLocalBundlePublish,
  preflightWorkspaceBundleReferences,
} from '@/service/workspaceBundleReferencePreflight';
import type { WorkspaceConfigurationDocument } from '@/service/workspaceConfigurationApi';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { token: 'fixture-token', user_id: 41, email: 'fixture@example.test' },
}));

vi.mock('@/api/http', () => ({ proxyFetchGet: get, fetchGet: vi.fn() }));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => auth }));

const cloud = {
  id: 'managed-model',
  model_type: 'managed-deployment',
  model_platform: 'azure',
  display_name: 'Managed model',
  provider_family: 'openai',
  kind: 'chat',
};
const metadata = {
  category: 'custom',
  model_platform: 'openai',
  model_type: 'configured-model',
  available: true,
};
const legacy = {
  id: 7821,
  user_id: 41,
  provider_name: 'azure',
  model_type: 'wrapper',
  is_valid: 2,
  encrypted_config: {
    model_platform: 'openai',
    model_type: 'configured-model',
    secret: 'fixture-private-extra',
  },
  api_key: 'fixture-private-key',
  endpoint_url: 'https://fixture-private.example',
};
const missing = () => Object.assign(new Error('Not Found'), { status: 404 });
const values = (result: Awaited<ReturnType<typeof discoverSpaceModels>>) =>
  result.items.map((item) => item.value);

const legacyPage = (page: number, total = 201) => ({
  page,
  size: 100,
  total,
  pages: Math.ceil(total / 100),
  items: Array.from(
    { length: Math.min(100, Math.max(total - (page - 1) * 100, 0)) },
    (_, index) => {
      const id = (page - 1) * 100 + index + 1;
      return {
        ...legacy,
        id,
        encrypted_config: {
          model_platform: 'openai',
          model_type: `model-${id}`,
        },
      };
    }
  ),
});

const mockLegacyPages = (respond: (page: number) => unknown) => {
  get.mockImplementation(async (url, params) => {
    if (url === '/api/v1/cloud-models') return { models: [cloud] };
    if (url === '/api/v1/provider-models') throw missing();
    return respond(params.page);
  });
};

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

describe('global model catalog compatibility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'false');
    Object.assign(auth, {
      token: 'fixture-token',
      user_id: 41,
      email: 'fixture@example.test',
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the existing provider source only for a missing metadata route, preserving Cloud and resolvable overrides', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [cloud] };
      if (url === '/api/v1/provider-models') throw missing();
      if (url === '/api/v1/providers') return { items: [legacy], pages: 1 };
      throw new Error('unexpected request');
    });
    const result = await discoverSpaceModels();
    expect(values(result)).toEqual([
      'provider://default',
      'provider://cloud/managed-model',
      'provider://custom/openai/configured-model',
    ]);
    expect(result.unavailableSources).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-private|7821|user_id|api_key|endpoint_url|encrypted_config/
    );
    expect(get.mock.calls).toEqual([
      ['/api/v1/cloud-models', { kind: 'chat' }],
      ['/api/v1/provider-models'],
      ['/api/v1/providers', { page: 1, size: 100 }],
    ]);
    // Real launch-time adapter, same synthetic HTTP source, no model call.
    const resolved = await resolveSpaceModelBinding(
      result.items[2].value,
      () => {}
    );
    expect(resolved.selection).toMatchObject({
      provider_id: legacy.id,
      modelType: 'custom',
      model_platform: 'openai',
      model_type: 'configured-model',
      model_ref: result.items[2].value,
    });
  });

  it('projects legacy metadata without reading credential or endpoint fields', async () => {
    const provider = { ...legacy };
    for (const key of ['api_key', 'endpoint_url'])
      Object.defineProperty(provider, key, {
        get: () => {
          throw new Error(`read forbidden ${key}`);
        },
      });
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [] };
      if (url === '/api/v1/provider-models') throw missing();
      return [provider];
    });
    const result = await discoverSpaceModels();
    expect(result.unavailableSources).toEqual([]);
    expect(values(result)).toContain(
      'provider://custom/openai/configured-model'
    );
  });

  it('reads every legacy page, deduplicates repeated row IDs, and disables ambiguous logical references', async () => {
    const local = {
      ...legacy,
      id: 92,
      provider_name: 'ollama',
      encrypted_config: { model_type: 'org/model:8b' },
    };
    get.mockImplementation(async (url, params) => {
      if (url === '/api/v1/cloud-models') return { models: [] };
      if (url === '/api/v1/provider-models') throw missing();
      return {
        items:
          params.page === 1 ? [legacy, local] : [local, { ...legacy, id: 93 }],
        pages: 2,
      };
    });
    const result = await discoverSpaceModels();
    expect(values(result)).toEqual([
      'provider://default',
      'provider://custom/openai/configured-model',
      'provider://local/ollama/org%2Fmodel%3A8b',
    ]);
    expect(result.items[1]).toMatchObject({
      disabled: true,
      reason: 'model_ambiguous',
    });
    expect(result.items[2]).toMatchObject({
      disabled: false,
      availability: 'available',
    });
    expect(get).toHaveBeenCalledWith('/api/v1/providers', {
      page: 2,
      size: 100,
    });
    const resolved = await resolveSpaceModelBinding(
      result.items[2].value,
      () => {}
    );
    expect(resolved.selection).toMatchObject({
      modelType: 'local',
      model_platform: 'ollama',
      model_type: 'org/model:8b',
    });
  });

  it('skips managed Cloud in local proxy mode and supports the older local API', async () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true');
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/provider-models') throw missing();
      if (url === '/api/v1/providers') return [legacy];
      throw new Error('unexpected managed catalog request');
    });
    const result = await discoverSpaceModels();
    expect(result.unavailableSources).toEqual([]);
    expect(values(result)).toEqual([
      'provider://default',
      'provider://custom/openai/configured-model',
    ]);
    expect(get.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/provider-models',
      '/api/v1/providers',
    ]);
  });

  it.each([401, 403, 500])(
    'keeps Cloud on provider HTTP %s and does not bypass the failure through /providers',
    async (status) => {
      get.mockImplementation(async (url) => {
        if (url === '/api/v1/cloud-models') return { models: [cloud] };
        throw Object.assign(new Error('fixture-private diagnostic'), {
          status,
        });
      });
      const result = await discoverSpaceModels();
      expect(values(result)).toEqual([
        'provider://default',
        'provider://cloud/managed-model',
      ]);
      expect(result.unavailableSources).toEqual(['provider_catalog']);
      expect(get).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(result)).not.toContain('fixture-private');
    }
  );

  it('keeps Cloud if both provider metadata and compatibility source are missing', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [cloud] };
      throw missing();
    });
    const result = await discoverSpaceModels();
    expect(values(result)).toEqual([
      'provider://default',
      'provider://cloud/managed-model',
    ]);
    expect(result.unavailableSources).toEqual(['provider_catalog']);
  });

  it('reports malformed successful metadata without treating it as an empty catalog or triggering fallback', async () => {
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models' ? { models: [cloud] } : { unexpected: [] }
    );
    const result = await discoverSpaceModels();
    expect(result.unavailableSources).toEqual(['provider_catalog']);
    expect(values(result)).toContain('provider://cloud/managed-model');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps configured models when Cloud fails and reports both failures separately', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/provider-models') return [metadata];
      throw new Error('offline');
    });
    expect(await discoverSpaceModels()).toMatchObject({
      items: [
        { value: 'provider://default' },
        { value: 'provider://custom/openai/configured-model' },
      ],
      unavailableSources: ['cloud_catalog'],
    });
    get.mockRejectedValue(new Error('offline'));
    expect(await discoverSpaceModels()).toMatchObject({
      items: [{ value: 'provider://default' }],
      unavailableSources: ['cloud_catalog', 'provider_catalog'],
    });
  });

  it('retries fresh after failure, without persisting a missing-route or permission result', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [cloud] };
      throw Object.assign(new Error('Forbidden'), { status: 403 });
    });
    expect((await discoverSpaceModels()).unavailableSources).toEqual([
      'provider_catalog',
    ]);
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models' ? { models: [cloud] } : [metadata]
    );
    const result = await discoverSpaceModels();
    expect(result.unavailableSources).toEqual([]);
    expect(values(result)).toContain(
      'provider://custom/openai/configured-model'
    );
  });

  it('distinguishes empty successful sources and does not fetch legacy credentials on a current API', async () => {
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models' ? { models: [] } : []
    );
    const result = await discoverSpaceModels();
    expect(values(result)).toEqual(['provider://default']);
    expect(result.unavailableSources).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each(['account', 'token', 'environment'] as const)(
    'discards all results on %s change before metadata completion and never starts compatibility',
    async (change) => {
      let reject!: (error: Error) => void;
      get.mockImplementation(async (url) =>
        url === '/api/v1/cloud-models'
          ? { models: [cloud] }
          : new Promise((_resolve, rejectPromise) => {
              reject = rejectPromise;
            })
      );
      const pending = discoverSpaceModels();
      if (change === 'account') auth.user_id = 42;
      else if (change === 'token') auth.token = 'fixture-token-b';
      else vi.stubEnv('VITE_BASE_URL', 'https://other-fixture.example');
      reject(missing());
      await expect(pending).rejects.toThrow('model_catalog_account_changed');
      expect(get).toHaveBeenCalledTimes(2);
    }
  );

  it('stops a legacy page walk on account change, then gets a fresh catalog for the new account', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [] };
      if (url === '/api/v1/provider-models') throw missing();
      auth.user_id = 42;
      return { items: [legacy], pages: 2 };
    });
    await expect(discoverSpaceModels()).rejects.toThrow(
      'model_catalog_account_changed'
    );
    expect(get).toHaveBeenCalledTimes(3);
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models' ? { models: [] } : []
    );
    expect(values(await discoverSpaceModels())).toEqual(['provider://default']);
  });

  it('does not expose a partial provider list if later pagination fails or the supported limit is exceeded', async () => {
    get.mockImplementation(async (url, params) => {
      if (url === '/api/v1/cloud-models') return { models: [cloud] };
      if (url === '/api/v1/provider-models') throw missing();
      if (params.page === 2) throw new Error('offline');
      return { items: [legacy], pages: 2 };
    });
    expect(values(await discoverSpaceModels())).toEqual([
      'provider://default',
      'provider://cloud/managed-model',
    ]);
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [cloud] };
      if (url === '/api/v1/provider-models') throw missing();
      return Array.from({ length: 513 }, (_, id) => ({ ...legacy, id }));
    });
    const result = await discoverSpaceModels();
    expect(result.unavailableSources).toEqual(['provider_catalog']);
    expect(values(result)).toEqual([
      'provider://default',
      'provider://cloud/managed-model',
    ]);
  });

  it('keeps unavailable and duplicate metadata disabled, and does not normalize malformed runtime identities', async () => {
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models'
        ? { models: [] }
        : [
            metadata,
            metadata,
            { ...metadata, model_type: 'invalid', available: false },
            { ...metadata, model_type: ' whitespace' },
            { ...metadata, model_platform: ' space' },
            { ...metadata, model_type: '../traversal' },
          ]
    );
    const result = await discoverSpaceModels();
    expect(values(result)).toEqual([
      'provider://default',
      'provider://custom/openai/configured-model',
      'provider://custom/openai/invalid',
    ]);
    expect(result.items[1]).toMatchObject({
      disabled: true,
      reason: 'model_ambiguous',
    });
    expect(result.items[2]).toMatchObject({
      disabled: true,
      reason: 'model_unavailable',
    });
  });
  it('marks incomplete model metadata unavailable for authoring preflight', async () => {
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models'
        ? { models: [cloud, { id: 'broken' }] }
        : [metadata, { category: 'future' }]
    );
    const result = await discoverSpaceModels({ requireComplete: true });
    expect(result.unavailableSources).toEqual([
      'cloud_catalog',
      'provider_catalog',
    ]);
    expect(values(result)).toEqual(['provider://default']);
  });

  it('cannot verify a Cloud model from a self-hosted deployment', async () => {
    vi.stubEnv('VITE_USE_LOCAL_PROXY', 'true');
    get.mockResolvedValue([metadata]);
    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual(['cloud_catalog']);
  });
  it.each([
    { items: [legacy], pages: '2' },
    { items: [], pages: 2 },
    { items: [legacy, legacy], pages: 1 },
  ])(
    'rejects incomplete or drifting legacy pagination during preflight: %j',
    async (page) => {
      get.mockImplementation(async (url) => {
        if (url === '/api/v1/cloud-models') return { models: [cloud] };
        if (url === '/api/v1/provider-models') throw missing();
        return page;
      });
      expect(
        (await discoverSpaceModels({ requireComplete: true }))
          .unavailableSources
      ).toEqual(['provider_catalog']);
    }
  );

  it('rejects duplicate Cloud identities and missing availability during preflight', async () => {
    get.mockImplementation(async (url) =>
      url === '/api/v1/cloud-models'
        ? { models: [cloud, cloud] }
        : [{ ...metadata, available: undefined }]
    );
    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual(['cloud_catalog', 'provider_catalog']);
  });
  it('accepts an authoritative empty legacy catalog with zero pages', async () => {
    get.mockImplementation(async (url) => {
      if (url === '/api/v1/cloud-models') return { models: [] };
      if (url === '/api/v1/provider-models') throw missing();
      return { items: [], page: 1, size: 100, total: 0, pages: 0 };
    });
    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual([]);
  });
  it('marks the provider catalog unavailable when page 2 shrinks from 201 to 200 records', async () => {
    mockLegacyPages((page) => legacyPage(page, page === 1 ? 201 : 200));
    const result = await discoverSpaceModels({ requireComplete: true });
    expect(result.unavailableSources).toEqual(['provider_catalog']);
  });

  it.each(['model-1', 'model-201'])(
    'blocks publishing %s when the legacy catalog shrinks between pages',
    async (model) => {
      mockLegacyPages((page) => legacyPage(page, page === 1 ? 201 : 200));
      const reference = `provider://custom/openai/${model}`;
      const findings = await preflightWorkspaceBundleReferences(
        modelDocument(reference),
        []
      );
      expect(findings).toEqual([
        {
          location: 'spec.models.default.modelRef',
          reference,
          code: 'verification_unavailable',
        },
      ]);
      expect(findings.some(blocksLocalBundlePublish)).toBe(true);
    }
  );

  it('accepts stable complete pagination including the final partial page', async () => {
    mockLegacyPages((page) => legacyPage(page));
    const result = await discoverSpaceModels({ requireComplete: true });
    expect(result.unavailableSources).toEqual([]);
    expect(
      result.items.filter((item) => item.source === 'custom_catalog')
    ).toHaveLength(201);
    expect(values(result)).toContain('provider://custom/openai/model-201');
    expect(
      get.mock.calls
        .filter(([url]) => url === '/api/v1/providers')
        .map(([, params]) => params.page)
    ).toEqual([1, 2, 3]);
    expect(
      await preflightWorkspaceBundleReferences(
        modelDocument('provider://custom/openai/model-201'),
        []
      )
    ).toEqual([]);
  });

  it.each(['pages', 'total', 'page', 'size'])(
    'requires %s metadata on every page in strict mode',
    async (field) => {
      mockLegacyPages((page) => {
        const response: Record<string, unknown> = legacyPage(page);
        if (page === 2) delete response[field];
        return response;
      });
      expect(
        (await discoverSpaceModels({ requireComplete: true }))
          .unavailableSources
      ).toEqual(['provider_catalog']);
    }
  );

  it.each([
    ['growth', (page: number) => legacyPage(page, page === 1 ? 201 : 301)],
    [
      'total changed with same page count',
      (page: number) => legacyPage(page, page === 1 ? 201 : 202),
    ],
    [
      'wrong page sequence',
      (page: number) => ({ ...legacyPage(page), page: 1 }),
    ],
    [
      'changed page size',
      (page: number) => ({ ...legacyPage(page), size: page === 1 ? 100 : 50 }),
    ],
    [
      'contradictory total and pages',
      (page: number) => ({ ...legacyPage(page), pages: 2 }),
    ],
    [
      'duplicate ID across pages',
      (page: number) => {
        const response = legacyPage(page);
        if (page === 2) response.items[0].id = 1;
        return response;
      },
    ],
    [
      'short final page',
      (page: number) => ({
        ...legacyPage(page),
        ...(page === 3 ? { items: [] } : {}),
      }),
    ],
    [
      'oversized final page',
      (page: number) => ({
        ...legacyPage(page),
        ...(page === 3 ? { items: legacyPage(3, 202).items } : {}),
      }),
    ],
  ])('rejects %s during strict legacy discovery', async (_name, respond) => {
    mockLegacyPages(respond);
    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual(['provider_catalog']);
  });

  it('cannot claim completeness for a bare legacy array but keeps default discovery compatible', async () => {
    mockLegacyPages(() => [legacy]);
    expect(
      (await discoverSpaceModels({ requireComplete: true })).unavailableSources
    ).toEqual(['provider_catalog']);
    expect((await discoverSpaceModels()).unavailableSources).toEqual([]);
    expect(values(await discoverSpaceModels())).toContain(
      'provider://custom/openai/configured-model'
    );
  });

  it('preserves default discovery behavior for legacy pagination drift', async () => {
    mockLegacyPages((page) => legacyPage(page, page === 1 ? 201 : 200));
    const result = await discoverSpaceModels();
    expect(result.unavailableSources).toEqual([]);
    expect(
      result.items.filter((item) => item.source === 'custom_catalog')
    ).toHaveLength(200);
  });
});
