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

/**
 * useTriggerQueries — Unit Tests
 *
 * Covers four exported hooks and their cache-invalidation companion:
 *
 *  1. useTriggerListQuery      – project-scoped trigger list with filters
 *  2. useUserTriggerCountQuery – total trigger count for the current user
 *  3. useTriggerConfigQuery    – trigger-type config with staleTime
 *  4. useTriggerCacheInvalidation – five cache helpers (invalidate ×4, prefetch ×1)
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks (available inside vi.mock factories) ───────────────

const {
  mockProxyFetchProjectTriggers,
  mockProxyFetchTriggers,
  mockProxyFetchTriggerConfig,
} = vi.hoisted(() => ({
  mockProxyFetchProjectTriggers: vi.fn(),
  mockProxyFetchTriggers: vi.fn(),
  mockProxyFetchTriggerConfig: vi.fn(),
}));

vi.mock('@/service/triggerApi', () => ({
  proxyFetchProjectTriggers: mockProxyFetchProjectTriggers,
  proxyFetchTriggers: mockProxyFetchTriggers,
  proxyFetchTriggerConfig: mockProxyFetchTriggerConfig,
}));

// ── SUT import (after mocks) ─────────────────────────────────────────

import {
  useTriggerCacheInvalidation,
  useTriggerConfigQuery,
  useTriggerListQuery,
  useUserTriggerCountQuery,
} from '@/hooks/queries/useTriggerQueries';
import { TriggerStatus, TriggerType } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a fresh QueryClient per test (avoids cross-test cache leakage). */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

