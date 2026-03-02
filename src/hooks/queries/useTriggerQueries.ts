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

import { queryKeys } from '@/lib/queryClient';
import {
  proxyFetchProjectTriggers,
  proxyFetchTriggerConfig,
  proxyFetchTriggers,
} from '@/service/triggerApi';
import { TriggerStatus, TriggerType } from '@/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Hook for fetching triggers for a specific project with TanStack Query caching
 */
export function useTriggerListQuery(
  projectId: string | null,
  options?: {
    triggerType?: TriggerType;
    status?: TriggerStatus;
    page?: number;
    size?: number;
    enabled?: boolean;
  }
) {
  const {
    triggerType,
    status,
    page = 1,
    size = 50,
    enabled = true,
  } = options || {};

  return useQuery({
    queryKey: queryKeys.triggers.list(projectId),
    queryFn: async () => {
      if (!projectId) {
        return { items: [], total: 0 };
      }
      const response = await proxyFetchProjectTriggers(
        projectId,
        triggerType,
        status,
        page,
        size
      );
      return response;
    },
    enabled: enabled && !!projectId,
  });
}

/**
 * Hook for fetching the total user trigger count (across all projects) with caching
 */
export function useUserTriggerCountQuery(enabled: boolean = true) {
  return useQuery({
    queryKey: queryKeys.triggers.userCount(),
    queryFn: async () => {
      const response = await proxyFetchTriggers(undefined, undefined, 1, 100);
      return response.total || 0;
    },
    enabled,
  });
}

/**
 * Hook for fetching trigger type configuration with caching
 */
export function useTriggerConfigQuery(
  triggerType: TriggerType,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: queryKeys.triggers.configs(triggerType),
    queryFn: () => proxyFetchTriggerConfig(triggerType),
    enabled,
    staleTime: 1000 * 60 * 10, // 10 minutes - configs don't change often
  });
}

/**
 * Hook for invalidating trigger-related caches
 * Returns functions to invalidate specific or all trigger caches
 */
export function useTriggerCacheInvalidation() {
  const queryClient = useQueryClient();

  const invalidateTriggerList = useCallback(
    (projectId?: string | null) => {
      if (projectId !== undefined) {
        return queryClient.invalidateQueries({
          queryKey: queryKeys.triggers.list(projectId),
        });
      }
      // Invalidate all trigger lists
      return queryClient.invalidateQueries({
        queryKey: queryKeys.triggers.all,
        predicate: (query) => query.queryKey[1] === 'list',
      });
    },
    [queryClient]
  );

  const invalidateUserTriggerCount = useCallback(() => {
    return queryClient.invalidateQueries({
      queryKey: queryKeys.triggers.userCount(),
    });
  }, [queryClient]);

  const invalidateTriggerConfigs = useCallback(
    (triggerType?: TriggerType) => {
      if (triggerType) {
        return queryClient.invalidateQueries({
          queryKey: queryKeys.triggers.configs(triggerType),
        });
      }
      // Invalidate all configs
      return queryClient.invalidateQueries({
        queryKey: queryKeys.triggers.allConfigs(),
      });
    },
    [queryClient]
  );

  const invalidateAllTriggers = useCallback(() => {
    return queryClient.invalidateQueries({
      queryKey: queryKeys.triggers.all,
    });
  }, [queryClient]);

  const prefetchTriggerConfig = useCallback(
    (triggerType: TriggerType) => {
      return queryClient.prefetchQuery({
        queryKey: queryKeys.triggers.configs(triggerType),
        queryFn: () => proxyFetchTriggerConfig(triggerType),
        staleTime: 1000 * 60 * 10,
      });
    },
    [queryClient]
  );

  return {
    invalidateTriggerList,
    invalidateUserTriggerCount,
    invalidateTriggerConfigs,
    invalidateAllTriggers,
    prefetchTriggerConfig,
  };
}
