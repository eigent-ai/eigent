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

import { buildAgentModelConfigFromProvider } from '@/lib/modelConfig';
import {
  fetchRuntimeModelProviders,
  fetchSpaceModelSelection,
  recoverSpaceSessionModel,
  resolveSpaceModelBinding,
} from '@/lib/spaceModelBinding';
import {
  parseSpaceModelReference,
  spaceModelReference,
} from '@/lib/spaceModelReference';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { get, localGet } = vi.hoisted(() => ({
  get: vi.fn(),
  localGet: vi.fn(),
}));
vi.mock('@/api/http', () => ({ proxyFetchGet: get, fetchGet: localGet }));

const cloud = {
  id: 'fixture',
  display_name: 'Fixture',
  provider_family: 'openai',
  model_platform: 'azure',
  model_type: 'deployment',
  kind: 'chat',
  capabilities: { request_compatibility: { preferred_transport: 'responses' } },
};
const provider = {
  id: 42,
  provider_name: 'azure',
  model_type: 'deployment',
  api_key: 'synthetic-key',
  endpoint_url: 'https://synthetic.example',
  is_valid: 2,
  encrypted_config: {
    model_config_dict: { temperature: 0.3 },
    api_mode: 'responses',
    model_capability: { fixture: true },
    api_version: 'fixture-version',
  },
};

