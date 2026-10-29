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
  getSpaceModelChoice,
  parseSpaceModelChoice,
  resolveSpaceModelChoice,
  setSpaceModelChoice,
} from '@/lib/spaceModelChoice';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useSpaceStore, type Space } from '@/store/spaceStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { token: 'token', email: 'a@example.test', user_id: 'account-a' },
  providers: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));
vi.mock('@/lib/configuredModels', () => ({
  fetchConfiguredProviders: mocks.providers,
}));

const space = (id: string, metadata: Space['metadata'] = {}): Space => ({
  id,
  name: id,
  sourceType: 'blank',
  status: 'active',
  schemaVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  metadata,
});
const cloud = (id: string) => ({
  id,
  display_name: id,
  model_type: id,
  model_platform: 'openai',
  kind: 'chat',
});
const byok = {
  modelType: 'custom' as const,
  provider_id: 2,
  model_platform: 'openai',
  model_type: 'personal-model',
};

describe('Space model choice', () => {
  let updateSpaceOnServer: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.user_id = 'account-a';
    updateSpaceOnServer = vi.fn(async () => {});
    useSpaceStore.setState({
      spaces: {
        'space-a': space('space-a'),
        'space-b': space('space-b', {
          modelSelection: { modelType: 'cloud', cloud_model_type: 'gpt' },
        }),
        legacy_account: { ...space('legacy_account'), sourceType: 'legacy' },
      },
      updateSpaceOnServer,
    } as never);
    useCloudModelStore.setState({
      models: [cloud('gpt'), cloud('claude')] as never,
      retired: [{ id: 'old', replaced_by_model_id: 'claude' }] as never,
      defaultModelId: 'gpt',
    });
  });

  it('saves a pick to one Space only, locally and on the server', async () => {
    await setSpaceModelChoice('space-a', byok);
    expect(getSpaceModelChoice('space-a')).toEqual(byok);
    expect(getSpaceModelChoice('space-b')).toEqual({
      modelType: 'cloud',
      cloud_model_type: 'gpt',
    });
    expect(updateSpaceOnServer).toHaveBeenCalledTimes(1);
    expect(updateSpaceOnServer).toHaveBeenCalledWith('space-a', {
      metadata: { modelSelection: byok },
    });
  });

  it('keeps credentials and launch-only fields out of the saved model', async () => {
    await setSpaceModelChoice('space-a', {
      ...byok,
      api_key: 'secret',
      model_ref: 'provider://custom/openai/personal-model',
      thinking_effort: 'high',
    } as never);
    expect(getSpaceModelChoice('space-a')).toEqual(byok);
  });

  it('sends only the newest of several quick picks', async () => {
    let release!: () => void;
    updateSpaceOnServer.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    const first = setSpaceModelChoice('space-a', byok);
    await Promise.resolve();
    const second = setSpaceModelChoice('space-a', {
      modelType: 'cloud',
      cloud_model_type: 'claude',
    });
    const third = setSpaceModelChoice('space-a', {
      modelType: 'cloud',
      cloud_model_type: 'gpt',
    });
    release();
    await Promise.all([first, second, third]);
    expect(updateSpaceOnServer.mock.calls.map(([, input]) => input)).toEqual([
      { metadata: { modelSelection: byok } },
      {
        metadata: {
          modelSelection: { modelType: 'cloud', cloud_model_type: 'gpt' },
        },
      },
    ]);
    expect(getSpaceModelChoice('space-a')?.cloud_model_type).toBe('gpt');
  });

  it('does not write for an unchanged pick, a legacy Space, or after an account switch', async () => {
    await setSpaceModelChoice('space-b', {
      modelType: 'cloud',
      cloud_model_type: 'gpt',
    });
    await setSpaceModelChoice('legacy_account', byok);
    expect(getSpaceModelChoice('legacy_account')).toBeNull();
    const write = setSpaceModelChoice('space-a', byok);
    mocks.auth.user_id = 'account-b';
    await write;
    expect(updateSpaceOnServer).not.toHaveBeenCalled();
  });

  it('reads malformed saved values as no saved model', () => {
    expect(parseSpaceModelChoice({ modelType: 'custom' })).toBeNull();
    expect(parseSpaceModelChoice({ modelType: 'cloud' })).toBeNull();
    expect(parseSpaceModelChoice('cloud')).toBeNull();
    expect(parseSpaceModelChoice({ modelType: 'other' })).toBeNull();
  });

  describe('availability', () => {
    const current = () => {};
    it('keeps an available Cloud model and follows a retired one to its replacement', async () => {
      await expect(
        resolveSpaceModelChoice(
          { modelType: 'cloud', cloud_model_type: 'claude' },
          current
        )
      ).resolves.toEqual({ modelType: 'cloud', cloud_model_type: 'claude' });
      vi.spyOn(
        useCloudModelStore.getState(),
        'fetchCloudModels'
      ).mockResolvedValue([]);
      await expect(
        resolveSpaceModelChoice(
          { modelType: 'cloud', cloud_model_type: 'old' },
          current
        )
      ).resolves.toEqual({ modelType: 'cloud', cloud_model_type: 'claude' });
    });

    it('reports a Cloud model gone from the catalog as unavailable', async () => {
      vi.spyOn(
        useCloudModelStore.getState(),
        'fetchCloudModels'
      ).mockResolvedValue([]);
      await expect(
        resolveSpaceModelChoice(
          { modelType: 'cloud', cloud_model_type: 'withdrawn' },
          current
        )
      ).resolves.toBeNull();
    });

    it('checks a BYOK model against the saved, valid configurations', async () => {
      mocks.providers.mockResolvedValue([
        {
          id: 2,
          provider_name: 'openai',
          model_type: 'renamed-model',
          is_valid: 2,
        },
      ]);
      await expect(resolveSpaceModelChoice(byok, current)).resolves.toEqual({
        ...byok,
        model_type: 'renamed-model',
      });
      mocks.providers.mockResolvedValue([
        { id: 2, provider_name: 'openai', model_type: 'x', is_valid: 1 },
      ]);
      await expect(resolveSpaceModelChoice(byok, current)).resolves.toBeNull();
      mocks.providers.mockResolvedValue([]);
      await expect(resolveSpaceModelChoice(byok, current)).resolves.toBeNull();
      mocks.providers.mockRejectedValue(new Error('offline'));
      await expect(resolveSpaceModelChoice(byok, current)).rejects.toThrow(
        'offline'
      );
    });
  });
});
