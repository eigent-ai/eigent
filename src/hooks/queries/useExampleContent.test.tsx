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

import {
  exampleContentQueryKeys,
  useExampleRecommendations,
} from '@/hooks/queries/useExampleContent';
import { fetchExampleContentCatalog } from '@/service/exampleContentApi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  token: null as string | null,
  user_id: null as number | null,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: typeof authState) => unknown) =>
    selector(authState),
  getAuthStore: () => authState,
}));

vi.mock('@/service/exampleContentApi', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/service/exampleContentApi')>();
  return { ...original, fetchExampleContentCatalog: vi.fn() };
});

const wrapper = ({ children }: PropsWithChildren) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useExampleRecommendations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    authState.token = null;
    authState.user_id = null;
    vi.clearAllMocks();
  });

  it('does not request content while the feature flag is off', () => {
    vi.stubEnv('VITE_EXAMPLE_CONTENT_ENABLED', 'false');

    const { result } = renderHook(
      () =>
        useExampleRecommendations({
          surface: 'workspace',
          roleKey: 'engineering',
          spaceCategoryKey: 'finance',
          locale: 'en',
        }),
      { wrapper }
    );

    expect(result.current.fetchStatus).toBe('idle');
    expect(fetchExampleContentCatalog).not.toHaveBeenCalled();
  });

  it('keys the shared catalog cache by its configured public URL', () => {
    expect(
      exampleContentQueryKeys.catalog(
        'https://cdn.example.com/example-content/catalog-a.json'
      )
    ).not.toEqual(
      exampleContentQueryKeys.catalog(
        'https://cdn.example.com/example-content/catalog-b.json'
      )
    );
  });
});
