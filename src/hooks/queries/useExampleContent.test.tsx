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
  exampleContentQueryKeys,
  useExampleRecommendations,
} from '@/hooks/queries/useExampleContent';
import { fetchExampleRecommendations } from '@/service/exampleContentApi';
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
  return { ...original, fetchExampleRecommendations: vi.fn() };
});

describe('useExampleRecommendations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    authState.token = null;
    authState.user_id = null;
    vi.clearAllMocks();
  });

  it('does not request content while the feature flag is off', () => {
    vi.stubEnv('VITE_EXAMPLE_CONTENT_ENABLED', 'false');
    authState.token = 'token';
    authState.user_id = 42;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

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
    expect(fetchExampleRecommendations).not.toHaveBeenCalled();
  });

  it('separates recommendation snapshots by environment, account, and revision', () => {
    const request = { surface: 'workspace' as const, locale: 'en' };
    expect(
      exampleContentQueryKeys.recommendations('env-a', '1', 'r1', request)
    ).not.toEqual(
      exampleContentQueryKeys.recommendations('env-a', '2', 'r1', request)
    );
    expect(
      exampleContentQueryKeys.recommendations('env-a', '1', 'r1', request)
    ).not.toEqual(
      exampleContentQueryKeys.recommendations('env-a', '1', 'r2', request)
    );
    expect(
      exampleContentQueryKeys.recommendations('env-a', '1', 'r1', request)
    ).not.toEqual(
      exampleContentQueryKeys.recommendations('env-b', '1', 'r1', request)
    );
  });
});
