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

import { createHost } from '@/host/createHost';
import {
  fetchConfiguredProviders,
  MODEL_CONFIGURATIONS_CHANGED,
} from '@/lib/configuredModels';
import { getProviderValid } from '@/lib/providerStatus';
import { getAuthStore, useAuthStore } from '@/store/authStore';
import { getCloudModelStore } from '@/store/cloudModelStore';
import { refreshUsage, useUsageNoticeStore } from '@/store/usageNoticeStore';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

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
  /** The default own model is set up but its key is not on this device. */
  modelKeyNeeded: boolean;
} {
  const modelType = useAuthStore((s) => s.modelType);
  const hasModel = useAuthStore((s) => s.hasModelConfigured);
  const setHasModelConfigured = useAuthStore((s) => s.setHasModelConfigured);
  const location = useLocation();
  // Session-only: true once the first check has completed at least once,
  // used by callers that need to wait for a fresh validation (e.g. share
  // token handling) rather than trusting the persisted optimistic value.
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [modelKeyNeeded, setModelKeyNeeded] = useState(false);
  const cloudUsageLimitReached = useUsageNoticeStore((state) =>
    state.incidents.some((item) =>
      ['credits', 'trial-daily', 'trial-total', 'free-credits'].includes(
        item.reason
      )
    )
  );

  const checkModelConfig = useCallback(async () => {
    try {
      if (modelType === 'cloud') {
        const { token, cloud_model_type } = getAuthStore();
        if (!token) {
          setHasModelConfigured(false);
          return;
        }

        await getCloudModelStore().fetchCloudModels();
        const resolvedCloudModel =
          getCloudModelStore().resolveCloudModel(cloud_model_type);
        setHasModelConfigured(Boolean(resolvedCloudModel));

        await refreshUsage();
      } else if (modelType === 'codex_subscription') {
        const { email } = getAuthStore();
        const status = email
          ? await createHost().electronAPI?.codexSubscriptionStatus?.(email)
          : null;
        setHasModelConfigured(Boolean(status?.connected));
      } else if (modelType === 'local' || modelType === 'custom') {
        const providerList = (await fetchConfiguredProviders()).filter(
          (provider) => provider.prefer
        );
        setHasModelConfigured(providerList.some(getProviderValid));
        setModelKeyNeeded(
          !providerList.some(getProviderValid) &&
            providerList.some((provider) => provider.key_state === 'needed')
        );
        return;
      } else {
        setHasModelConfigured(false);
      }
      setModelKeyNeeded(false);
    } catch (err: any) {
      console.error('Failed to check model config:', err);
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
    window.addEventListener(MODEL_CONFIGURATIONS_CHANGED, handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener(MODEL_CONFIGURATIONS_CHANGED, handleFocus);
    };
  }, [checkModelConfig]);

  return { hasModel, isConfigLoaded, cloudUsageLimitReached, modelKeyNeeded };
}
