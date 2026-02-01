import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 30, // 30 minutes (formerly cacheTime)
            retry: 2,
            refetchOnWindowFocus: false,
        },
    },
});

// Query keys for consistent cache management
export const queryKeys = {
    triggers: {
        all: ['triggers'] as const,
        list: (projectId: string | null) => [...queryKeys.triggers.all, 'list', projectId] as const,
        detail: (triggerId: number) => [...queryKeys.triggers.all, 'detail', triggerId] as const,
        configs: (triggerType: string) => [...queryKeys.triggers.all, 'configs', triggerType] as const,
        allConfigs: () => [...queryKeys.triggers.all, 'configs'] as const,
    },
};
