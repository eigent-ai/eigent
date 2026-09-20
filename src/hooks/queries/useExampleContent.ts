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

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { rememberExampleCategoryOptions } from '@/lib/exampleCategoryCache';
import { isExampleContentEnabled } from '@/lib/exampleContentFeature';
import {
  fetchExampleContentOptions,
  fetchExampleRecommendations,
  isExampleContentExpired,
} from '@/service/exampleContentApi';
import { useAuthStore } from '@/store/authStore';
import type { ExampleRecommendationsRequest } from '@/types/exampleContent';
import { useQuery } from '@tanstack/react-query';

const FIVE_MINUTES = 5 * 60 * 1_000;

export const exampleContentQueryKeys = {
  all: ['example-content'] as const,
  options: (environment: string, account: string, locale: string) =>
    [
      ...exampleContentQueryKeys.all,
      'options',
      environment,
      account,
      locale,
    ] as const,
  recommendations: (
    environment: string,
    account: string,
    revision: string | null,
    request: ExampleRecommendationsRequest
  ) =>
    [
      ...exampleContentQueryKeys.all,
      'recommendations',
      environment,
      account,
      revision,
      request.surface,
      request.roleKey ?? null,
      request.spaceCategoryKey ?? null,
      request.locale,
      request.limit ?? 3,
    ] as const,
};

export function useExampleContentOptions(locale: string) {
  const accountId = useAuthStore((state) => state.user_id);
  const token = useAuthStore((state) => state.token);
  const environment = getAuthEnvironmentKey();
  const account = accountId == null ? 'signed-out' : String(accountId);
  const enabled =
    isExampleContentEnabled() && Boolean(token) && accountId != null;

  const query = useQuery({
    queryKey: exampleContentQueryKeys.options(environment, account, locale),
    queryFn: async ({ signal }) => {
      const response = await fetchExampleContentOptions(locale, signal);
      rememberExampleCategoryOptions(environment, account, response);
      return response;
    },
    enabled,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    retry: 1,
  });
  const isExpired = query.data ? isExampleContentExpired(query.data) : false;
  return { ...query, data: isExpired ? undefined : query.data, isExpired };
}

export function useExampleRecommendations(
  request: ExampleRecommendationsRequest,
  options: { enabled?: boolean; contentRevision?: string | null } = {}
) {
  const accountId = useAuthStore((state) => state.user_id);
  const token = useAuthStore((state) => state.token);
  const environment = getAuthEnvironmentKey();
  const account = accountId == null ? 'signed-out' : String(accountId);
  const enabled =
    isExampleContentEnabled() &&
    options.enabled !== false &&
    Boolean(token) &&
    accountId != null;

  const query = useQuery({
    queryKey: exampleContentQueryKeys.recommendations(
      environment,
      account,
      options.contentRevision ?? null,
      request
    ),
    queryFn: ({ signal }) => fetchExampleRecommendations(request, signal),
    enabled,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    retry: 1,
  });
  const isExpired = query.data ? isExampleContentExpired(query.data) : false;
  return { ...query, data: isExpired ? undefined : query.data, isExpired };
}
