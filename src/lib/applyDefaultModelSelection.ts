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
import type { Provider } from '@/types';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';

export type DefaultModelCategory = 'cloud' | 'custom' | 'local';

export type DefaultModelFormRow = {
  provider_id?: number;
  prefer?: boolean;
};

type SetDefaultModelFormUpdater<T extends DefaultModelFormRow> = (
  updater: (prev: T[]) => T[]
) => void;

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

async function checkHasSearchKey(): Promise<boolean> {
  const configsRes = await proxyFetchGet('/api/v1/configs');
  const configs = Array.isArray(configsRes) ? configsRes : [];
  const hasApiKey = configs.find(
    (item: { config_name: string }) => item.config_name === 'GOOGLE_API_KEY'
  );
  const hasApiId = configs.find(
    (item: { config_name: string }) => item.config_name === 'SEARCH_ENGINE_ID'
  );
  return Boolean(hasApiKey && hasApiId);
}

export interface ApplyDefaultModelSelectionParams<
  TFormRow extends DefaultModelFormRow = DefaultModelFormRow,
> {
  category: DefaultModelCategory;
  modelId: string;
  items: Provider[];
  form: TFormRow[];
  /** Full provider form state from UIs (BYOK + chat); we only read/update `prefer`. */
  setForm: SetDefaultModelFormUpdater<TFormRow>;
  setCloudPrefer: (v: boolean) => void;
  setLocalPrefer: (v: boolean) => void;
  setLocalPlatform: (p: string) => void;
  localProviderIds: Record<string, number | undefined>;
  localPlatform: string;
  setModelType: (t: 'cloud' | 'local' | 'custom') => void;
  setCloudModelType: (id: string) => void;
  t: TFunction;
}

/**
 * Applies default model for an already-configured option. Call only when
 * {@link isDefaultModelConfigured} is true.
 */
export async function applyDefaultModelSelection<
  TFormRow extends DefaultModelFormRow,
>(params: ApplyDefaultModelSelectionParams<TFormRow>): Promise<boolean> {
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
    setModelType,
    setCloudModelType,
    t,
  } = params;

  try {
    if (category === 'cloud') {
      setForm((f) => f.map((fi) => ({ ...fi, prefer: false }) as TFormRow));
      setLocalPrefer(false);
      setCloudPrefer(true);
      setModelType('cloud');
      if (modelId !== 'cloud') {
        setCloudModelType(modelId);
      }
      return true;
    }

    if (category === 'custom') {
      const idx = items.findIndex((item) => item.id === modelId);
      if (idx === -1) return false;
      const providerId = form[idx]?.provider_id;
      if (providerId === undefined) return false;

      const hasSearchKey = await checkHasSearchKey();
      if (!hasSearchKey) {
        toast(t('setting.warning-google-search-not-configured'), {
          description: t(
            'setting.search-functionality-may-be-limited-without-google-api'
          ),
          closeButton: true,
        });
      }
      await proxyFetchPost('/api/v1/provider/prefer', {
        provider_id: providerId,
      });
      setModelType('custom');
      setCloudPrefer(false);
      setLocalPrefer(false);
      setForm((f) =>
        f.map((fi, i) => ({ ...fi, prefer: i === idx }) as TFormRow)
      );
      return true;
    }

    if (category === 'local') {
      if (localPlatform !== modelId) {
        setLocalPlatform(modelId);
      }
      const targetProviderId = localProviderIds[modelId];
      if (targetProviderId === undefined) return false;

      const hasSearchKey = await checkHasSearchKey();
      if (!hasSearchKey) {
        toast(t('setting.warning-google-search-not-configured'), {
          description: t(
            'setting.search-functionality-may-be-limited-without-google-api'
          ),
          closeButton: true,
        });
      }
      await proxyFetchPost('/api/v1/provider/prefer', {
        provider_id: targetProviderId,
      });
      setModelType('local');
      setForm((f) => f.map((fi) => ({ ...fi, prefer: false }) as TFormRow));
      setLocalPrefer(true);
      setCloudPrefer(false);
      return true;
    }
  } catch (e) {
    console.error('applyDefaultModelSelection failed:', e);
    toast.error(t('setting.validate-failed'));
    return false;
  }

  return false;
}

/** Settings route when the user must finish configuring a provider first. */
export const DEFAULT_MODEL_CONFIGURE_PATH =
  '/history?tab=agents&section=models';
