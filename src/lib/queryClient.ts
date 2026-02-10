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
    list: (projectId: string | null) =>
      [...queryKeys.triggers.all, 'list', projectId] as const,
    userCount: () => [...queryKeys.triggers.all, 'userCount'] as const,
    detail: (triggerId: number) =>
      [...queryKeys.triggers.all, 'detail', triggerId] as const,
    configs: (triggerType: string) =>
      [...queryKeys.triggers.all, 'configs', triggerType] as const,
    allConfigs: () => [...queryKeys.triggers.all, 'configs'] as const,
  },
};
