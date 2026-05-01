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
import { useCallback, useEffect, useRef } from 'react';

/**
 * Background sync for BYOK/local provider catalog (shared by chat model
 * dropdown and Agents → Models). Mount from Layout so `/` and `/history` both
 * stay fresh without per-input remount fetches.
 */
export function useProvidersCatalogSync(): void {
  const token = useAuthStore((s) => s.token);
  const modelType = useAuthStore((s) => s.modelType);
  const applyFromApiResponse = useProvidersCatalogStore(
    (s) => s.applyFromApiResponse
  );
  const latestModelTypeRef = useRef(modelType);
  const latestApplyFromApiResponseRef = useRef(applyFromApiResponse);
  const inFlightRef = useRef(false);
  const pendingSyncRef = useRef(false);

  const sync = useCallback(async () => {
    if (!useAuthStore.getState().token) return;

    if (inFlightRef.current) {
      pendingSyncRef.current = true;
      return;
    }

    inFlightRef.current = true;
    try {
      do {
        pendingSyncRef.current = false;
        if (!useAuthStore.getState().token) return;

        const res = await proxyFetchGet('/api/v1/providers', { prefer: true });
        if (!useAuthStore.getState().token) return;

        latestApplyFromApiResponseRef.current(res, latestModelTypeRef.current);
      } while (pendingSyncRef.current);
    } catch (e) {
      console.error('Failed to sync providers catalog:', e);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    latestApplyFromApiResponseRef.current = applyFromApiResponse;
  }, [applyFromApiResponse]);

  useEffect(() => {
    latestModelTypeRef.current = modelType;
    if (!token) return;
    sync();
  }, [token, modelType, sync]);

  useEffect(() => {
    const onFocus = () => {
      sync();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [sync]);
}
