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

import { useNewSessionModelQuota } from '@/hooks/useNewSessionModelQuota';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  auth: {} as any,
  spaces: {} as any,
}));
vi.mock('@/api/http', () => ({ fetchGet: mocks.get }));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => mocks.auth }));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: { getState: () => mocks.spaces },
}));
const selection = (ref: string | null) => ({
  space_id: 'space-1',
  selection: ref === null ? null : { model_ref: ref },
});
const renderQuota = () =>
  renderHook(() => useNewSessionModelQuota('space-1', mocks.auth.modelType));

describe('New Session metadata-only quota preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = {
      token: 'synthetic-token',
      email: 'fixture@example.test',
      user_id: 7,
      modelType: 'cloud',
      cloud_model_type: 'global-model',
      codex_model_type: 'codex-model',
    };
    mocks.spaces = {
      activeSpaceId: 'space-1',
      spaces: {
        'space-1': {
          id: 'space-1',
          userId: '7',
          sourceType: 'blank',
          status: 'active',
        },
      },
    };
    useUsageNoticeStore.setState({
      account: '7',
      incidents: [{ reason: 'credits' }],
      refreshing: false,
    });
    mocks.get.mockResolvedValue(
      selection('provider://custom/azure/deployment')
    );
  });
  afterEach(cleanup);

  it.each(['credits', 'trial-daily', 'trial-total', 'free-credits'] as const)(
    'uses the actual model for %s and only reads model-selection metadata',
    async (reason) => {
      useUsageNoticeStore.setState({ incidents: [{ reason }] });
      const { result } = renderQuota();
      expect(result.current).toMatchObject({ pending: true, blocked: true });
      await waitFor(() => expect(result.current.pending).toBe(false));
      expect(result.current).toMatchObject({
        blocked: false,
        effectiveModelType: 'custom',
      });
      await act(async () => {
        await result.current.beforeCreate();
      });
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(
        mocks.get.mock.calls.every(
          ([url, identity]) =>
            url === '/spaces/space-1/workspace-configuration/model-selection' &&
            identity.email === 'fixture@example.test' &&
            identity.user_id === 7
        )
      ).toBe(true);
    }
  );

  it.each([
    ['provider://cloud/space-model', 'custom', 'cloud', true],
    ['provider://local/ollama/fixture', 'cloud', 'local', false],
    ['provider://default', 'cloud', 'cloud', true],
    [null, 'cloud', 'cloud', true],
    ['provider://default', 'custom', 'custom', false],
    [null, 'local', 'local', false],
  ] as const)(
    'classifies %s with global %s',
    async (ref, globalType, actualType, blocked) => {
      mocks.auth.modelType = globalType;
      mocks.get.mockResolvedValue(selection(ref));
      const { result } = renderQuota();
      await waitFor(() => expect(result.current.pending).toBe(false));
      expect(result.current).toMatchObject({
        blocked,
        effectiveModelType: actualType,
      });
      if (blocked) {
        await act(async () => {
          await expect(result.current.beforeCreate()).rejects.toMatchObject({
            usageReason: 'credits',
          });
        });
      }
    }
  );

  it.each(['service', 'model-access'] as const)(
    'does not treat %s as account quota',
    async (reason) => {
      useUsageNoticeStore.setState({ incidents: [{ reason }] });
      const { result } = renderQuota();
      expect(result.current.blocked).toBe(false);
      await act(async () => {
        await result.current.beforeCreate();
      });
      expect(mocks.get).not.toHaveBeenCalled();
    }
  );

  it.each(['8', null])(
    'ignores another usage account (%s)',
    async (account) => {
      useUsageNoticeStore.setState({ account });
      const { result } = renderQuota();
      expect(result.current).toMatchObject({
        blocked: false,
        isCurrentAccount: false,
      });
      await act(async () => {
        await result.current.beforeCreate();
      });
      expect(mocks.get).not.toHaveBeenCalled();
    }
  );

  it.each(['malformed', 'missing', 'wrong-scope', 'unavailable'])(
    'fails closed on %s and supports retry',
    async (failure) => {
      if (failure === 'unavailable')
        mocks.get.mockRejectedValue(new Error('synthetic unavailable'));
      else
        mocks.get.mockResolvedValue(
          failure === 'missing'
            ? { space_id: 'space-1' }
            : failure === 'wrong-scope'
              ? { ...selection(null), space_id: 'other-space' }
              : selection('provider://not-a-model')
        );
      const { result } = renderQuota();
      await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
      expect(result.current.blocked).toBe(true);
      mocks.get.mockResolvedValue(selection('provider://local/ollama/fixture'));
      act(() => result.current.refresh());
      expect(result.current.pending).toBe(true);
      await waitFor(() => expect(result.current.blocked).toBe(false));
      expect(result.current.error).toBeUndefined();
    }
  );

  const mutations = [
    'token',
    'email',
    'user_id',
    'space',
    'owner',
    'source',
    'status',
    'modelType',
    'cloud_model_type',
    'codex_model_type',
  ] as const;
  const mutate = (field: (typeof mutations)[number]) => {
    if (field === 'space') mocks.spaces.activeSpaceId = 'other-space';
    else if (field === 'owner') mocks.spaces.spaces['space-1'].userId = '8';
    else if (field === 'source')
      mocks.spaces.spaces['space-1'].sourceType = 'legacy';
    else if (field === 'status')
      mocks.spaces.spaces['space-1'].status = 'archived';
    else mocks.auth[field] = field === 'user_id' ? 8 : `changed-${field}`;
  };

  it.each(mutations)(
    'rejects late %s changes during the send-time preflight',
    async (field) => {
      const { result } = renderQuota();
      await waitFor(() => expect(result.current.blocked).toBe(false));
      let resolve!: (value: unknown) => void;
      mocks.get.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          })
      );
      const pending = result.current.beforeCreate();
      const rejection = expect(pending).rejects.toThrow();
      mutate(field);
      await act(async () => {
        resolve(selection('provider://default'));
        await rejection;
      });
    }
  );

  it('does not apply an old background response after switching Space', async () => {
    let resolve!: (value: unknown) => void;
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { result, rerender } = renderHook(
      ({ id }) => useNewSessionModelQuota(id, mocks.auth.modelType),
      { initialProps: { id: 'space-1' } }
    );
    mocks.spaces.activeSpaceId = 'space-2';
    mocks.spaces.spaces['space-2'] = {
      id: 'space-2',
      userId: '7',
      sourceType: 'blank',
      status: 'active',
    };
    mocks.get.mockResolvedValue({
      ...selection('provider://cloud/current'),
      space_id: 'space-2',
    });
    rerender({ id: 'space-2' });
    await waitFor(() =>
      expect(result.current.effectiveModelType).toBe('cloud')
    );
    await act(async () => {
      resolve(selection('provider://custom/azure/old'));
    });
    expect(result.current).toMatchObject({
      blocked: true,
      effectiveModelType: 'cloud',
    });
  });

  it('rechecks selection on send instead of trusting the earlier preview', async () => {
    const { result } = renderQuota();
    await waitFor(() => expect(result.current.blocked).toBe(false));
    mocks.get.mockResolvedValue(selection('provider://cloud/new-default'));
    await act(async () => {
      await expect(result.current.beforeCreate()).rejects.toMatchObject({
        usageReason: 'credits',
      });
    });
    expect(result.current).toMatchObject({
      blocked: true,
      effectiveModelType: 'cloud',
    });
  });

  it('returns a guard for identity changes during Session creation', async () => {
    const { result } = renderQuota();
    await waitFor(() => expect(result.current.blocked).toBe(false));
    let assertCurrent!: () => void;
    await act(async () => {
      assertCurrent = await result.current.beforeCreate();
    });
    mocks.auth.email = 'another@example.test';
    expect(assertCurrent).toThrow();
  });
});
