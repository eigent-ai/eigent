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
import { getAuthStore, useAuthStore } from '@/store/authStore';
import { getCloudModelStore } from '@/store/cloudModelStore';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const API_CODE_TRIAL_LIMIT = '22';

const hasApiCode = (value: unknown, code: string) =>
  typeof value === 'object' &&
  value !== null &&
  String((value as { code?: unknown }).code) === code;

/**
 * Centralized model-configuration check.
 *
 * Reads the last known result from the persisted auth store so returning
 * users get the correct UI on first paint (no overlay flash). Re-validates
 * silently in the background on mount, when `modelType` changes, when the
 * route returns to `/`, and when the window regains focus. On API failure
 * the previous value is kept rather than reset to `false`, so a transient
 * error doesn't briefly hide the input.
 */
export function useModelConfigCheck(): {
  hasModel: boolean;
  isConfigLoaded: boolean;
  cloudUsageLimitReached: boolean;
} {
  const modelType = useAuthStore((s) => s.modelType);
  const hasModel = useAuthStore((s) => s.hasModelConfigured);
  const setHasModelConfigured = useAuthStore((s) => s.setHasModelConfigured);
  const location = useLocation();
  // Session-only: true once the first check has completed at least once,
  // used by callers that need to wait for a fresh validation (e.g. share
  // token handling) rather than trusting the persisted optimistic value.
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [cloudUsageLimitReached, setCloudUsageLimitReached] = useState(false);

  const checkModelConfig = useCallback(async () => {
    try {
      if (modelType === 'cloud') {
        const { token, cloud_model_type } = getAuthStore();
        if (!token) {
          setCloudUsageLimitReached(false);
          setHasModelConfigured(false);
          return;
        }

        await getCloudModelStore().fetchCloudModels();
        const resolvedCloudModel =
          getCloudModelStore().resolveCloudModel(cloud_model_type);
        setHasModelConfigured(Boolean(resolvedCloudModel));

        try {
          const res = await proxyFetchGet('/api/v1/user/key');
          setCloudUsageLimitReached(hasApiCode(res, API_CODE_TRIAL_LIMIT));
        } catch (err: any) {
          if (
            hasApiCode(err?.response?.data, API_CODE_TRIAL_LIMIT) ||
            hasApiCode(err, API_CODE_TRIAL_LIMIT)
          ) {
            setCloudUsageLimitReached(true);
          } else {
            console.error('Failed to check cloud usage limit:', err);
          }
        }
      } else if (modelType === 'local' || modelType === 'custom') {
        setCloudUsageLimitReached(false);
        const res = await proxyFetchGet('/api/v1/providers', { prefer: true });
        const providerList = res.items || [];
        setHasModelConfigured(providerList.length > 0);
      } else {
        setCloudUsageLimitReached(false);
        setHasModelConfigured(false);
      }
    } catch (err: any) {
      console.error('Failed to check model config:', err);
      if (
        modelType === 'cloud' &&
        (hasApiCode(err?.response?.data, API_CODE_TRIAL_LIMIT) ||
          hasApiCode(err, API_CODE_TRIAL_LIMIT))
      ) {
        setCloudUsageLimitReached(true);
        setHasModelConfigured(false);
      }
    } finally {
      setIsConfigLoaded(true);
    }
  }, [modelType, setHasModelConfigured]);

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

  return { hasModel, isConfigLoaded, cloudUsageLimitReached };
}
