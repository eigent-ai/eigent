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

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import { rememberExampleCategoryOptions } from '@/lib/exampleCategoryCache';
import { isExampleContentEnabled } from '@/lib/exampleContentFeature';
import {
  fetchExampleContentCatalog,
  getDefaultExampleContentCatalogUrl,
  isExampleContentExpired,
  resolveExampleContentOptions,
  resolveExampleRecommendations,
} from '@/service/exampleContentApi';
import { useAuthStore } from '@/store/authStore';
import type { ExampleRecommendationsRequest } from '@/types/exampleContent';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

const FIVE_MINUTES = 5 * 60 * 1_000;

export const exampleContentQueryKeys = {
  all: ['example-content'] as const,
  catalog: (catalogUrl: string | null) =>
    [...exampleContentQueryKeys.all, 'catalog', catalogUrl] as const,
};

const useExampleContentCatalog = (enabled: boolean) => {
  const catalogUrl = getDefaultExampleContentCatalogUrl();
  return useQuery({
    queryKey: exampleContentQueryKeys.catalog(catalogUrl),
    queryFn: ({ signal }) => fetchExampleContentCatalog(signal),
    enabled,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    retry: 1,
  });
};

export function useExampleContentOptions(locale: string) {
  const accountId = useAuthStore((state) => state.user_id);
  const environment = getAuthEnvironmentKey();
  const account = accountId == null ? 'signed-out' : String(accountId);
  const query = useExampleContentCatalog(isExampleContentEnabled());
  const data = useMemo(
    () =>
      query.data === undefined
        ? undefined
        : resolveExampleContentOptions(query.data, locale),
    [locale, query.data]
  );
  const isExpired = data ? isExampleContentExpired(data) : false;

  useEffect(() => {
    if (data !== undefined && !isExpired) {
      rememberExampleCategoryOptions(environment, account, data);
    }
  }, [account, data, environment, isExpired]);

  return { ...query, data: isExpired ? undefined : data, isExpired };
}

export function useExampleRecommendations(
  request: ExampleRecommendationsRequest,
  options: { enabled?: boolean; contentRevision?: string | null } = {}
) {
  const query = useExampleContentCatalog(
    isExampleContentEnabled() && options.enabled !== false
  );
  const data = useMemo(
    () =>
      query.data === undefined
        ? undefined
        : resolveExampleRecommendations(query.data, request),
    [query.data, request]
  );
  const isExpired = data ? isExampleContentExpired(data) : false;
  return { ...query, data: isExpired ? undefined : data, isExpired };
}
