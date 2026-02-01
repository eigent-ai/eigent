import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { proxyFetchProjectTriggers, proxyFetchTriggerConfig } from '@/service/triggerApi';
import { TriggerType, TriggerStatus } from '@/types';
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
    const { triggerType, status, page = 1, size = 50, enabled = true } = options || {};

    return useQuery({
        queryKey: queryKeys.triggers.list(projectId),
        queryFn: async () => {
            if (!projectId) {
                return { items: [], total: 0 };
            }
            const response = await proxyFetchProjectTriggers(projectId, triggerType, status, page, size);
            return response;
        },
        enabled: enabled && !!projectId,
    });
}

/**
 * Hook for fetching trigger type configuration with caching
 */
export function useTriggerConfigQuery(triggerType: TriggerType, enabled: boolean = true) {
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

    const invalidateTriggerList = useCallback((projectId?: string | null) => {
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
    }, [queryClient]);

    const invalidateTriggerConfigs = useCallback((triggerType?: TriggerType) => {
        if (triggerType) {
            return queryClient.invalidateQueries({
                queryKey: queryKeys.triggers.configs(triggerType),
            });
        }
        // Invalidate all configs
        return queryClient.invalidateQueries({
            queryKey: queryKeys.triggers.allConfigs(),
        });
    }, [queryClient]);

    const invalidateAllTriggers = useCallback(() => {
        return queryClient.invalidateQueries({
            queryKey: queryKeys.triggers.all,
        });
    }, [queryClient]);

    const prefetchTriggerConfig = useCallback((triggerType: TriggerType) => {
        return queryClient.prefetchQuery({
            queryKey: queryKeys.triggers.configs(triggerType),
            queryFn: () => proxyFetchTriggerConfig(triggerType),
            staleTime: 1000 * 60 * 10,
        });
    }, [queryClient]);

    return {
        invalidateTriggerList,
        invalidateTriggerConfigs,
        invalidateAllTriggers,
        prefetchTriggerConfig,
    };
}