describe('Space model binding adapter', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([
    { category: 'cloud' as const, modelId: 'fixture' },
    { category: 'custom' as const, platform: 'azure', modelId: 'deployment' },
    { category: 'local' as const, platform: 'ollama', modelId: 'org/model:8b' },
  ])(
    'round-trips a portable identity without provider binding IDs',
    (identity) => {
      const ref = spaceModelReference(identity);
      expect(parseSpaceModelReference(ref)).toEqual(identity);
      expect(ref).not.toMatch(/42|synthetic-key|https/);
    }
  );
  it.each([
    'provider://unknown',
    'provider://cloud/fixture?key=secret',
    'provider://custom/azure/../../secret',
    'provider://cloud/%00',
    'provider://cloud/%ZZ',
    'provider://local/ollama/',
  ])('rejects unsupported or malformed references: %s', (ref) =>
    expect(parseSpaceModelReference(ref)).toBeNull()
  );
  it('uses exact Cloud catalog type/platform/transport without acquiring a key or changing defaults', async () => {
    get.mockResolvedValue({ models: [cloud], default_model_id: 'different' });
    const bound = await resolveSpaceModelBinding(
      'provider://cloud/fixture',
      () => {}
    );
    expect(bound.cloudModel?.model).toMatchObject(cloud);
    expect(bound.selection).toEqual({
      modelType: 'cloud',
      cloud_model_type: 'fixture',
      model_platform: 'azure',
      model_type: 'deployment',
      model_ref: 'provider://cloud/fixture',
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/v1/cloud-models', { kind: 'chat' });
  });
  it('rejects retired Cloud replacements and unknown models instead of silently switching', async () => {
    get.mockResolvedValue({
      models: [cloud],
      default_model_id: 'fixture',
      retired: [{ id: 'retired', replaced_by_model_id: 'fixture' }],
    });
    await expect(
      resolveSpaceModelBinding('provider://cloud/retired', () => {})
    ).rejects.toThrow('unavailable');
    await expect(
      resolveSpaceModelBinding('provider://cloud/missing', () => {})
    ).rejects.toThrow('unavailable');
  });
  it.each(['custom', 'local'] as const)(
    'keeps all %s binding fields together and reads all provider pages',
    async (category) => {
      const config =
        category === 'local'
          ? {
              ...provider,
              provider_name: 'ollama',
              model_type: 'wrapper',
              encrypted_config: {
                ...provider.encrypted_config,
                model_platform: 'ollama',
                model_type: 'org/model:8b',
              },
            }
          : provider;
      get
        .mockResolvedValueOnce({
          items: [{ ...provider, id: 1, model_type: 'other' }],
          pages: 2,
        })
        .mockResolvedValueOnce({ items: [config], pages: 2 });
      const ref =
        category === 'local'
          ? 'provider://local/ollama/org%2Fmodel%3A8b'
          : 'provider://custom/azure/deployment';
      const bound = await resolveSpaceModelBinding(ref, () => {});
      expect(bound.provider).toBe(config);
      expect(bound.selection.provider_id).toBe(42);
      expect(JSON.stringify(bound.selection)).not.toMatch(
        /synthetic|api_key|endpoint_url|api_mode|model_capability/
      );
      expect(buildAgentModelConfigFromProvider(bound.provider!)).toMatchObject({
        api_key: 'synthetic-key',
        api_url: 'https://synthetic.example',
        model_config_dict: { temperature: 0.3 },
        extra_params: {
          api_mode: 'responses',
          model_capability: { fixture: true },
          api_version: 'fixture-version',
        },
      });
      expect(get).toHaveBeenNthCalledWith(2, '/api/v1/providers', {
        page: 2,
        size: 100,
      });
    }
  );
  it('rejects invalid and ambiguous providers, including duplicate nonpreferred matches', async () => {
    get.mockResolvedValue([{ ...provider, is_valid: 1 }]);
    await expect(
      resolveSpaceModelBinding('provider://custom/azure/deployment', () => {})
    ).rejects.toThrow('unavailable');
    get.mockResolvedValue([provider, { ...provider, id: 43, prefer: true }]);
    await expect(
      resolveSpaceModelBinding('provider://custom/azure/deployment', () => {})
    ).rejects.toThrow('More than one');
  });
  it('checks account/selection identity again before returning fetched configuration', async () => {
    let current = true;
    const assertCurrent = () => {
      if (!current) throw new Error('scope changed');
    };
    get.mockImplementation(async () => {
      current = false;
      return [provider];
    });
    await expect(
      resolveSpaceModelBinding(
        'provider://custom/azure/deployment',
        assertCurrent
      )
    ).rejects.toThrow('scope changed');
  });
  it('scopes the materialized selection to the requested Space and account', async () => {
    localGet.mockResolvedValue({ space_id: 'wrong-space', selection: null });
    await expect(
      fetchSpaceModelSelection(
        'space-a',
        { email: 'fixture@example.test', userId: 'a' },
        () => {}
      )
    ).rejects.toThrow('unavailable');
    expect(localGet).toHaveBeenCalledWith(
      '/spaces/space-a/workspace-configuration/model-selection',
      { email: 'fixture@example.test', user_id: 'a' }
    );
    localGet.mockResolvedValue({ space_id: 'space-a', selection: null });
    expect(
      await fetchSpaceModelSelection(
        'space-a',
        { email: 'fixture@example.test' },
        () => {}
      )
    ).toBeNull();
  });
  describe('durable Session model recovery', () => {
    const identity = { email: 'fixture@example.test', userId: 'account-a' };
    const selection = {
      modelType: 'cloud' as const,
      cloud_model_type: 'accepted-model',
      model_platform: 'azure',
      model_type: 'accepted-deployment',
      model_ref: 'provider://cloud/accepted-model',
    };
    const accepted = {
      space_id: 'space-a',
      project_id: 'session-a',
      accepted: { selection },
      restore_pending: false,
    };

    it.each([false, true])(
      'returns the scoped durable pin even when restore_pending is %s',
      async (restorePending) => {
        localGet.mockResolvedValue({
          ...accepted,
          restore_pending: restorePending,
        });
        const assertCurrent = vi.fn();
        expect(
          await recoverSpaceSessionModel(
            'space-a',
            'session-a',
            identity,
            assertCurrent
          )
        ).toBe(selection);
        expect(assertCurrent).toHaveBeenCalledTimes(2);
        expect(localGet).toHaveBeenCalledWith(
          '/spaces/space-a/workspace-configuration/session-model',
          {
            project_id: 'session-a',
            email: 'fixture@example.test',
            user_id: 'account-a',
          }
        );
        expect(get).not.toHaveBeenCalled();
      }
    );

    it.each([
      { space_id: 'other-space', project_id: 'session-a' },
      { space_id: 'space-a', project_id: 'other-session' },
    ])('rejects accepted facts from another scope: %j', async (scope) => {
      localGet.mockResolvedValue({ ...accepted, ...scope });
      await expect(
        recoverSpaceSessionModel('space-a', 'session-a', identity, () => {})
      ).rejects.toThrow('unavailable');
    });

    it('rejects pending cloud restoration without durable accepted facts as unconfirmed', async () => {
      localGet.mockResolvedValue({
        ...accepted,
        accepted: null,
        restore_pending: true,
      });
      await expect(
        recoverSpaceSessionModel('space-a', 'session-a', identity, () => {})
      ).rejects.toThrow('has not been confirmed');
      expect(get).not.toHaveBeenCalled();
    });

    it('returns null only after completed restoration reports no accepted request', async () => {
      localGet.mockResolvedValue({ ...accepted, accepted: null });
      expect(
        await recoverSpaceSessionModel(
          'space-a',
          'session-a',
          { email: 'fixture@example.test' },
          () => {}
        )
      ).toBeNull();
      expect(localGet).toHaveBeenCalledWith(
        '/spaces/space-a/workspace-configuration/session-model',
        { project_id: 'session-a', email: 'fixture@example.test' }
      );
      expect(get).not.toHaveBeenCalled();
    });

    it('rejects a scoped response that omits accepted facts instead of inferring a new Session', async () => {
      localGet.mockResolvedValue({
        space_id: 'space-a',
        project_id: 'session-a',
        restore_pending: false,
      });
      await expect(
        recoverSpaceSessionModel('space-a', 'session-a', identity, () => {})
      ).rejects.toThrow('unavailable');
    });

    it('rejects a durable pin if account or Session ownership changes while awaiting recovery', async () => {
      let resolve!: (value: typeof accepted) => void;
      localGet.mockReturnValue(
        new Promise<typeof accepted>((done) => {
          resolve = done;
        })
      );
      let current = true;
      const assertCurrent = vi.fn(() => {
        if (!current) throw new Error('scope changed');
      });
      const recovery = recoverSpaceSessionModel(
        'space-a',
        'session-a',
        identity,
        assertCurrent
      );
      expect(assertCurrent).toHaveBeenCalledTimes(1);
      const rejected = expect(recovery).rejects.toThrow('scope changed');
      current = false;
      resolve(accepted);
      await rejected;
      expect(assertCurrent).toHaveBeenCalledTimes(2);
      expect(get).not.toHaveBeenCalled();
    });
  });
  it('bounds a malformed unending provider catalog', async () => {
    get.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, id) => ({ ...provider, id })),
      pages: 1000,
    });
    await expect(fetchRuntimeModelProviders(() => {})).rejects.toThrow(
      'unavailable'
    );
    expect(get).toHaveBeenCalledTimes(6);
  });
});
