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

import { proxyFetchGet } from '@/api/http';
import { useAuthStore } from '@/store/authStore';
import { useProvidersCatalogStore } from '@/store/providersCatalogStore';
import { useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Centralized model-configuration check. Mount once from Home (workspace
 * shell) so tab switches do not reset session state or duplicate requests.
 *
 * Reads the last known result from the persisted auth store so returning
 * users get the correct UI on first paint (no overlay flash). Re-validates
 * silently in the background when `modelType` changes, when the route is
 * `/`, and when the window regains focus.
 *
 * Cloud mode hits `/api/v1/user/key` directly (no catalog overlap). Local /
 * custom modes derive `hasModelConfigured` from `useProvidersCatalogStore`
 * (`hasPreferredProvider`), avoiding a duplicate `GET /api/v1/providers`
 * — Layout's `useProvidersCatalogSync` already keeps the catalog fresh.
 *
 * On API failure the previous value is kept rather than reset to `false`,
 * so a transient error doesn't briefly hide the input.
 * `modelConfigCheckCompleted` in the store is set in `finally` for overlay
 * / share-token guards without per-component local state.
 */
export function useModelConfigCheck(): void {
  const modelType = useAuthStore((s) => s.modelType);
  const setHasModelConfigured = useAuthStore((s) => s.setHasModelConfigured);
  const setModelConfigCheckCompleted = useAuthStore(
    (s) => s.setModelConfigCheckCompleted
  );
  const location = useLocation();

  const checkModelConfig = useCallback(async () => {
    let shouldMarkCompleted = true;
    try {
      if (modelType === 'cloud') {
        const res = await proxyFetchGet('/api/v1/user/key');
        setHasModelConfigured(!!res.value);
      } else if (modelType === 'local' || modelType === 'custom') {
        const catalog = useProvidersCatalogStore.getState();
        if (catalog.lastFetchedAt != null) {
          setHasModelConfigured(catalog.hasPreferredProvider);
        } else {
          // Defer completion until catalog sync hydrates to avoid showing
          // "no model configured" from stale/default state.
          shouldMarkCompleted = false;
          setModelConfigCheckCompleted(false);
        }
        // If the catalog hasn't loaded yet, the subscription effect below
        // mirrors `hasPreferredProvider` once Layout's sync lands.
      } else {
        setHasModelConfigured(false);
      }
    } catch (err) {
      console.error('Failed to check model config:', err);
    } finally {
      if (!shouldMarkCompleted) return;
      setModelConfigCheckCompleted(true);
    }
  }, [modelType, setHasModelConfigured, setModelConfigCheckCompleted]);

  useEffect(() => {
    checkModelConfig();
  }, [modelType, checkModelConfig]);

  useEffect(() => {
    if (location.pathname === '/') {
      checkModelConfig();
    }
  }, [location.pathname, checkModelConfig]);

  useEffect(() => {
    const handleFocus = () => {
      checkModelConfig();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfig]);

  // For local/custom: subscribe to catalog updates so changes from the
  // shared sync land in `hasModelConfigured` without re-fetching.
  useEffect(() => {
    if (modelType !== 'local' && modelType !== 'custom') return;
    const apply = () => {
      const state = useProvidersCatalogStore.getState();
      if (state.lastFetchedAt == null) return;
      setHasModelConfigured(state.hasPreferredProvider);
      setModelConfigCheckCompleted(true);
    };
    apply();
    return useProvidersCatalogStore.subscribe(apply);
  }, [modelType, setHasModelConfigured, setModelConfigCheckCompleted]);
}
