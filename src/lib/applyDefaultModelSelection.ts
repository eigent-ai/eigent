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

/**
 * Shared default-model selection logic (mirrors Agents → Models) for in-app
 * switching e.g. chat input without navigating to settings when already configured.
 */

import { proxyFetchGet, proxyFetchPost } from '@/api/http';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { saveDefaultModelSelection } from '@/lib/defaultModelSelectionState';
import { isSearchConfigured } from '@/lib/searchConfig';
import { getAuthStore } from '@/store/authStore';
import type { Provider } from '@/types';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { toast } from 'sonner';

export type DefaultModelCategory = 'cloud' | 'custom' | 'local';

export type DefaultModelFormRow = {
  provider_id?: number;
  prefer?: boolean;
  model_type?: string;
};

export function isDefaultModelConfigured(
  category: DefaultModelCategory,
  modelId: string,
  opts: {
    items: Pick<Provider, 'id'>[];
    form: DefaultModelFormRow[];
    localProviderIds: Record<string, number | undefined>;
  }
): boolean {
  if (category === 'cloud') {
    return import.meta.env.VITE_USE_LOCAL_PROXY !== 'true';
  }
  if (category === 'custom') {
    const idx = opts.items.findIndex((item) => item.id === modelId);
    return idx !== -1 && !!opts.form[idx]?.provider_id;
  }
  if (category === 'local') {
    return !!opts.localProviderIds[modelId];
  }
  return false;
}

async function checkHasSearchKey(accountKey: string): Promise<boolean> {
  const configsRes = await proxyFetchGet(
    '/api/v1/configs',
    undefined,
    undefined,
    { expectedAccountKey: accountKey }
  );
  const configs = Array.isArray(configsRes) ? configsRes : [];
  return isSearchConfigured(configs);
}

export interface ApplyDefaultModelSelectionParams {
  category: DefaultModelCategory;
  modelId: string;
  items: Provider[];
  form: DefaultModelFormRow[];
  /** Full provider form state from UIs (BYOK + chat); we only read/update `prefer`. */
  setForm: Dispatch<SetStateAction<unknown[]>>;
  setCloudPrefer: (v: boolean) => void;
  setLocalPrefer: (v: boolean) => void;
  setLocalPlatform: (p: string) => void;
  localProviderIds: Record<string, number | undefined>;
  localPlatform: string;
  localTypes?: Record<string, string>;
  setModelType: (t: 'cloud' | 'local' | 'custom') => void;
  setCloudModelType: (id: string) => void;
  t: TFunction;
}

/**
 * Applies default model for an already-configured option. Call only when
 * {@link isDefaultModelConfigured} is true.
 */
export async function applyDefaultModelSelection(
  params: ApplyDefaultModelSelectionParams
): Promise<boolean> {
  const {
    category,
    modelId,
    items,
    form,
    setForm,
    setCloudPrefer,
    setLocalPrefer,
    setLocalPlatform,
    localProviderIds,
    localPlatform,
    localTypes,
    setModelType,
    setCloudModelType,
    t,
  } = params;

  const accountKey = getAccountEnvironmentKey(getAuthStore());
  const idx = items.findIndex((item) => item.id === modelId);
  const providerId =
    category === 'custom' ? form[idx]?.provider_id : localProviderIds[modelId];
  if (category !== 'cloud' && providerId === undefined) return false;
  const assertAccount = () => {
    if (accountKey !== getAccountEnvironmentKey(getAuthStore()))
      throw new Error('Model selection account changed');
  };
  return saveDefaultModelSelection(
    accountKey,
    {
      modelType: category,
      ...(category !== 'cloud'
        ? {
            provider_id: providerId,
            model_platform: modelId,
            model_type:
              (category === 'custom'
                ? form[idx]?.model_type
                : localTypes?.[modelId]) || undefined,
          }
        : {}),
    },
    async () => {
      try {
        assertAccount();
        if (category === 'cloud') {
          setForm((f) =>
            (f as object[]).map((fi) => ({ ...fi, prefer: false }))
          );
          setLocalPrefer(false);
          setCloudPrefer(true);
          setModelType('cloud');
          if (modelId !== 'cloud') {
            setCloudModelType(modelId);
          }
          return true;
        }

        if (category === 'custom') {
          const hasSearchKey = await checkHasSearchKey(accountKey);
          assertAccount();
          if (!hasSearchKey) {
            toast(t('setting.warning-google-search-not-configured'), {
              description: t(
                'setting.search-functionality-may-be-limited-without-google-api'
              ),
              closeButton: true,
            });
          }
          await proxyFetchPost(
            '/api/v1/provider/prefer',
            {
              provider_id: providerId,
            },
            undefined,
            { expectedAccountKey: accountKey }
          );
          assertAccount();
          setModelType('custom');
          setCloudPrefer(false);
          setLocalPrefer(false);
          setForm((f) =>
            (f as object[]).map((fi, i) => ({ ...fi, prefer: i === idx }))
          );
          return true;
        }

        if (category === 'local') {
          if (localPlatform !== modelId) {
            setLocalPlatform(modelId);
          }
          const targetProviderId = providerId;
          if (targetProviderId === undefined) return false;

          const hasSearchKey = await checkHasSearchKey(accountKey);
          assertAccount();
          if (!hasSearchKey) {
            toast(t('setting.warning-google-search-not-configured'), {
              description: t(
                'setting.search-functionality-may-be-limited-without-google-api'
              ),
              closeButton: true,
            });
          }
          await proxyFetchPost(
            '/api/v1/provider/prefer',
            {
              provider_id: targetProviderId,
            },
            undefined,
            { expectedAccountKey: accountKey }
          );
          assertAccount();
          setModelType('local');
          setForm((f) =>
            (f as object[]).map((fi) => ({ ...fi, prefer: false }))
          );
          setLocalPrefer(true);
          setCloudPrefer(false);
          return true;
        }
      } catch (e) {
        console.error('applyDefaultModelSelection failed:', e);
        if (accountKey === getAccountEnvironmentKey(getAuthStore()))
          toast.error(t('setting.validate-failed'));
        return false;
      }

      return false;
    }
  );
}