/** Wrap renderHook with QueryClientProvider. */
function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useTriggerQueries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. useTriggerListQuery
  // ═══════════════════════════════════════════════════════════════════

  describe('useTriggerListQuery', () => {
    it('should return empty result when projectId is null', async () => {
      const { result } = renderHook(() => useTriggerListQuery(null), {
        wrapper: createWrapper(queryClient),
      });

      // When projectId is null the query is disabled (enabled = false),
      // so it stays in pending status and never calls the API.
      expect(result.current.fetchStatus).toBe('idle');
      expect(result.current.data).toBeUndefined();
      expect(mockProxyFetchProjectTriggers).not.toHaveBeenCalled();
    });

    it('should call proxyFetchProjectTriggers with valid projectId', async () => {
      const mockResponse = {
        items: [{ id: 1, name: 'Trigger A' }],
        total: 1,
      };
      mockProxyFetchProjectTriggers.mockResolvedValueOnce(mockResponse);

      const { result } = renderHook(() => useTriggerListQuery('proj-123'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockProxyFetchProjectTriggers).toHaveBeenCalledWith(
        'proj-123',
        undefined,
        undefined,
        1,
        50
      );
      expect(result.current.data).toEqual(mockResponse);
    });

    it('should pass triggerType and status filters to API', async () => {
      mockProxyFetchProjectTriggers.mockResolvedValueOnce({
        items: [],
        total: 0,
      });

      renderHook(
        () =>
          useTriggerListQuery('proj-456', {
            triggerType: TriggerType.Webhook,
            status: TriggerStatus.Active,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() =>
        expect(mockProxyFetchProjectTriggers).toHaveBeenCalledWith(
          'proj-456',
          TriggerType.Webhook,
          TriggerStatus.Active,
          1,
          50
        )
      );
    });

    it('should use custom page and size values', async () => {
      mockProxyFetchProjectTriggers.mockResolvedValueOnce({
        items: [],
        total: 0,
      });

      renderHook(
        () =>
          useTriggerListQuery('proj-789', {
            page: 3,
            size: 25,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() =>
        expect(mockProxyFetchProjectTriggers).toHaveBeenCalledWith(
          'proj-789',
          undefined,
          undefined,
          3,
          25
        )
      );
    });

    it('should not fetch when enabled is false', async () => {
      renderHook(() => useTriggerListQuery('proj-abc', { enabled: false }), {
        wrapper: createWrapper(queryClient),
      });

      // Give a small window for any unexpected fetch
      await new Promise((r) => setTimeout(r, 50));

      expect(mockProxyFetchProjectTriggers).not.toHaveBeenCalled();
    });

    it('should not fetch when projectId is null regardless of enabled flag', async () => {
      const { result } = renderHook(
        () => useTriggerListQuery(null, { enabled: true }),
        { wrapper: createWrapper(queryClient) }
      );

      // enabled is true but !!null is false → combined enabled = false
      expect(result.current.fetchStatus).toBe('idle');
      expect(mockProxyFetchProjectTriggers).not.toHaveBeenCalled();
    });

    it('should propagate API errors', async () => {
      mockProxyFetchProjectTriggers.mockRejectedValueOnce(
        new Error('Server error')
      );

      const { result } = renderHook(() => useTriggerListQuery('proj-err'), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('Server error');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. useUserTriggerCountQuery
  // ═══════════════════════════════════════════════════════════════════

  describe('useUserTriggerCountQuery', () => {
    it('should return the total trigger count', async () => {
      mockProxyFetchTriggers.mockResolvedValueOnce({
        items: [],
        total: 42,
      });

      const { result } = renderHook(() => useUserTriggerCountQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockProxyFetchTriggers).toHaveBeenCalledWith(
        undefined,
        undefined,
        1,
        100
      );
      expect(result.current.data).toBe(42);
    });

    it('should return 0 when total is absent from response', async () => {
      mockProxyFetchTriggers.mockResolvedValueOnce({ items: [] });

      const { result } = renderHook(() => useUserTriggerCountQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(0);
    });

    it('should not fetch when enabled is false', async () => {
      renderHook(() => useUserTriggerCountQuery(false), {
        wrapper: createWrapper(queryClient),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockProxyFetchTriggers).not.toHaveBeenCalled();
    });

    it('should propagate API errors', async () => {
      mockProxyFetchTriggers.mockRejectedValueOnce(new Error('Auth required'));

      const { result } = renderHook(() => useUserTriggerCountQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect((result.current.error as Error).message).toBe('Auth required');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. useTriggerConfigQuery
  // ═══════════════════════════════════════════════════════════════════

  describe('useTriggerConfigQuery', () => {
    it('should fetch config for the given trigger type', async () => {
      const mockConfig = { fields: [{ key: 'url', name: 'Webhook URL' }] };
      mockProxyFetchTriggerConfig.mockResolvedValueOnce(mockConfig);

      const { result } = renderHook(
        () => useTriggerConfigQuery(TriggerType.Webhook),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockProxyFetchTriggerConfig).toHaveBeenCalledWith(
        TriggerType.Webhook
      );
      expect(result.current.data).toEqual(mockConfig);
    });

    it('should not fetch when enabled is false', async () => {
      renderHook(() => useTriggerConfigQuery(TriggerType.Schedule, false), {
        wrapper: createWrapper(queryClient),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(mockProxyFetchTriggerConfig).not.toHaveBeenCalled();
    });

    it('should use 10-minute staleTime', async () => {
      mockProxyFetchTriggerConfig.mockResolvedValueOnce({});

      const { result } = renderHook(
        () => useTriggerConfigQuery(TriggerType.Slack),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Observe the internal query state via queryClient
      const cached = queryClient
        .getQueryCache()
        .find({ queryKey: ['triggers', 'configs', TriggerType.Slack] });

      expect(cached).toBeDefined();
      // staleTime is stored in milliseconds: 10 minutes = 600 000 ms
      // QueryObserver stores staleTime on the observer, but the query
      // options are available via `cached!.options`.

      expect((cached!.options as { staleTime?: number }).staleTime).toBe(
        1000 * 60 * 10
      );
    });

    it('should propagate API errors', async () => {
      mockProxyFetchTriggerConfig.mockRejectedValueOnce(
        new Error('Config unavailable')
      );

      const { result } = renderHook(
        () => useTriggerConfigQuery(TriggerType.Webhook),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect((result.current.error as Error).message).toBe(
        'Config unavailable'
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. useTriggerCacheInvalidation
  // ═══════════════════════════════════════════════════════════════════

  describe('useTriggerCacheInvalidation', () => {
    it('should expose all five cache helpers', () => {
      const { result } = renderHook(() => useTriggerCacheInvalidation(), {
        wrapper: createWrapper(queryClient),
      });

      expect(typeof result.current.invalidateTriggerList).toBe('function');
      expect(typeof result.current.invalidateUserTriggerCount).toBe('function');
      expect(typeof result.current.invalidateTriggerConfigs).toBe('function');
      expect(typeof result.current.invalidateAllTriggers).toBe('function');
      expect(typeof result.current.prefetchTriggerConfig).toBe('function');
    });

    // ── invalidateTriggerList ────────────────────────────────────────

    describe('invalidateTriggerList', () => {
      it('should invalidate list queries for a specific projectId', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateTriggerList('proj-x');
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers', 'list', 'proj-x'],
        });
      });

      it('should invalidate all list queries when projectId is undefined', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateTriggerList(undefined);
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers'],
          predicate: expect.any(Function),
        });

        // Verify the predicate filters for 'list' queries
        // Find the call that used a predicate option
        const predicateCall = invalidateSpy.mock.calls.find((c) => {
          const arg = c[0] as Record<string, unknown>;
          return typeof arg?.predicate === 'function';
        });
        expect(predicateCall).toBeDefined();
        const predicate = (predicateCall![0] as Record<string, unknown>)
          .predicate as (q: { queryKey: readonly unknown[] }) => boolean;

        expect(predicate({ queryKey: ['triggers', 'list', 'proj-a'] })).toBe(
          true
        );
        expect(predicate({ queryKey: ['triggers', 'userCount'] })).toBe(false);
        expect(
          predicate({ queryKey: ['triggers', 'configs', 'webhook'] })
        ).toBe(false);
      });

      it('should invalidate all list queries when projectId is null', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateTriggerList(null);
        });

        // null !== undefined, so it should use the specific projectId path
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers', 'list', null],
        });
      });
    });

    // ── invalidateUserTriggerCount ───────────────────────────────────

    describe('invalidateUserTriggerCount', () => {
      it('should invalidate the userCount query', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateUserTriggerCount();
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers', 'userCount'],
        });
      });
    });

    // ── invalidateTriggerConfigs ─────────────────────────────────────

    describe('invalidateTriggerConfigs', () => {
      it('should invalidate config for a specific trigger type', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateTriggerConfigs(TriggerType.Webhook);
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers', 'configs', TriggerType.Webhook],
        });
      });

      it('should invalidate all configs when no trigger type is provided', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateTriggerConfigs();
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers', 'configs'],
        });
      });
    });

    // ── invalidateAllTriggers ────────────────────────────────────────

    describe('invalidateAllTriggers', () => {
      it('should invalidate all trigger queries', async () => {
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          result.current.invalidateAllTriggers();
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['triggers'],
        });
      });
    });

    // ── prefetchTriggerConfig ────────────────────────────────────────

    describe('prefetchTriggerConfig', () => {
      it('should prefetch config for the given trigger type', async () => {
        const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');
        mockProxyFetchTriggerConfig.mockResolvedValueOnce({ fields: [] });

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          await result.current.prefetchTriggerConfig(TriggerType.Schedule);
        });

        expect(prefetchSpy).toHaveBeenCalledWith({
          queryKey: ['triggers', 'configs', TriggerType.Schedule],
          queryFn: expect.any(Function),
          staleTime: 1000 * 60 * 10,
        });
      });

      it('should use correct queryFn that calls proxyFetchTriggerConfig', async () => {
        const prefetchSpy = vi.spyOn(queryClient, 'prefetchQuery');
        mockProxyFetchTriggerConfig.mockResolvedValueOnce({ fields: [] });

        const { result } = renderHook(() => useTriggerCacheInvalidation(), {
          wrapper: createWrapper(queryClient),
        });

        await act(async () => {
          await result.current.prefetchTriggerConfig(TriggerType.Slack);
        });

        // Extract the queryFn passed to prefetchQuery
        const prefetchCall = prefetchSpy.mock.calls[0][0];
        const queryFn = prefetchCall.queryFn as () => Promise<unknown>;

        // Execute the queryFn to verify it delegates correctly
        await queryFn();

        expect(mockProxyFetchTriggerConfig).toHaveBeenCalledWith(
          TriggerType.Slack
        );
      });
    });

    // ── memoization stability ────────────────────────────────────────

    describe('callback stability', () => {
      it('should return stable callbacks across rerenders', () => {
        const { result, rerender } = renderHook(
          () => useTriggerCacheInvalidation(),
          { wrapper: createWrapper(queryClient) }
        );

        const firstRefs = { ...result.current };

        rerender();

        expect(result.current.invalidateTriggerList).toBe(
          firstRefs.invalidateTriggerList
        );
        expect(result.current.invalidateUserTriggerCount).toBe(
          firstRefs.invalidateUserTriggerCount
        );
        expect(result.current.invalidateTriggerConfigs).toBe(
          firstRefs.invalidateTriggerConfigs
        );
        expect(result.current.invalidateAllTriggers).toBe(
          firstRefs.invalidateAllTriggers
        );
        expect(result.current.prefetchTriggerConfig).toBe(
          firstRefs.prefetchTriggerConfig
        );
      });
    });
  });
});
